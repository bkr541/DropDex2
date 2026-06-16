"""
Staged Rekordbox USB analysis import service.

Implements the three-phase workflow:
  1. start_analysis_import   — parse exportLibrary.db, persist, return manifest
  2. process_analysis_batch  — validate and upload ANLZ files to Storage
  3. complete_analysis_import — download, parse, persist analysis results
  4. get_analysis_status      — read-only status query

Security invariants
-------------------
- user_id comes exclusively from the validated JWT; never from form data.
- Every import lookup is scoped to the JWT user via .eq("user_id", user_id).
- Traversal attacks are blocked before any filesystem or Storage operation.
- Error messages never expose server paths, schema details, or credentials.
- A failed analysis phase does not delete the successfully imported metadata.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import HTTPException, UploadFile

from .config import settings
from .models import (
    AnalysisStatusResponse,
    BatchFileResult,
    BatchUploadResponse,
    CompleteResponse,
    ImportStartResponse,
    ManifestEntryResponse,
    TrackCompleteStatus,
)
from .rekordbox_parser import parse_library
from .supabase_writer import write_to_supabase_full
from .user_settings import upsert_active_import
from .validation import validate

logger = logging.getLogger(__name__)

_VALID_ANLZ_SUFFIXES = frozenset({".dat", ".ext", ".2ex"})
_ASSET_EXT_MAP = {"DAT": ".DAT", "EXT": ".EXT", "2EX": ".2EX"}
_ANALYSIS_BUCKET = "rekordbox-analysis-assets"

# Module-level ANLZ parser version constant — imported once to avoid repeated
# deferred imports.  Falls back to "unknown" if pyrekordbox is absent.
try:
    from dropdex_importer.anlz_parser import DROPDEX_ANLZ_PARSER_VERSION as _PARSER_VERSION
except ImportError:  # pragma: no cover
    _PARSER_VERSION = "unknown"


def _parse_bundle(
    dat_path: Optional[str] = None,
    ext_path: Optional[str] = None,
    two_ex_path: Optional[str] = None,
):
    """
    Module-level wrapper around parse_track_analysis_bundle.

    Declared at module scope so tests can patch
    ``app.analysis_import_service._parse_bundle``.
    """
    from dropdex_importer.anlz_parser import parse_track_analysis_bundle  # noqa: PLC0415
    return parse_track_analysis_bundle(
        dat_path=dat_path, ext_path=ext_path, two_ex_path=two_ex_path
    )


# ── Supabase client ────────────────────────────────────────────────────────────

def _create_supabase():
    """Return a service-role Supabase client. Import is deferred so tests can patch."""
    import supabase as _sb  # noqa: PLC0415
    return _sb.create_client(settings.supabase_url, settings.supabase_secret_key)


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _build_storage_path(user_id: str, import_id: str, canonical_path: str) -> str:
    """Return {user_id}/{import_id}/anlz/{canonical_path} for Storage."""
    return f"{user_id}/{import_id}/anlz/{canonical_path.lstrip('/')}"


def _require_import_for_user(sb, import_id: str, user_id: str) -> dict:
    """Fetch import row scoped to user_id. Raises HTTP 404 if not found."""
    resp = (
        sb.table("rekordbox_imports")
        .select(
            "id, analysis_status, analysis_expected_track_count, "
            "analysis_matched_track_count, analysis_parsed_track_count, "
            "analysis_failed_track_count, analysis_asset_count, "
            "analysis_parser_version, analysis_warnings"
        )
        .eq("id", import_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if resp.data is None:
        raise HTTPException(status_code=404, detail="Import not found.")
    return resp.data


def _get_tracks_with_paths(sb, import_id: str) -> List[dict]:
    """Return all tracks for this import that have an analysis_data_file_path."""
    resp = (
        sb.table("rekordbox_tracks")
        .select("id, rekordbox_content_id, analysis_data_file_path")
        .eq("import_id", import_id)
        .execute()
    )
    return [t for t in (resp.data or []) if t.get("analysis_data_file_path")]


def _build_path_map(tracks: List[dict]) -> Dict[str, dict]:
    """
    Build a lower(canonical_path) → {track_id, asset_type} map covering all
    three siblings (DAT, EXT, 2EX) for every track.
    """
    from dropdex_importer.analysis_paths import (  # noqa: PLC0415
        derive_anlz_siblings,
        normalize_anlz_path,
    )

    path_map: Dict[str, dict] = {}
    for track in tracks:
        raw = track.get("analysis_data_file_path") or ""
        canonical = normalize_anlz_path(raw)
        if not canonical:
            continue
        dat_path, ext_path, two_ex_path = derive_anlz_siblings(canonical)
        for path, asset_type in (
            (dat_path, "DAT"),
            (ext_path, "EXT"),
            (two_ex_path, "2EX"),
        ):
            path_map[path.lower()] = {"track_id": track["id"], "asset_type": asset_type}
    return path_map


def _get_existing_asset(sb, import_id: str, relative_path_lower: str) -> Optional[dict]:
    """Return an existing analysis asset row, or None."""
    resp = (
        sb.table("rekordbox_analysis_assets")
        .select("id, sha256, upload_status")
        .eq("import_id", import_id)
        .eq("relative_path", relative_path_lower)
        .maybe_single()
        .execute()
    )
    return resp.data


def _upsert_asset(sb, asset_data: dict) -> None:
    """Insert or update a rekordbox_analysis_assets row (check-then-write)."""
    existing = (
        sb.table("rekordbox_analysis_assets")
        .select("id")
        .eq("import_id", asset_data["import_id"])
        .eq("relative_path", asset_data["relative_path"])
        .maybe_single()
        .execute()
    )
    if existing.data:
        update_payload = {k: v for k, v in asset_data.items() if k != "import_id"}
        sb.table("rekordbox_analysis_assets").update(update_payload).eq("id", existing.data["id"]).execute()
    else:
        sb.table("rekordbox_analysis_assets").insert(asset_data).execute()


def _upload_content_to_storage(sb, storage_path: str, content: bytes) -> bool:
    """Upload bytes to Supabase Storage. Returns True on success."""
    try:
        sb.storage.from_(_ANALYSIS_BUCKET).upload(
            path=storage_path,
            file=content,
            file_options={"upsert": "true"},
        )
        return True
    except Exception as exc:
        logger.error("Storage upload failed at %s: %s", storage_path, exc)
        return False


def _build_manifest_entries(write_result) -> List[ManifestEntryResponse]:
    """Convert ImportWriteResult manifest into response models."""
    entries: List[ManifestEntryResponse] = []
    rb_to_sb = write_result.rb_to_sb_track
    for m in write_result.manifest:
        track_id = rb_to_sb.get(m.rekordbox_content_id)
        if not track_id:
            continue
        dat_spec = next((f for f in m.files if f.asset_type == "DAT"), None)
        ext_spec = next((f for f in m.files if f.asset_type == "EXT"), None)
        two_ex_spec = next((f for f in m.files if f.asset_type == "2EX"), None)
        entries.append(ManifestEntryResponse(
            track_id=track_id,
            rekordbox_content_id=m.rekordbox_content_id,
            dat_path=dat_spec.normalized_path if dat_spec else None,
            ext_path=ext_spec.normalized_path if ext_spec else None,
            two_ex_path=two_ex_spec.normalized_path if two_ex_spec else None,
            dat_required=True,
        ))
    return entries


# ── Service functions ──────────────────────────────────────────────────────────


async def start_analysis_import(file: UploadFile, user_id: str) -> ImportStartResponse:
    """
    Parse exportLibrary.db, persist it to Supabase, and return the analysis manifest.
    """
    filename = file.filename or "upload"
    if not filename.lower().endswith(".db"):
        raise HTTPException(
            status_code=422,
            detail="Only .db files are accepted. Please upload your rekordbox exportLibrary.db file.",
        )

    content = await file.read()
    limit = settings.max_rekordbox_db_upload_bytes
    if len(content) > limit:
        limit_mb = limit // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the maximum allowed size of {limit_mb} MB.",
        )

    tmp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            tmp_path = tmp.name
            tmp.write(content)

        try:
            library = parse_library(tmp_path)
        except ImportError:
            logger.exception("dropdex_importer not available")
            raise HTTPException(
                status_code=500,
                detail="The server is not configured to parse rekordbox databases. Contact the administrator.",
            )
        except Exception:
            logger.exception("Parser error for user %s", user_id)
            raise HTTPException(
                status_code=422,
                detail="Could not parse the uploaded file. Please confirm it is a valid rekordbox exportLibrary.db.",
            )

        result = validate(library)
        if not result.ok:
            logger.warning("Validation errors: %s", result.errors)
            raise HTTPException(
                status_code=422,
                detail=f"Library validation failed: {'; '.join(result.errors)}",
            )

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

        try:
            upsert_active_import(
                settings.supabase_url,
                settings.supabase_secret_key,
                user_id,
                import_id,
            )
        except Exception:
            logger.warning("Failed to set active import for user %s", user_id)

        manifest = _build_manifest_entries(write_result)
        analysis_status = "awaiting_upload" if manifest else "not_requested"

        return ImportStartResponse(
            import_id=import_id,
            analysis_status=analysis_status,
            expected_track_count=len(manifest),
            manifest=manifest,
        )

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
            logger.debug("Deleted temp file %s", tmp_path)


async def process_analysis_batch(
    import_id: str,
    user_id: str,
    files: List[UploadFile],
) -> BatchUploadResponse:
    """
    Accept ANLZ file uploads, validate against the import manifest, and store.

    Each file's upload.filename must be the canonical ANLZ path
    (e.g. PIONEER/USBANLZ/P001/ANLZ0000.DAT).  Paths are validated for
    traversal attacks before any content is read.
    """
    from dropdex_importer.analysis_paths import is_safe_path, normalize_anlz_path  # noqa: PLC0415

    sb = _create_supabase()
    _require_import_for_user(sb, import_id, user_id)

    if len(files) > settings.max_analysis_files_per_batch:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Too many files in batch. Maximum is "
                f"{settings.max_analysis_files_per_batch} per batch."
            ),
        )

    tracks = _get_tracks_with_paths(sb, import_id)
    path_map = _build_path_map(tracks)

    results: List[BatchFileResult] = []
    total_batch_bytes = 0

    for upload in files:
        raw_path = upload.filename or ""

        if not raw_path or not is_safe_path(raw_path):
            results.append(BatchFileResult(
                canonical_path=raw_path or "(empty)",
                status="rejected",
                reject_reason="Invalid file path.",
            ))
            continue

        suffix = Path(raw_path).suffix.lower()
        if suffix not in _VALID_ANLZ_SUFFIXES:
            results.append(BatchFileResult(
                canonical_path=raw_path,
                status="rejected",
                reject_reason="File is not a supported ANLZ analysis file (.DAT, .EXT, or .2EX).",
            ))
            continue

        content = await upload.read()
        file_size = len(content)

        if file_size > settings.max_analysis_file_bytes:
            limit_mb = settings.max_analysis_file_bytes // (1024 * 1024)
            results.append(BatchFileResult(
                canonical_path=raw_path,
                status="rejected",
                file_size=file_size,
                reject_reason=f"File exceeds the maximum allowed size of {limit_mb} MB.",
            ))
            continue

        total_batch_bytes += file_size
        if total_batch_bytes > settings.max_analysis_batch_bytes:
            results.append(BatchFileResult(
                canonical_path=raw_path,
                status="rejected",
                reject_reason="Batch size limit exceeded. Please send a smaller batch.",
            ))
            continue

        canonical = normalize_anlz_path(raw_path)
        if canonical is None:
            results.append(BatchFileResult(
                canonical_path=raw_path,
                status="rejected",
                reject_reason="Invalid file path.",
            ))
            continue

        canonical_lower = canonical.lower()
        track_info = path_map.get(canonical_lower)
        if track_info is None:
            results.append(BatchFileResult(
                canonical_path=canonical,
                status="rejected",
                reject_reason=(
                    "File path does not match any expected analysis file for this import."
                ),
            ))
            continue

        sha256 = _sha256_bytes(content)
        existing = _get_existing_asset(sb, import_id, canonical_lower)
        if existing and existing.get("sha256") == sha256:
            results.append(BatchFileResult(
                canonical_path=canonical,
                status="already_received",
                sha256=sha256,
                file_size=file_size,
            ))
            continue

        storage_path = _build_storage_path(user_id, import_id, canonical)
        if not _upload_content_to_storage(sb, storage_path, content):
            results.append(BatchFileResult(
                canonical_path=canonical,
                status="error",
                reject_reason="Upload failed. Please try again.",
            ))
            continue

        _upsert_asset(sb, {
            "import_id": import_id,
            "track_id": track_info["track_id"],
            "asset_type": track_info["asset_type"],
            "relative_path": canonical_lower,
            "original_filename": Path(raw_path).name,
            "sha256": sha256,
            "size_bytes": file_size,
            "storage_bucket": _ANALYSIS_BUCKET,
            "storage_path": storage_path,
            "upload_status": "uploaded",
            "parse_status": "not_requested",
            "uploaded_at": _now_iso(),
        })

        results.append(BatchFileResult(
            canonical_path=canonical,
            status="received",
            sha256=sha256,
            file_size=file_size,
        ))

    received = sum(1 for r in results if r.status == "received")
    already_received = sum(1 for r in results if r.status == "already_received")
    rejected = sum(1 for r in results if r.status in ("rejected", "error"))

    return BatchUploadResponse(
        import_id=import_id,
        received_count=received,
        already_received_count=already_received,
        rejected_count=rejected,
        files=results,
    )


async def complete_analysis_import(import_id: str, user_id: str) -> CompleteResponse:
    """
    Download all uploaded ANLZ assets, parse them, and persist analysis results.
    """
    sb = _create_supabase()
    _require_import_for_user(sb, import_id, user_id)

    assets_resp = (
        sb.table("rekordbox_analysis_assets")
        .select("id, track_id, asset_type, relative_path, storage_path, sha256")
        .eq("import_id", import_id)
        .eq("upload_status", "uploaded")
        .execute()
    )
    uploaded_assets: List[dict] = assets_resp.data or []

    assets_by_track: Dict[str, List[dict]] = {}
    for asset in uploaded_assets:
        tid = asset.get("track_id")
        if tid:
            assets_by_track.setdefault(tid, []).append(asset)

    tracks = _get_tracks_with_paths(sb, import_id)

    track_results: List[TrackCompleteStatus] = []
    completed_count = partial_count = failed_count = missing_required_count = 0

    tmp_dir: Optional[str] = None
    try:
        tmp_dir = tempfile.mkdtemp()

        for track in tracks:
            track_id = track["id"]
            rb_cid = str(track.get("rekordbox_content_id", ""))
            track_assets = assets_by_track.get(track_id, [])

            dat_asset = next((a for a in track_assets if a["asset_type"] == "DAT"), None)
            if not dat_asset:
                missing_required_count += 1
                track_results.append(TrackCompleteStatus(
                    track_id=track_id,
                    rekordbox_content_id=rb_cid,
                    parse_status="missing_required",
                    assets_parsed=0,
                    warnings=[{
                        "code": "SIBLING_MISSING",
                        "asset_type": "DAT",
                        "message": "Required DAT file was not uploaded.",
                        "detail": None,
                    }],
                ))
                continue

            local_paths: Dict[str, Optional[str]] = {"DAT": None, "EXT": None, "2EX": None}
            for asset in track_assets:
                atype = asset["asset_type"]
                ext_suffix = _ASSET_EXT_MAP.get(atype, ".dat")
                local_path = os.path.join(tmp_dir, f"{asset['id']}{ext_suffix}")
                try:
                    file_bytes = sb.storage.from_(_ANALYSIS_BUCKET).download(asset["storage_path"])
                    with open(local_path, "wb") as fh:
                        fh.write(file_bytes)
                    local_paths[atype] = local_path
                except Exception as exc:
                    logger.error("Failed to download asset %s: %s", asset["id"], exc)

            try:
                bundle = _parse_bundle(
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
                    warnings=[{
                        "code": "PARSE_ERROR",
                        "asset_type": "BUNDLE",
                        "message": "An error occurred while parsing analysis files.",
                        "detail": None,
                    }],
                ))
                continue

            parsed_count = 0
            asset_lookup = {a["asset_type"]: a for a in track_assets}
            for atype, result_obj in (
                ("DAT", bundle.dat),
                ("EXT", bundle.ext),
                ("2EX", bundle.two_ex),
            ):
                asset_row = asset_lookup.get(atype)
                if asset_row and result_obj:
                    try:
                        sb.table("rekordbox_analysis_assets").update({
                            "parse_status": (
                                "completed"
                                if result_obj.parse_status == "partial"
                                else result_obj.parse_status
                            ),
                            "parser_version": _PARSER_VERSION,
                            "parse_warnings": [w.as_dict() for w in result_obj.warnings],
                            "parsed_at": _now_iso(),
                        }).eq("id", asset_row["id"]).execute()
                    except Exception as exc:
                        logger.error("Failed to update asset %s: %s", asset_row["id"], exc)
                    if result_obj.parse_status in ("completed", "partial"):
                        parsed_count += 1

            overall = bundle.overall_status
            try:
                sb.table("rekordbox_tracks").update({
                    "analysis_parse_status": overall,
                    "analysis_parse_warnings": [w.as_dict() for w in (bundle.warnings or [])],
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

    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    total_tracks = len(tracks)

    if total_tracks == 0:
        final_status = "completed"
    elif missing_required_count == total_tracks and completed_count == 0 and partial_count == 0:
        final_status = "failed"
    elif failed_count > 0 or partial_count > 0 or missing_required_count > 0:
        final_status = "partial"
    else:
        final_status = "completed"

    try:
        sb.table("rekordbox_imports").update({
            "analysis_status": final_status,
            "analysis_parsed_track_count": completed_count + partial_count,
            "analysis_failed_track_count": failed_count + missing_required_count,
            "analysis_parser_version": _PARSER_VERSION,
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
        parser_version=_PARSER_VERSION,
        tracks=track_results,
    )


async def get_analysis_status(import_id: str, user_id: str) -> AnalysisStatusResponse:
    """Return current analysis status for an import."""
    from dropdex_importer.analysis_paths import (  # noqa: PLC0415
        derive_anlz_siblings,
        normalize_anlz_path,
    )

    sb = _create_supabase()
    import_row = _require_import_for_user(sb, import_id, user_id)

    tracks = _get_tracks_with_paths(sb, import_id)

    uploaded_resp = (
        sb.table("rekordbox_analysis_assets")
        .select("relative_path")
        .eq("import_id", import_id)
        .eq("asset_type", "DAT")
        .eq("upload_status", "uploaded")
        .execute()
    )
    uploaded_dat_paths = {
        r["relative_path"].lower()
        for r in (uploaded_resp.data or [])
    }

    missing_required: List[str] = []
    for track in tracks:
        raw = track.get("analysis_data_file_path") or ""
        canonical = normalize_anlz_path(raw)
        if not canonical:
            continue
        dat_path, _, _ = derive_anlz_siblings(canonical)
        if dat_path.lower() not in uploaded_dat_paths:
            missing_required.append(dat_path)

    return AnalysisStatusResponse(
        import_id=import_id,
        analysis_status=import_row.get("analysis_status") or "unknown",
        expected_track_count=import_row.get("analysis_expected_track_count", 0),
        matched_track_count=import_row.get("analysis_matched_track_count", 0),
        parsed_track_count=import_row.get("analysis_parsed_track_count", 0),
        failed_track_count=import_row.get("analysis_failed_track_count", 0),
        asset_count=import_row.get("analysis_asset_count", 0),
        missing_required_paths=missing_required,
        parser_version=import_row.get("analysis_parser_version"),
        warnings=import_row.get("analysis_warnings") or [],
    )
