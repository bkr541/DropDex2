"""
ZIP bundle import service.

Accepts a single ZIP archive containing:
  - exportLibrary.db   (required; matched case-insensitively on basename)
  - ANLZ files         (DAT/EXT/2EX; only those referenced by the manifest are extracted)

Any other file type (audio, artwork, etc.) is silently ignored.

Security constraints
--------------------
- Zip-slip traversal is rejected before any extraction.
- Symlinks are rejected.
- Entry count and uncompressed size limits prevent ZIP bomb attacks.
- exportLibrary.db is extracted to a private temp file, not served publicly.
- ANLZ bytes are uploaded to the private Storage bucket via the service-role key.
- Supabase service-role credentials are never exposed in responses.
- Temp files are always removed in a finally block regardless of outcome.
- A failed analysis phase does not roll back the library metadata import.
"""

from __future__ import annotations

import hashlib
import io
import logging
import os
import shutil
import stat
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Dict, List, Optional

from fastapi import HTTPException, UploadFile

from .analysis_import_service import (
    _ANALYSIS_BUCKET,
    _build_manifest_entries,
    _upsert_asset,
)
from .config import settings
from .models import CompleteResponse, TrackCompleteStatus
from .rekordbox_parser import parse_library
from .supabase_writer import write_to_supabase_full
from .user_settings import upsert_active_import
from .validation import validate

logger = logging.getLogger(__name__)

_DB_FILENAME_LOWER = "exportlibrary.db"
_VALID_ANLZ_SUFFIXES = frozenset({".dat", ".ext", ".2ex"})


def _create_supabase():
    import supabase as _sb  # noqa: PLC0415
    return _sb.create_client(settings.supabase_url, settings.supabase_secret_key)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _build_storage_path(user_id: str, import_id: str, canonical_path: str) -> str:
    from dropdex_importer.analysis_paths import build_storage_path as _bp  # noqa: PLC0415
    return _bp(user_id, import_id, canonical_path)


def _is_zip_slip(entry_name: str) -> bool:
    """Return True when a ZIP entry could escape the extraction directory."""
    norm = PurePosixPath(entry_name.replace("\\", "/"))
    if norm.is_absolute():
        return True
    for part in norm.parts:
        if part == "..":
            return True
    return False


def _is_symlink_entry(info: zipfile.ZipInfo) -> bool:
    """Return True when the ZIP entry is a Unix symlink."""
    unix_attrs = info.external_attr >> 16
    return stat.S_ISLNK(unix_attrs)


