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
import inspect
import logging
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dropdex_importer.supabase_writer import RekordboxWriteError
from fastapi import HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from .config import settings
from .import_jobs import (
    ImportCancelledError,
    assert_import_not_cancelled,
    complete_import_job,
    local_cancellation_requested,
    mark_import_failed,
    transition_import_job,
)
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
from .rescan_service import copy_normalized_data_for_track, match_tracks_to_prior_import
from .supabase_writer import write_to_supabase_full
from .upload_stream import read_upload_bounded, stream_upload_to_temp
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


def _import_error_detail(
    import_id: str | None,
    error_code: str,
    message: str,
    *,
    retryable: bool,
):
    if not import_id:
        return message
    return {
        "error_code": error_code,
        "detail": message,
        "retryable": retryable,
    }


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _build_storage_path(user_id: str, import_id: str, canonical_path: str) -> str:
    """Return {user_id}/{import_id}/anlz/{canonical_path} for Storage.

    First segment is user_id so the Storage RLS policy
    ``(storage.foldername(name))[1] = auth.uid()::text`` allows owners to read
    their own objects.
    """
    try:
        from dropdex_importer.analysis_paths import build_storage_path as _bp  # noqa: PLC0415

        return _bp(user_id, import_id, canonical_path)
    except (ImportError, AttributeError):
        return f"{user_id}/{import_id}/anlz/{canonical_path.lstrip('/')}"


def _require_import_for_user(sb, import_id: str, user_id: str) -> dict:
    """Fetch import row scoped to user_id. Raises HTTP 404 if not found."""
    resp = (
        sb.table("rekordbox_imports")
        .select(
            "id, status, error_code, error_message, retryable, analysis_status, analysis_expected_track_count, "
            "analysis_matched_track_count, analysis_parsed_track_count, "
            "analysis_failed_track_count, analysis_asset_count, "
            "analysis_parser_version, analysis_warnings"
        )
        .eq("id", import_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    # supabase-py ≥2.x returns None (not APIResponse(data=None)) when 0 rows match
    data = resp.data if resp is not None else None
    if data is None:
        raise HTTPException(status_code=404, detail="Import not found.")
    return data


def _get_tracks_with_paths(sb, import_id: str) -> List[dict]:
    """Return ALL tracks for this import that have an analysis_data_file_path.

    Uses pagination so imports larger than 1,000 tracks are fully represented.
    """
    from .supabase_pagination import fetch_all_rows  # noqa: PLC0415

    rows = fetch_all_rows(
        lambda: (
            sb.table("rekordbox_tracks")
            .select("id, rekordbox_content_id, analysis_data_file_path")
            .eq("import_id", import_id)
        ),
        order_column="id",
    )
    return [t for t in rows if t.get("analysis_data_file_path")]


def _get_tracks_for_rescan(sb, import_id: str) -> List[dict]:
    """Return ALL tracks for this import with full identity fields for rescan matching.

    Uses pagination so imports larger than 1,000 tracks are fully represented.
    """
    from .supabase_pagination import fetch_all_rows  # noqa: PLC0415

    return fetch_all_rows(
        lambda: (
            sb.table("rekordbox_tracks")
            .select(
                "id, rekordbox_content_id, analysis_data_file_path, "
                "master_db_id, master_content_id, "
                "analysis_data_update_count, cue_update_count, information_update_count"
            )
            .eq("import_id", import_id)
        ),
        order_column="id",
    )


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
    return resp.data if resp is not None else None


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
    existing_data = existing.data if existing is not None else None
    if existing_data:
        update_payload = {k: v for k, v in asset_data.items() if k != "import_id"}
        sb.table("rekordbox_analysis_assets").update(update_payload).eq(
            "id", existing_data["id"]
        ).execute()
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


def _prepare_analysis_batch(import_id: str, user_id: str):
    """Load batch metadata with blocking Supabase work outside the event loop."""
    sb = _create_supabase()
    import_row = _require_import_for_user(sb, import_id, user_id)
    if import_row.get("status") in {"cancel_requested", "cancelled", "failed"}:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": (
                    "IMPORT_CANCELLED" if import_row.get("status") != "failed" else "IMPORT_FAILED"
                ),
                "detail": import_row.get("error_message")
                or f"Import is {import_row.get('status')}.",
                "retryable": bool(import_row.get("retryable")),
            },
        )
    try:
        (
            sb.table("rekordbox_imports")
            .update({"analysis_status": "uploading"})
            .eq("id", import_id)
            .execute()
        )
    except Exception as exc:
        logger.warning("Failed to set analysis_status=uploading for %s: %s", import_id, exc)
    tracks = _get_tracks_with_paths(sb, import_id)
    return sb, _build_path_map(tracks)


def _persist_analysis_upload(
    sb,
    *,
    import_id: str,
    user_id: str,
    canonical: str,
    raw_path: str,
    content: bytes,
    track_info: dict,
) -> tuple[str, str, int]:
    """Persist one bounded ANLZ payload without blocking the async request loop."""
    canonical_lower = canonical.lower()
    sha256 = _sha256_bytes(content)
    existing = _get_existing_asset(sb, import_id, canonical_lower)
    if existing and existing.get("sha256") == sha256:
        return "already_received", sha256, len(content)

    try:
        assert_import_not_cancelled(import_id, user_id, sb=sb)
    except ImportCancelledError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "IMPORT_CANCELLED",
                "detail": "Import was cancelled.",
                "retryable": False,
            },
        ) from exc

    storage_path = _build_storage_path(user_id, import_id, canonical)
    if not _upload_content_to_storage(sb, storage_path, content):
        return "error", sha256, len(content)

    try:
        assert_import_not_cancelled(import_id, user_id, sb=sb)
        _upsert_asset(
            sb,
            {
                "import_id": import_id,
                "track_id": track_info["track_id"],
                "asset_type": track_info["asset_type"],
                "relative_path": canonical_lower,
                "original_filename": Path(raw_path).name,
                "sha256": sha256,
                "size_bytes": len(content),
                "storage_bucket": _ANALYSIS_BUCKET,
                "storage_path": storage_path,
                "upload_status": "uploaded",
                "parse_status": "not_requested",
                "uploaded_at": _now_iso(),
            },
        )
    except Exception as exc:
        try:
            sb.storage.from_(_ANALYSIS_BUCKET).remove([storage_path])
        except Exception:
            logger.warning("Could not remove uncommitted analysis object %s", storage_path)
        try:
            assert_import_not_cancelled(import_id, user_id, sb=sb)
        except ImportCancelledError as cancelled:
            raise HTTPException(
                status_code=409,
                detail={
                    "error_code": "IMPORT_CANCELLED",
                    "detail": "Import was cancelled.",
                    "retryable": False,
                },
            ) from cancelled
        raise exc
    return "received", sha256, len(content)


def _build_manifest_entries(write_result) -> List[ManifestEntryResponse]:
    """Convert ImportWriteResult manifest into response models."""
    from dropdex_importer.analysis_paths import (  # noqa: PLC0415
        derive_anlz_siblings,
        normalize_anlz_path,
    )

    entries: List[ManifestEntryResponse] = []
    rb_to_sb = write_result.rb_to_sb_track
    for m in write_result.manifest:
        track_id = rb_to_sb.get(m.rekordbox_content_id)
        if not track_id:
            continue
        # Re-derive sibling paths via the canonical normalizer (no leading slash)
        # so the manifest paths match what webkitRelativePath returns in the browser.
        # parser.normalize_analysis_path adds a leading "/" that causes path-map misses.
        canonical = normalize_anlz_path(m.original_analysis_path)
        if canonical:
            dat_path, ext_path, two_ex_path = derive_anlz_siblings(canonical)
        else:
            dat_path, ext_path, two_ex_path = None, None, None
        entries.append(
            ManifestEntryResponse(
                track_id=track_id,
                rekordbox_content_id=m.rekordbox_content_id,
                dat_path=dat_path,
                ext_path=ext_path,
                two_ex_path=two_ex_path,
                dat_required=True,
            )
        )
    return entries


# ── Service functions ──────────────────────────────────────────────────────────


def _write_library_for_job(library, user_id: str, import_id: str | None):
    try:
        parameters = inspect.signature(write_to_supabase_full).parameters
    except (TypeError, ValueError):
        parameters = {}
    supports_job = "import_id" in parameters or any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()
    )
    if import_id and supports_job:
        return write_to_supabase_full(
            library,
            settings.supabase_url,
            settings.supabase_secret_key,
            user_id,
            import_id=import_id,
            finalize_status=None,
            should_cancel=lambda: local_cancellation_requested(import_id),
        )
    return write_to_supabase_full(
        library, settings.supabase_url, settings.supabase_secret_key, user_id
    )