async def import_bundle(file: UploadFile, user_id: str) -> CompleteResponse:
    """
    Accept a ZIP bundle, run the full library + analysis import pipeline, and
    return a combined analysis result.

    The library metadata import always completes first.  ANLZ parsing is
    attempted for each track independently; a per-track failure does not prevent
    other tracks from being processed.
    """
    from dropdex_importer.analysis_paths import normalize_anlz_path  # noqa: PLC0415
    from dropdex_importer.anlz_parser import (  # noqa: PLC0415
        DROPDEX_ANLZ_PARSER_VERSION,
        parse_track_analysis_bundle,
    )

    content = await file.read()

    if len(content) > settings.max_bundle_upload_bytes:
        limit_mb = settings.max_bundle_upload_bytes // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"Bundle exceeds the maximum allowed size of {limit_mb} MB.",
        )

    if not zipfile.is_zipfile(io.BytesIO(content)):
        raise HTTPException(
            status_code=422,
            detail="Uploaded file is not a valid ZIP archive.",
        )

    tmp_dir: Optional[str] = None
    db_tmp_path: Optional[str] = None

    try:
        tmp_dir = tempfile.mkdtemp()

        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            entries = zf.infolist()

            if len(entries) > settings.max_bundle_entries:
                raise HTTPException(
                    status_code=413,
                    detail=(
                        f"ZIP archive contains too many entries. "
                        f"Maximum is {settings.max_bundle_entries}."
                    ),
                )

            db_entry_name: Optional[str] = None
            anlz_entry_map: Dict[str, str] = {}  # lower(canonical_path) → zip_entry_name
            total_uncompressed = 0

            for entry in entries:
                name = entry.filename

                if _is_zip_slip(name):
                    raise HTTPException(
                        status_code=422,
                        detail="ZIP archive contains unsafe file paths.",
                    )

                if _is_symlink_entry(entry):
                    raise HTTPException(
                        status_code=422,
                        detail="ZIP archive contains symlinks, which are not permitted.",
                    )

                total_uncompressed += entry.file_size
                if total_uncompressed > settings.max_bundle_uncompressed_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail="ZIP archive uncompressed size exceeds the allowed limit.",
                    )

                basename_lower = Path(name).name.lower()
                if basename_lower == _DB_FILENAME_LOWER:
                    db_entry_name = name
                    continue

                suffix_lower = Path(name).suffix.lower()
                if suffix_lower in _VALID_ANLZ_SUFFIXES:
                    canonical = normalize_anlz_path(name)
                    if canonical:
                        anlz_entry_map[canonical.lower()] = name

            if db_entry_name is None:
                raise HTTPException(
                    status_code=422,
                    detail="ZIP archive does not contain exportLibrary.db.",
                )

            # Extract exportLibrary.db to private temp file
            with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
                db_tmp_path = tmp.name
                tmp.write(zf.read(db_entry_name))

            # Parse the library
            try:
                library = parse_library(db_tmp_path)
            except ImportError:
                logger.exception("dropdex_importer not available")
                raise HTTPException(
                    status_code=500,
                    detail="The server is not configured to parse rekordbox databases.",
                )
            except Exception:
                logger.exception("Parser error for user %s", user_id)
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Could not parse the database in the bundle. "
                        "Please confirm it is a valid rekordbox exportLibrary.db."
                    ),
                )

            result = validate(library)
            if not result.ok:
                raise HTTPException(
                    status_code=422,
                    detail=f"Library validation failed: {'; '.join(result.errors)}",
                )

            # Persist library to Supabase
            try:
                write_result = write_to_supabase_full(
                    library,
                    settings.supabase_url,
                    settings.supabase_secret_key,
                    user_id,
                )
            except Exception:
                logger.exception("Supabase write failed for user %s", user_id)
                raise HTTPException(
                    status_code=500,
                    detail="Import encountered a server error. Please try again.",
                )

            import_id = write_result.import_id
            rb_to_sb = write_result.rb_to_sb_track

            try:
                upsert_active_import(
                    settings.supabase_url,
                    settings.supabase_secret_key,
                    user_id,
                    import_id,
                )
            except Exception:
                logger.warning("Failed to set active import for user %s", user_id)

            # Delete the DB temp file now — library is persisted
            if db_tmp_path and os.path.exists(db_tmp_path):
                os.unlink(db_tmp_path)
                db_tmp_path = None

            # ── Analysis phase ────────────────────────────────────────────────
            sb = _create_supabase()
            track_results: List[TrackCompleteStatus] = []
            completed_count = partial_count = failed_count = missing_required_count = 0
            matched_track_count = total_asset_count = 0
            missing_optional_ext_count = missing_optional_2ex_count = 0

            for manifest_entry in write_result.manifest:
                rb_cid = manifest_entry.rekordbox_content_id
                track_id = rb_to_sb.get(rb_cid)
                if not track_id:
                    continue

                dat_spec = next((f for f in manifest_entry.files if f.asset_type == "DAT"), None)
                ext_spec = next((f for f in manifest_entry.files if f.asset_type == "EXT"), None)
                two_ex_spec = next((f for f in manifest_entry.files if f.asset_type == "2EX"), None)

                # Count missing optional siblings regardless of whether DAT is present
                if ext_spec is None or anlz_entry_map.get((ext_spec.normalized_path if ext_spec else "").lower()) is None:
                    if dat_spec:  # only count optional misses when DAT is expected
                        missing_optional_ext_count += 1
                if two_ex_spec is None or anlz_entry_map.get((two_ex_spec.normalized_path if two_ex_spec else "").lower()) is None:
                    if dat_spec:
                        missing_optional_2ex_count += 1

                if not dat_spec:
                    missing_required_count += 1
                    track_results.append(TrackCompleteStatus(
                        track_id=track_id,
                        rekordbox_content_id=rb_cid,
                        parse_status="missing_required",
                        assets_parsed=0,
                    ))
                    continue

                matched_track_count += 1

                # Extract ANLZ files from ZIP to temp directory
                local_paths: Dict[str, Optional[str]] = {"DAT": None, "EXT": None, "2EX": None}
                for spec, key in (
                    (dat_spec, "DAT"),
                    (ext_spec, "EXT"),
                    (two_ex_spec, "2EX"),
                ):
                    if spec is None:
                        continue
                    zip_name = anlz_entry_map.get(spec.normalized_path.lower())
                    if zip_name is None:
                        continue
                    try:
                        file_bytes = zf.read(zip_name)
                        ext_suffix = Path(spec.normalized_path).suffix
                        local_path = os.path.join(tmp_dir, f"{track_id}_{key}{ext_suffix}")
                        with open(local_path, "wb") as fh:
                            fh.write(file_bytes)
                        local_paths[key] = local_path
                    except Exception as exc:
                        logger.warning("Failed to extract %s from bundle: %s", zip_name, exc)

                if not local_paths["DAT"]:
                    missing_required_count += 1
                    track_results.append(TrackCompleteStatus(
                        track_id=track_id,
                        rekordbox_content_id=rb_cid,
                        parse_status="missing_required",
                        assets_parsed=0,
                    ))
                    continue

                # Parse the bundle
                try:
                    bundle = parse_track_analysis_bundle(
                        dat_path=local_paths["DAT"],
                        ext_path=local_paths["EXT"],
                        two_ex_path=local_paths["2EX"],
                    )
                except Exception as exc:
                    logger.error("Bundle parse error for track %s: %s", track_id, exc)
                    failed_count += 1
                    track_results.append(TrackCompleteStatus(
                        track_id=track_id,
                        rekordbox_content_id=rb_cid,
                        parse_status="failed",
                        assets_parsed=0,
                    ))
                    continue

                # Upload ANLZ files to Storage and persist asset records
                parsed_count = 0
                for spec, key, asset_obj in (
                    (dat_spec, "DAT", bundle.dat),
                    (ext_spec, "EXT", bundle.ext),
                    (two_ex_spec, "2EX", bundle.two_ex),
                ):
                    if spec is None or local_paths[key] is None:
                        continue
                    with open(local_paths[key], "rb") as fh:  # type: ignore[arg-type]
                        file_bytes = fh.read()

                    sha256 = (
                        asset_obj.sha256
                        if (asset_obj and asset_obj.sha256)
                        else hashlib.sha256(file_bytes).hexdigest()
                    )
                    storage_path = _build_storage_path(user_id, import_id, spec.normalized_path)
                    canonical_lower = spec.normalized_path.lower()

                    try:
                        sb.storage.from_(_ANALYSIS_BUCKET).upload(
                            path=storage_path,
                            file=file_bytes,
                            file_options={"upsert": "true"},
                        )
                    except Exception as exc:
                        logger.error("Storage upload failed for %s: %s", storage_path, exc)
                        continue

                    asset_parse_status = asset_obj.parse_status if asset_obj else "failed"
                    asset_warnings = [w.as_dict() for w in asset_obj.warnings] if asset_obj else []
                    now = _now_iso()

                    _upsert_asset(sb, {
                        "import_id": import_id,
                        "track_id": track_id,
                        "asset_type": key,
                        "relative_path": canonical_lower,
                        "original_filename": Path(spec.normalized_path).name,
                        "sha256": sha256,
                        "size_bytes": len(file_bytes),
                        "storage_bucket": _ANALYSIS_BUCKET,
                        "storage_path": storage_path,
                        "upload_status": "uploaded",
                        "parse_status": asset_parse_status,
                        "parser_version": DROPDEX_ANLZ_PARSER_VERSION,
                        "parse_warnings": asset_warnings,
                        "uploaded_at": now,
                        "parsed_at": now,
                    })

                    if asset_obj and asset_obj.parse_status in ("completed", "partial"):
                        parsed_count += 1
                    total_asset_count += 1

                # ── Feature extraction (each phase is isolated) ────────────
                feature_statuses: Dict[str, str] = {}
                # Query asset IDs for this track so feature writers can link to
                # the correct source asset rows that were just upserted above.
                try:
                    _asset_rows = (
                        sb.table("rekordbox_analysis_assets")
                        .select("id, asset_type")
                        .eq("track_id", track_id)
                        .execute()
                    )
                    asset_ids: Dict[str, Optional[str]] = {
                        a["asset_type"]: a["id"]
                        for a in (_asset_rows.data or [])
                    }
                except Exception as _exc:
                    logger.warning("Failed to fetch asset IDs for track %s: %s", track_id, _exc)
                    asset_ids = {}

                bg = None  # BeatGridResult; passed to phrase extraction

                try:
                    from dropdex_importer.beatgrid_parser import extract_beat_grid  # noqa: PLC0415
                    from .analysis_feature_writer import write_beat_grid  # noqa: PLC0415
                    bg = extract_beat_grid(bundle.dat, bundle.ext)
                    if bg is not None:
                        src_id = asset_ids.get("DAT") or asset_ids.get("EXT")
                        ok = write_beat_grid(sb, import_id, track_id, bg, src_id, DROPDEX_ANLZ_PARSER_VERSION)
                        feature_statuses["beat_grid"] = "completed" if ok else "failed"
                    else:
                        feature_statuses["beat_grid"] = "skipped"
                except Exception as exc:
                    logger.error("Beat grid extraction failed for track %s: %s", track_id, exc)
                    feature_statuses["beat_grid"] = "failed"

                try:
                    from dropdex_importer.waveform_parser import extract_waveforms  # noqa: PLC0415
                    from .analysis_feature_writer import write_waveform  # noqa: PLC0415
                    wf = extract_waveforms(bundle.dat, bundle.ext)
                    ok = write_waveform(sb, import_id, track_id, wf, user_id, asset_ids, DROPDEX_ANLZ_PARSER_VERSION)
                    has_content = wf.preview is not None or wf.detail is not None
                    if not ok:
                        feature_statuses["waveform"] = "failed"
                    elif not has_content:
                        feature_statuses["waveform"] = "skipped"
                    else:
                        feature_statuses["waveform"] = "completed"
                except Exception as exc:
                    logger.error("Waveform extraction failed for track %s: %s", track_id, exc)
                    feature_statuses["waveform"] = "failed"

                try:
                    from dropdex_importer.cue_parser import parse_anlz_cues  # noqa: PLC0415
                    from .analysis_feature_writer import reconcile_and_write_cues  # noqa: PLC0415
                    cue_entries, cue_warns = parse_anlz_cues(bundle.dat, bundle.ext)
                    ok = reconcile_and_write_cues(sb, import_id, track_id, cue_entries, cue_warns)
                    feature_statuses["cues"] = "completed" if ok else "failed"
                except Exception as exc:
                    logger.error("Cue extraction failed for track %s: %s", track_id, exc)
                    feature_statuses["cues"] = "failed"

                try:
                    from dropdex_importer.phrase_parser import extract_phrases  # noqa: PLC0415
                    from .analysis_feature_writer import write_phrases  # noqa: PLC0415
                    phrase_entries, _pw = extract_phrases(bundle.ext, bg)
                    ok = write_phrases(sb, import_id, track_id, phrase_entries, DROPDEX_ANLZ_PARSER_VERSION)
                    if not ok:
                        feature_statuses["phrases"] = "failed"
                    elif not phrase_entries:
                        feature_statuses["phrases"] = "skipped"
                    else:
                        feature_statuses["phrases"] = "completed"
                except Exception as exc:
                    logger.error("Phrase extraction failed for track %s: %s", track_id, exc)
                    feature_statuses["phrases"] = "failed"

                # Update track parse status (including feature statuses)
                overall = bundle.overall_status
                try:
                    sb.table("rekordbox_tracks").update({
                        "analysis_parse_status": overall,
                        "analysis_parse_warnings": [w.as_dict() for w in (bundle.warnings or [])],
                        "analysis_feature_statuses": feature_statuses,
                    }).eq("id", track_id).execute()
                except Exception as exc:
                    logger.error("Failed to update track %s: %s", track_id, exc)

                if overall == "completed":
                    completed_count += 1
                elif overall == "partial":
                    partial_count += 1
                else:
                    failed_count += 1

                all_warnings = [w.as_dict() for w in (bundle.warnings or [])]
                for asset_obj in (bundle.dat, bundle.ext, bundle.two_ex):
                    if asset_obj:
                        all_warnings.extend(w.as_dict() for w in asset_obj.warnings)

                track_results.append(TrackCompleteStatus(
                    track_id=track_id,
                    rekordbox_content_id=rb_cid,
                    parse_status=overall,
                    assets_parsed=parsed_count,
                    warnings=all_warnings,
                ))

        total_tracks = len(write_result.manifest)

        if total_tracks == 0:
            final_status = "not_requested"
        elif (
            missing_required_count == total_tracks
            and completed_count == 0
            and partial_count == 0
        ):
            final_status = "failed"
        elif failed_count > 0 or partial_count > 0 or missing_required_count > 0:
            final_status = "partial"
        else:
            final_status = "completed"

        try:
            sb.table("rekordbox_imports").update({
                "analysis_status": final_status,
                "source_bundle_type": "zip_bundle",
                "analysis_expected_track_count": total_tracks,
                "analysis_matched_track_count": matched_track_count,
                "analysis_parsed_track_count": completed_count + partial_count,
                "analysis_failed_track_count": failed_count + missing_required_count,
                "analysis_asset_count": total_asset_count,
                "analysis_parser_version": DROPDEX_ANLZ_PARSER_VERSION,
                "analysis_completed_at": _now_iso(),
            }).eq("id", import_id).execute()
        except Exception as exc:
            logger.error("Failed to update import %s status: %s", import_id, exc)

        return CompleteResponse(
            import_id=import_id,
            analysis_status=final_status,
            total_tracks=total_tracks,
            completed_count=completed_count,
            partial_count=partial_count,
            failed_count=failed_count,
            missing_required_count=missing_required_count,
            missing_optional_ext_count=missing_optional_ext_count,
            missing_optional_2ex_count=missing_optional_2ex_count,
            parser_version=DROPDEX_ANLZ_PARSER_VERSION,
            tracks=track_results,
        )

    finally:
        if db_tmp_path and os.path.exists(db_tmp_path):
            os.unlink(db_tmp_path)
        if tmp_dir and os.path.exists(tmp_dir):
            shutil.rmtree(tmp_dir, ignore_errors=True)