async def start_analysis_import(
    file: UploadFile,
    user_id: str,
    device_name: str | None = None,
    import_id: str | None = None,
) -> ImportStartResponse:
    """
    Parse exportLibrary.db, persist it to Supabase, and return the analysis manifest.

    Incremental rescan (Part D): after tracks are written, checks prior completed
    imports to find unchanged tracks whose analysis data can be reused without
    re-uploading ANLZ files.
    """
    precreated_job = import_id is not None
    filename = file.filename or "upload"
    if not filename.lower().endswith(".db"):
        message = "Only .db files are accepted. Please upload your rekordbox exportLibrary.db file."
        if import_id:
            await run_in_threadpool(
                mark_import_failed,
                import_id,
                user_id,
                error_code="INVALID_DATABASE_FILE",
                message=message,
                retryable=False,
            )
        await file.close()
        raise HTTPException(
            status_code=422,
            detail=_import_error_detail(
                import_id,
                "INVALID_DATABASE_FILE",
                message,
                retryable=False,
            ),
        )

    tmp_path: Optional[str] = None
    try:
        if import_id:
            await run_in_threadpool(
                transition_import_job,
                import_id,
                user_id,
                expected_states={"created"},
                new_state="uploading",
            )
        tmp_path, _ = await stream_upload_to_temp(
            file,
            max_bytes=settings.max_rekordbox_db_upload_bytes,
            suffix=".db",
            cancellation_requested=lambda: local_cancellation_requested(import_id),
        )
        if import_id:
            await run_in_threadpool(assert_import_not_cancelled, import_id, user_id)
            await run_in_threadpool(
                transition_import_job,
                import_id,
                user_id,
                expected_states={"uploading"},
                new_state="queued",
                updates={"upload_completed_at": _now_iso()},
            )
            await run_in_threadpool(
                transition_import_job,
                import_id,
                user_id,
                expected_states={"queued"},
                new_state="processing",
                updates={"processing_started_at": _now_iso()},
            )

        try:
            library = await run_in_threadpool(parse_library, tmp_path)
        except ImportError:
            logger.exception("dropdex_importer not available")
            raise HTTPException(
                status_code=500,
                detail=_import_error_detail(
                    import_id,
                    "IMPORTER_UNAVAILABLE",
                    "The server is not configured to parse Rekordbox databases.",
                    retryable=False,
                ),
            )
        except Exception:
            logger.exception("Parser error for user %s", user_id)
            raise HTTPException(
                status_code=422,
                detail=_import_error_detail(
                    import_id,
                    "DATABASE_PARSE_FAILED",
                    "Could not parse the uploaded file. Please confirm it is a valid Rekordbox exportLibrary.db.",
                    retryable=False,
                ),
            )

        if device_name and not library.device_name:
            library.device_name = device_name

        result = await run_in_threadpool(validate, library)
        if not result.ok:
            logger.warning("Validation errors: %s", result.errors)
            raise HTTPException(
                status_code=422,
                detail=_import_error_detail(
                    import_id,
                    "LIBRARY_VALIDATION_FAILED",
                    f"Library validation failed: {'; '.join(result.errors)}",
                    retryable=False,
                ),
            )

        try:
            write_result = await run_in_threadpool(
                _write_library_for_job, library, user_id, import_id
            )
        except RekordboxWriteError as exc:
            if import_id:
                await run_in_threadpool(assert_import_not_cancelled, import_id, user_id)
            # Stage-aware diagnostic — safe fields only, no credentials or raw SQL.
            logger.error(
                "Supabase write failed for user %s stage=%s table=%s code=%s",
                user_id,
                exc.stage,
                exc.table,
                exc.db_code,
            )
            detail: dict = {
                "error_code": "REKORDBOX_IMPORT_WRITE_FAILED",
                "stage": exc.stage,
                "table": exc.table,
                "retryable": True,
            }
            if exc.db_code == "22P02":
                detail["detail"] = (
                    "DropDex parsed your Rekordbox library, but a field in the database "
                    "record has an unexpected format. This is a bug — please report it."
                )
                detail["diagnostic"] = "Invalid value syntax for a database column."
                detail["retryable"] = False
            elif exc.db_code == "PGRST204":
                detail["detail"] = (
                    "DropDex parsed your Rekordbox library, but the DropDex database "
                    "schema is missing a required column. Apply the pending migrations and try again."
                )
                detail["diagnostic"] = "Required database column is missing."
                detail["retryable"] = False
            elif exc.db_code in ("42501", "42P01"):
                detail["detail"] = (
                    "DropDex parsed your Rekordbox library, but the server could not "
                    "save it because the database connection is not authorized."
                )
                detail["diagnostic"] = "Database permission or credential problem."
                detail["retryable"] = False
            else:
                detail["detail"] = (
                    "DropDex parsed your Rekordbox library, but could not save the "
                    f"track records ({exc.stage}). Check the backend log for details."
                )
                if exc.db_code:
                    detail["diagnostic"] = f"Database error code: {exc.db_code}"
            raise HTTPException(status_code=500, detail=detail)
        except Exception:
            if import_id:
                await run_in_threadpool(assert_import_not_cancelled, import_id, user_id)
            logger.exception("Supabase write failed for user %s", user_id)
            raise HTTPException(
                status_code=500,
                detail={
                    "error_code": "REKORDBOX_IMPORT_WRITE_FAILED",
                    "stage": "unknown",
                    "detail": "DropDex parsed your Rekordbox library, but could not save it. Please try again.",
                    "retryable": True,
                },
            )

        import_id = write_result.import_id

        if not precreated_job:
            try:
                await run_in_threadpool(
                    upsert_active_import,
                    settings.supabase_url,
                    settings.supabase_secret_key,
                    user_id,
                    import_id,
                )
            except Exception:
                logger.warning("Failed to set active import for user %s", user_id)

        manifest = _build_manifest_entries(write_result)

        # ── Incremental rescan (Part D / F) ───────────────────────────────────
        # Fetch a Supabase client for the rescan + metadata update phase.
        # The entire rescan block is non-fatal — if anything fails here the
        # manifest is still returned with all entries marked 'needs_dat'.
        sb = None
        try:
            sb = await run_in_threadpool(_create_supabase)
        except Exception as exc:
            logger.warning("Failed to create Supabase client for rescan phase: %s", exc)

        new_tracks_full: List[dict] = []
        reuse_decisions: Dict[str, Any] = {}
        if sb is not None:
            try:
                new_tracks_full = await run_in_threadpool(_get_tracks_for_rescan, sb, import_id)
            except Exception as exc:
                logger.warning("Failed to fetch tracks for rescan %s: %s", import_id, exc)

            try:
                reuse_decisions = await run_in_threadpool(
                    match_tracks_to_prior_import, sb, user_id, import_id, new_tracks_full
                )
            except Exception as exc:
                logger.warning(
                    "Incremental rescan failed for import %s (non-fatal): %s", import_id, exc
                )

        tracks_reused = 0
        tracks_needing_upload = 0
        tracks_reparse_from_retained = 0
        tracks_metadata_only = 0

        for entry in manifest:
            decision = reuse_decisions.get(entry.track_id)
            if decision is None:
                entry.manifest_status = "needs_dat"
                tracks_needing_upload += 1
                continue

            entry.manifest_status = decision.manifest_status
            entry.reused_from_track_id = decision.reused_from_track_id
            entry.reuse_reason = decision.reuse_reason
            entry.cue_changed = decision.cue_changed
            entry.analysis_changed = decision.analysis_changed
            entry.information_changed = decision.information_changed

            if decision.manifest_status == "reused":
                tracks_reused += 1
                try:
                    await run_in_threadpool(
                        copy_normalized_data_for_track,
                        sb,
                        decision.reused_from_track_id,
                        entry.track_id,
                        import_id,
                        decision,
                    )
                except Exception as exc:
                    logger.warning(
                        "Failed to copy normalized data from %s to %s: %s",
                        decision.reused_from_track_id,
                        entry.track_id,
                        exc,
                    )
                    # Fallback: mark as needing upload if copy failed
                    entry.manifest_status = "needs_dat"
                    entry.reuse_reason = None
                    tracks_reused -= 1
                    tracks_needing_upload += 1
            elif decision.manifest_status == "metadata_only":
                tracks_metadata_only += 1
                try:
                    await run_in_threadpool(
                        copy_normalized_data_for_track,
                        sb,
                        decision.reused_from_track_id,
                        entry.track_id,
                        import_id,
                        decision,
                    )
                except Exception as exc:
                    logger.warning(
                        "Failed to copy normalized data (metadata_only) from %s to %s: %s",
                        decision.reused_from_track_id,
                        entry.track_id,
                        exc,
                    )
                    entry.manifest_status = "needs_dat"
                    entry.reuse_reason = None
                    tracks_metadata_only -= 1
                    tracks_needing_upload += 1
            elif decision.manifest_status == "reparse_from_retained":
                tracks_reparse_from_retained += 1
            else:
                # needs_dat, needs_ext, needs_2ex, unavailable
                tracks_needing_upload += 1

        # Tracks with no manifest entry at all count as needing upload
        # (they have no analysis path — analysis_data_file_path is None)

        analysis_status = (
            "awaiting_upload"
            if (tracks_needing_upload > 0 or tracks_metadata_only > 0)
            else ("not_requested" if not manifest else "completed")
        )

        # Persist source bundle type and expected track count without completing the job.
        if precreated_job:
            await run_in_threadpool(assert_import_not_cancelled, import_id, user_id)
        try:
            await run_in_threadpool(
                lambda: (
                    sb.table("rekordbox_imports")
                    .update(
                        {
                            "source_bundle_type": "usb_folder",
                            "analysis_expected_track_count": len(manifest),
                            "analysis_status": analysis_status,
                        }
                    )
                    .eq("id", import_id)
                    .execute()
                )
            )
        except Exception:
            logger.warning("Failed to update import metadata for %s", import_id)

        return ImportStartResponse(
            import_id=import_id,
            analysis_status=analysis_status,
            expected_track_count=len(manifest),
            manifest=manifest,
            tracks_reused=tracks_reused,
            tracks_needing_upload=tracks_needing_upload,
            tracks_reparse_from_retained=tracks_reparse_from_retained,
            tracks_metadata_only=tracks_metadata_only,
        )

    except ImportCancelledError:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "IMPORT_CANCELLED",
                "detail": "Import was cancelled.",
                "retryable": False,
            },
        )
    except HTTPException as exc:
        if (
            not precreated_job
            and isinstance(exc.detail, dict)
            and exc.detail.get("error_code") == "UPLOAD_TOO_LARGE"
        ):
            exc.detail = str(exc.detail.get("detail") or "Import failed.")
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        if import_id and detail.get("error_code") != "IMPORT_CANCELLED":
            await run_in_threadpool(
                mark_import_failed,
                import_id,
                user_id,
                error_code=str(detail.get("error_code") or "IMPORT_FAILED"),
                message=str(detail.get("detail") or exc.detail),
                retryable=bool(detail.get("retryable", False)),
            )
        raise
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
            logger.debug("Deleted temp file %s", tmp_path)
        await file.close()


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
    try:
        return await _process_analysis_batch_inner(import_id, user_id, files)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("process_analysis_batch failed for import %s", import_id)
        raise HTTPException(
            status_code=500,
            detail={
                "error_code": "ANALYSIS_BATCH_FAILED",
                "detail": "DropDex could not store this analysis batch. Please retry.",
                "retryable": True,
            },
        ) from exc


async def _process_analysis_batch_inner(
    import_id: str,
    user_id: str,
    files: List[UploadFile],
) -> BatchUploadResponse:
    from dropdex_importer.analysis_paths import is_safe_path, normalize_anlz_path  # noqa: PLC0415

    if len(files) > settings.max_analysis_files_per_batch:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Too many files in batch. Maximum is "
                f"{settings.max_analysis_files_per_batch} per batch."
            ),
        )

    logger.info("batch: start import=%s file_count=%d", import_id, len(files))
    sb, path_map = await run_in_threadpool(_prepare_analysis_batch, import_id, user_id)

    results: List[BatchFileResult] = []
    total_batch_bytes = 0
    newly_received_count = 0
    received_bytes_total = 0

    for upload in files:
        raw_path = upload.filename or ""

        if not raw_path or not is_safe_path(raw_path):
            results.append(
                BatchFileResult(
                    canonical_path=raw_path or "(empty)",
                    status="rejected",
                    reject_reason="Invalid file path.",
                )
            )
            continue

        suffix = Path(raw_path).suffix.lower()
        if suffix not in _VALID_ANLZ_SUFFIXES:
            results.append(
                BatchFileResult(
                    canonical_path=raw_path,
                    status="rejected",
                    reject_reason="File is not a supported ANLZ analysis file (.DAT, .EXT, or .2EX).",
                )
            )
            continue

        try:
            content = await read_upload_bounded(
                upload,
                max_bytes=settings.max_analysis_file_bytes,
                cancellation_requested=lambda: local_cancellation_requested(import_id),
            )
        except HTTPException as exc:
            if isinstance(exc.detail, dict) and exc.detail.get("error_code") == "IMPORT_CANCELLED":
                raise
            results.append(
                BatchFileResult(
                    canonical_path=raw_path,
                    status="rejected",
                    reject_reason=(
                        exc.detail.get("detail")
                        if isinstance(exc.detail, dict)
                        else str(exc.detail)
                    ),
                )
            )
            continue
        file_size = len(content)

        total_batch_bytes += file_size
        if total_batch_bytes > settings.max_analysis_batch_bytes:
            results.append(
                BatchFileResult(
                    canonical_path=raw_path,
                    status="rejected",
                    reject_reason="Batch size limit exceeded. Please send a smaller batch.",
                )
            )
            continue

        canonical = normalize_anlz_path(raw_path)
        if canonical is None:
            results.append(
                BatchFileResult(
                    canonical_path=raw_path,
                    status="rejected",
                    reject_reason="Invalid file path.",
                )
            )
            continue

        canonical_lower = canonical.lower()
        track_info = path_map.get(canonical_lower)
        if track_info is None:
            results.append(
                BatchFileResult(
                    canonical_path=canonical,
                    status="rejected",
                    reject_reason=(
                        "File path does not match any expected analysis file for this import."
                    ),
                )
            )
            continue

        status, sha256, persisted_size = await run_in_threadpool(
            _persist_analysis_upload,
            sb,
            import_id=import_id,
            user_id=user_id,
            canonical=canonical,
            raw_path=raw_path,
            content=content,
            track_info=track_info,
        )
        if status == "already_received":
            results.append(
                BatchFileResult(
                    canonical_path=canonical,
                    status="already_received",
                    sha256=sha256,
                    file_size=persisted_size,
                )
            )
            continue
        if status == "error":
            results.append(
                BatchFileResult(
                    canonical_path=canonical,
                    status="error",
                    reject_reason="Upload failed. Please try again.",
                )
            )
            continue

        newly_received_count += 1
        received_bytes_total += persisted_size
        results.append(
            BatchFileResult(
                canonical_path=canonical,
                status="received",
                sha256=sha256,
                file_size=persisted_size,
            )
        )

    received = sum(1 for r in results if r.status == "received")
    already_received = sum(1 for r in results if r.status == "already_received")
    rejected = sum(1 for r in results if r.status == "rejected")
    errors = sum(1 for r in results if r.status == "error")

    # analysis_asset_count is set authoritatively by complete_analysis_import using
    # a paginated query.  A per-batch read-modify-write here would race with
    # concurrent batch requests and silently lose increments.  Skip it.

    return BatchUploadResponse(
        import_id=import_id,
        received_count=received,
        already_received_count=already_received,
        rejected_count=rejected,
        error_count=errors,
        received_bytes=received_bytes_total,
        files=results,
    )


def _complete_analysis_import_sync(
    import_id: str,
    user_id: str,
    affected_track_ids: Optional[List[str]] = None,
) -> CompleteResponse:
    """
    Download all uploaded ANLZ assets, parse them, and persist analysis results.

    When `affected_track_ids` is provided (non-empty), only those tracks are reparsed.
    This enables selective reprocessing during resume-analysis sessions — only tracks
    that received new file uploads in this pass are touched, rather than the full library.
    """
    sb = _create_supabase()
    import_row = _require_import_for_user(sb, import_id, user_id)
    if import_row.get("status") in {"cancel_requested", "cancelled", "failed"}:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "IMPORT_CANCELLED"
                if import_row.get("status") != "failed"
                else "IMPORT_FAILED",
                "detail": import_row.get("error_message")
                or f"Import is {import_row.get('status')}.",
                "retryable": bool(import_row.get("retryable")),
            },
        )
    assert_import_not_cancelled(import_id, user_id, sb=sb)

    # Transition to 'parsing' before starting work
    try:
        sb.table("rekordbox_imports").update(
            {
                "analysis_status": "parsing",
            }
        ).eq("id", import_id).execute()
    except Exception as exc:
        logger.warning("Failed to set analysis_status=parsing for %s: %s", import_id, exc)

    from .supabase_pagination import fetch_all_rows  # noqa: PLC0415

    # Build asset query; filter by affected_track_ids for selective reprocessing.
    def _asset_query():
        q = (
            sb.table("rekordbox_analysis_assets")
            .select("id, track_id, asset_type, relative_path, storage_path, sha256")
            .eq("import_id", import_id)
            .eq("upload_status", "uploaded")
        )
        if affected_track_ids:
            q = q.in_("track_id", affected_track_ids)
        return q

    uploaded_assets: List[dict] = fetch_all_rows(_asset_query, order_column="id")

    assets_by_track: Dict[str, List[dict]] = {}
    for asset in uploaded_assets:
        tid = asset.get("track_id")
        if tid:
            assets_by_track.setdefault(tid, []).append(asset)

    tracks = _get_tracks_with_paths(sb, import_id)
    # Restrict to affected tracks when selective reprocessing
    if affected_track_ids:
        affected_set = set(affected_track_ids)
        tracks = [t for t in tracks if t.get("id") in affected_set]

    # Diagnostic invariant: loaded counts must match what was stored.
    _expected = import_row.get("analysis_expected_track_count") or 0
    _dat_count = sum(1 for a in uploaded_assets if a.get("asset_type") == "DAT")
    _ext_count = sum(1 for a in uploaded_assets if a.get("asset_type") == "EXT")
    _2ex_count = sum(1 for a in uploaded_assets if a.get("asset_type") == "2EX")
    logger.info(
        "complete: import=%s expected_tracks=%d loaded_tracks=%d "
        "uploaded_assets=%d (DAT=%d EXT=%d 2EX=%d)",
        import_id,
        _expected,
        len(tracks),
        len(uploaded_assets),
        _dat_count,
        _ext_count,
        _2ex_count,
    )
    if _expected and len(tracks) != _expected:
        logger.warning(
            "complete: track count mismatch import=%s expected=%d loaded=%d — "
            "pagination issue or write failure",
            import_id,
            _expected,
            len(tracks),
        )

    from dropdex_importer.analysis_paths import (  # noqa: PLC0415
        derive_anlz_siblings,
        normalize_anlz_path,
    )

    track_results: List[TrackCompleteStatus] = []
    completed_count = partial_count = failed_count = missing_required_count = 0
    missing_optional_ext_count = missing_optional_2ex_count = 0
    matched_track_count = 0

    tmp_dir: Optional[str] = None
    try:
        tmp_dir = tempfile.mkdtemp()

        for track in tracks:
            assert_import_not_cancelled(import_id, user_id, sb=sb)
            track_id = track["id"]
            rb_cid = str(track.get("rekordbox_content_id", ""))
            track_assets = assets_by_track.get(track_id, [])

            dat_asset = next((a for a in track_assets if a["asset_type"] == "DAT"), None)
            ext_asset = next((a for a in track_assets if a["asset_type"] == "EXT"), None)
            two_ex_asset = next((a for a in track_assets if a["asset_type"] == "2EX"), None)

            # Count missing optional files
            raw = track.get("analysis_data_file_path") or ""
            canonical_base = normalize_anlz_path(raw)
            if canonical_base:
                _, exp_ext, exp_2ex = derive_anlz_siblings(canonical_base)
                if ext_asset is None:
                    missing_optional_ext_count += 1
                if two_ex_asset is None:
                    missing_optional_2ex_count += 1

            if not dat_asset:
                missing_required_count += 1
                track_results.append(
                    TrackCompleteStatus(
                        track_id=track_id,
                        rekordbox_content_id=rb_cid,
                        parse_status="missing_required",
                        assets_parsed=0,
                        warnings=[
                            {
                                "code": "SIBLING_MISSING",
                                "asset_type": "DAT",
                                "message": "Required DAT file was not uploaded.",
                                "detail": None,
                            }
                        ],
                    )
                )
                continue

            matched_track_count += 1
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
                track_results.append(
                    TrackCompleteStatus(
                        track_id=track_id,
                        rekordbox_content_id=rb_cid,
                        parse_status="failed",
                        assets_parsed=0,
                        warnings=[
                            {
                                "code": "PARSE_ERROR",
                                "asset_type": "BUNDLE",
                                "message": "An error occurred while parsing analysis files.",
                                "detail": None,
                            }
                        ],
                    )
                )
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
                        # Preserve 'partial' — do NOT convert to 'completed'
                        sb.table("rekordbox_analysis_assets").update(
                            {
                                "parse_status": result_obj.parse_status,
                                "parser_version": _PARSER_VERSION,
                                "parse_warnings": [w.as_dict() for w in result_obj.warnings],
                                "parsed_at": _now_iso(),
                            }
                        ).eq("id", asset_row["id"]).execute()
                    except Exception as exc:
                        logger.error("Failed to update asset %s: %s", asset_row["id"], exc)
                    if result_obj.parse_status in ("completed", "partial"):
                        parsed_count += 1

            overall = bundle.overall_status

            # ── Feature extraction (each phase is isolated) ────────────────
            feature_statuses: Dict[str, str] = {}
            asset_ids = {
                "DAT": asset_lookup.get("DAT", {}).get("id"),
                "EXT": asset_lookup.get("EXT", {}).get("id"),
                "2EX": asset_lookup.get("2EX", {}).get("id"),
            }
            bg = None  # BeatGridResult; passed to phrase extraction

            try:
                from dropdex_importer.beatgrid_parser import extract_beat_grid  # noqa: PLC0415

                from .analysis_feature_writer import write_beat_grid  # noqa: PLC0415

                bg = extract_beat_grid(bundle.dat, bundle.ext)
                if bg is not None:
                    src_id = asset_ids.get("DAT") or asset_ids.get("EXT")
                    ok = write_beat_grid(sb, import_id, track_id, bg, src_id, _PARSER_VERSION)
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
                ok = write_waveform(
                    sb, import_id, track_id, wf, user_id, asset_ids, _PARSER_VERSION
                )
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
                ok = write_phrases(sb, import_id, track_id, phrase_entries, _PARSER_VERSION)
                if not ok:
                    feature_statuses["phrases"] = "failed"
                elif not phrase_entries:
                    feature_statuses["phrases"] = "skipped"
                else:
                    feature_statuses["phrases"] = "completed"
            except Exception as exc:
                logger.error("Phrase extraction failed for track %s: %s", track_id, exc)
                feature_statuses["phrases"] = "failed"

            try:
                sb.table("rekordbox_tracks").update(
                    {
                        "analysis_parse_status": overall,
                        "analysis_parse_warnings": [w.as_dict() for w in (bundle.warnings or [])],
                        "analysis_feature_statuses": feature_statuses,
                    }
                ).eq("id", track_id).execute()
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

            track_results.append(
                TrackCompleteStatus(
                    track_id=track_id,
                    rekordbox_content_id=rb_cid,
                    parse_status=overall,
                    assets_parsed=parsed_count,
                    warnings=all_warnings,
                )
            )

    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    total_tracks = len(tracks)
    total_asset_count = len(uploaded_assets)
    parsed_track_count = completed_count + partial_count

    if total_tracks == 0:
        final_status = "completed"
    elif missing_required_count == total_tracks and completed_count == 0 and partial_count == 0:
        final_status = "failed"
    elif failed_count > 0 or partial_count > 0 or missing_required_count > 0:
        final_status = "partial"
    else:
        final_status = "completed"

    assert_import_not_cancelled(import_id, user_id, sb=sb)
    try:
        response = (
            sb.table("rekordbox_imports")
            .update(
                {
                    "analysis_status": final_status,
                    "analysis_matched_track_count": matched_track_count,
                    "analysis_parsed_track_count": parsed_track_count,
                    "analysis_failed_track_count": failed_count + missing_required_count,
                    "analysis_asset_count": total_asset_count,
                    "analysis_parser_version": _PARSER_VERSION,
                    "analysis_completed_at": _now_iso(),
                }
            )
            .eq("id", import_id)
            .in_("status", ["processing", "completed"])
            .execute()
        )
        if import_row.get("status") == "processing":
            complete_import_job(import_id, user_id)
            upsert_active_import(
                settings.supabase_url, settings.supabase_secret_key, user_id, import_id
            )
        elif not response.data:
            assert_import_not_cancelled(import_id, user_id, sb=sb)
    except ImportCancelledError:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "IMPORT_CANCELLED",
                "detail": "Import was cancelled.",
                "retryable": False,
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to update import %s status: %s", import_id, exc)
        raise HTTPException(
            status_code=500,
            detail={
                "error_code": "IMPORT_FINALIZE_FAILED",
                "detail": "Analysis finished, but the import could not be finalized. Please retry.",
                "retryable": True,
            },
        )

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
        parser_version=_PARSER_VERSION,
        tracks=track_results,
    )


async def complete_analysis_import(
    import_id: str,
    user_id: str,
    affected_track_ids: Optional[List[str]] = None,
) -> CompleteResponse:
    """Run CPU/file/database-heavy analysis outside the event loop."""
    return await run_in_threadpool(
        _complete_analysis_import_sync, import_id, user_id, affected_track_ids
    )


def _get_analysis_status_sync(import_id: str, user_id: str) -> AnalysisStatusResponse:
    """Return current analysis status for an import, including structured unresolved targets."""
    from dropdex_importer.analysis_paths import (  # noqa: PLC0415
        derive_anlz_siblings,
        normalize_anlz_path,
    )

    from .models import ResumeTargetItem  # noqa: PLC0415

    sb = _create_supabase()
    import_row = _require_import_for_user(sb, import_id, user_id)

    tracks = _get_tracks_with_paths(sb, import_id)

    from .supabase_pagination import fetch_all_rows  # noqa: PLC0415

    uploaded_assets_status = fetch_all_rows(
        lambda: (
            sb.table("rekordbox_analysis_assets")
            .select("relative_path, asset_type, upload_status")
            .eq("import_id", import_id)
        ),
        order_column="id",
    )

    # Track uploaded (by type) and failed uploads (by relative_path).
    uploaded_by_type: Dict[str, set] = {"DAT": set(), "EXT": set(), "2EX": set()}
    failed_uploads_by_type: Dict[str, set] = {"DAT": set(), "EXT": set(), "2EX": set()}
    for r in uploaded_assets_status:
        atype = r.get("asset_type", "")
        if atype not in uploaded_by_type:
            continue
        path_lower = r["relative_path"].lower()
        status = r.get("upload_status", "")
        if status == "uploaded":
            uploaded_by_type[atype].add(path_lower)
        elif status in ("failed", "error"):
            failed_uploads_by_type[atype].add(path_lower)

    missing_required: List[str] = []
    missing_optional_ext: List[str] = []
    missing_optional_2ex: List[str] = []
    unresolved_targets: List[ResumeTargetItem] = []
    affected_track_ids: set = set()

    for track in tracks:
        track_id = track.get("id", "")
        rekordbox_content_id = track.get("rekordbox_content_id")
        raw = track.get("analysis_data_file_path") or ""
        canonical = normalize_anlz_path(raw)
        if not canonical:
            continue
        dat_path, ext_path, two_ex_path = derive_anlz_siblings(canonical)
        track_has_target = False

        # DAT — required
        if dat_path.lower() not in uploaded_by_type["DAT"]:
            missing_required.append(dat_path)
            upload_failed = dat_path.lower() in failed_uploads_by_type["DAT"]
            unresolved_targets.append(
                ResumeTargetItem(
                    track_id=track_id,
                    rekordbox_content_id=rekordbox_content_id,
                    relative_path=dat_path,
                    asset_type="DAT",
                    required=True,
                    status="upload_failed" if upload_failed else "missing",
                    reason="Upload failed — retry" if upload_failed else None,
                    attempt_count=None,
                )
            )
            track_has_target = True

        # EXT — optional color waveform
        if ext_path.lower() not in uploaded_by_type["EXT"]:
            missing_optional_ext.append(ext_path)
            upload_failed = ext_path.lower() in failed_uploads_by_type["EXT"]
            unresolved_targets.append(
                ResumeTargetItem(
                    track_id=track_id,
                    rekordbox_content_id=rekordbox_content_id,
                    relative_path=ext_path,
                    asset_type="EXT",
                    required=False,
                    status="upload_failed" if upload_failed else "optional_missing",
                    reason="Upload failed — retry" if upload_failed else None,
                    attempt_count=None,
                )
            )
            track_has_target = True

        # 2EX — optional detail waveform
        if two_ex_path.lower() not in uploaded_by_type["2EX"]:
            missing_optional_2ex.append(two_ex_path)
            upload_failed = two_ex_path.lower() in failed_uploads_by_type["2EX"]
            unresolved_targets.append(
                ResumeTargetItem(
                    track_id=track_id,
                    rekordbox_content_id=rekordbox_content_id,
                    relative_path=two_ex_path,
                    asset_type="2EX",
                    required=False,
                    status="upload_failed" if upload_failed else "optional_missing",
                    reason="Upload failed — retry" if upload_failed else None,
                    attempt_count=None,
                )
            )
            track_has_target = True

        if track_has_target:
            affected_track_ids.add(track_id)

    # Summary counts from structured targets
    missing_required_count = sum(
        1 for t in unresolved_targets if t.required and t.status in ("missing", "parse_failed")
    )
    missing_optional_count = sum(
        1 for t in unresolved_targets if not t.required and t.status == "optional_missing"
    )
    failed_upload_count = sum(1 for t in unresolved_targets if t.status == "upload_failed")
    failed_parse_count = sum(1 for t in unresolved_targets if t.status == "parse_failed")

    return AnalysisStatusResponse(
        import_id=import_id,
        analysis_status=import_row.get("analysis_status") or "unknown",
        expected_track_count=import_row.get("analysis_expected_track_count", 0),
        matched_track_count=import_row.get("analysis_matched_track_count", 0),
        parsed_track_count=import_row.get("analysis_parsed_track_count", 0),
        failed_track_count=import_row.get("analysis_failed_track_count", 0),
        asset_count=import_row.get("analysis_asset_count", 0),
        missing_required_paths=missing_required,
        missing_optional_ext=missing_optional_ext,
        missing_optional_2ex=missing_optional_2ex,
        parser_version=import_row.get("analysis_parser_version"),
        warnings=import_row.get("analysis_warnings") or [],
        unresolved_targets=unresolved_targets,
        missing_required_count=missing_required_count,
        missing_optional_count=missing_optional_count,
        failed_upload_count=failed_upload_count,
        failed_parse_count=failed_parse_count,
        affected_track_count=len(affected_track_ids),
    )


async def get_analysis_status(import_id: str, user_id: str) -> AnalysisStatusResponse:
    """Load the potentially large import status view outside the event loop."""
    return await run_in_threadpool(_get_analysis_status_sync, import_id, user_id)
