"""
Staged Rekordbox USB analysis import service.

Implements the three-phase workflow:
  1. start_analysis_import   — parse exportLibrary.db, persist, return manifest
  2. process_analysis_batch  — validate and durably stage requested ANLZ files
  3. complete_analysis_import — queue bounded background parsing and bulk writes
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
import json
import logging
import os
import shutil
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional, Sequence

from dropdex_importer.supabase_writer import RekordboxWriteError
from fastapi import HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from .analysis_raw_archival import start_raw_archival
from .config import settings
from .import_jobs import (
    ImportCancelledError,
    assert_import_not_cancelled,
    complete_import_job,
    finalize_paused_import,
    local_cancellation_requested,
    mark_import_failed,
    publish_worker_state,
    transition_import_job,
)
from .analysis_worker_lease import (
    DurableWorkerLease,
    WorkerLeaseConflict,
    WorkerLeaseLost,
    get_worker_lease,
    lease_row_is_active,
)
from .import_worker_registry import WorkerStopRequested, worker_registry
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
from .retained_analysis_dependencies import (
    RetainedAnalysisSourceUnavailable,
    release_retained_analysis_dependencies,
    replace_retained_analysis_dependencies,
)
from .rescan_service import (
    copy_normalized_data_for_track,
    copy_normalized_data_for_tracks_bulk,
    match_tracks_to_prior_import,
)
from .supabase_writer import write_to_supabase_full
from .upload_stream import read_upload_bounded, stream_upload_to_temp
from .user_settings import upsert_active_import
from .validation import validate

logger = logging.getLogger(__name__)

_VALID_ANLZ_SUFFIXES = frozenset({".dat", ".ext", ".2ex"})
_REQUIRED_ANLZ_SUFFIXES = frozenset({".dat", ".ext"})
_ASSET_EXT_MAP = {"DAT": ".DAT", "EXT": ".EXT", "2EX": ".2EX"}
_ANALYSIS_BUCKET = "rekordbox-analysis-assets"

# Module-level ANLZ parser version constant — imported once to avoid repeated
# deferred imports.  Falls back to "unknown" if pyrekordbox is absent.
try:
    from dropdex_importer.anlz_parser import DROPDEX_ANLZ_PARSER_VERSION as _PARSER_VERSION
except ImportError:  # pragma: no cover
    _PARSER_VERSION = "unknown"


_ANALYSIS_PROGRESS_LOCK = Lock()
_ANALYSIS_PROGRESS: Dict[str, Dict[str, Any]] = {}
_ANALYSIS_PROGRESS_LAST_PERSISTED: Dict[str, float] = {}
_ANALYSIS_PROGRESS_PERSIST_INTERVAL_SECONDS = 0.5
_PATH_MAP_CACHE_LOCK = Lock()
_PATH_MAP_CACHE: Dict[str, Dict[str, dict]] = {}
_PATH_MAP_BUILD_LOCKS: Dict[str, Lock] = {}
_BACKGROUND_WORKER_LOCK = Lock()
_BACKGROUND_WORKERS: Dict[str, threading.Thread] = {}



def _analysis_worker_checkpoint(
    import_id: str,
    user_id: str,
    stage: str,
    *,
    current_track_id: str | None = None,
    sb=None,
) -> None:
    """Publish a safe worker boundary before the next costly or write stage."""
    worker_registry.checkpoint(
        import_id,
        stage,
        current_track_id=current_track_id,
    )
    if sb is None:
        return
    try:
        sb.table("rekordbox_imports").update(
            {
                "analysis_worker_status": "running",
                "analysis_worker_stage": stage,
                "analysis_worker_current_track_id": current_track_id,
                "analysis_worker_heartbeat_at": _now_iso(),
                "analysis_worker_stopped_acknowledged": False,
                "analysis_worker_stopped_at": None,
            }
        ).eq("id", import_id).eq("user_id", user_id).execute()
    except Exception as exc:
        logger.warning("Could not persist worker checkpoint %s for %s: %s", stage, import_id, exc)

def _format_current_track_label(track: Optional[dict]) -> Optional[str]:
    """Return a compact Artist - Title label for live import progress."""
    if not track:
        return None

    title = str(track.get("title") or "").strip()
    artist = str(track.get("artist") or "").strip()
    content_id = str(track.get("rekordbox_content_id") or "").strip()

    if artist and title:
        return f"{artist} - {title}"
    if title:
        return title
    if artist:
        return artist
    if content_id:
        return f"Track {content_id}"
    return "current track"


def _set_analysis_progress(
    import_id: str,
    *,
    track: Optional[dict],
    processed_track_count: int,
    total_track_count: int,
    sb=None,
    force_persist: bool = False,
) -> None:
    """Record progress in memory and persist it for cross-worker polling."""
    label = _format_current_track_label(track)
    safe_total = max(0, int(total_track_count or 0))
    safe_processed = max(0, min(int(processed_track_count or 0), safe_total or 0))
    current_track_id = str(track.get("id")) if track and track.get("id") else None
    updated_at = _now_iso()
    payload = {
        "processed_track_count": safe_processed,
        "total_track_count": safe_total,
        "current_track_id": current_track_id,
        "current_track_title": (
            str(track.get("title")).strip()
            if track and track.get("title")
            else None
        ),
        "current_track_artist": (
            str(track.get("artist")).strip()
            if track and track.get("artist")
            else None
        ),
        "current_track_label": label,
        "updated_at": updated_at,
    }

    now_monotonic = time.monotonic()
    with _ANALYSIS_PROGRESS_LOCK:
        _ANALYSIS_PROGRESS[import_id] = payload
        last_persisted = _ANALYSIS_PROGRESS_LAST_PERSISTED.get(import_id, 0.0)
        should_persist = force_persist or (
            sb is not None
            and now_monotonic - last_persisted >= _ANALYSIS_PROGRESS_PERSIST_INTERVAL_SECONDS
        )
        if should_persist:
            _ANALYSIS_PROGRESS_LAST_PERSISTED[import_id] = now_monotonic

    if sb is None or not should_persist:
        return

    try:
        sb.table("rekordbox_imports").update({
            "analysis_progress_processed_track_count": safe_processed,
            "analysis_progress_total_track_count": safe_total,
            "analysis_current_track_id": current_track_id,
            "analysis_current_track_title": payload["current_track_title"],
            "analysis_current_track_artist": payload["current_track_artist"],
            "analysis_current_track_label": label,
            "analysis_progress_updated_at": updated_at,
            "updated_at": updated_at,
        }).eq("id", import_id).execute()
    except Exception as exc:
        # Parsing must continue if a transient progress write fails. The final
        # status write is still authoritative and will force-persist progress.
        logger.warning("Could not persist analysis progress for %s: %s", import_id, exc)


def _get_live_analysis_progress(import_id: str) -> Dict[str, Any]:
    """Return a copy of the live in-memory progress entry, when present."""
    with _ANALYSIS_PROGRESS_LOCK:
        return dict(_ANALYSIS_PROGRESS.get(import_id) or {})


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



def _require_import_for_user(sb, import_id: str, user_id: str) -> dict:
    """Fetch import row scoped to user_id. Raises HTTP 404 if not found."""
    resp = (
        sb.table("rekordbox_imports")
        .select(
            "id, status, error_code, error_message, retryable, analysis_status, analysis_expected_track_count, "
            "analysis_matched_track_count, analysis_parsed_track_count, "
            "analysis_failed_track_count, analysis_asset_count, "
            "analysis_parser_version, analysis_warnings, "
            "analysis_progress_processed_track_count, analysis_progress_total_track_count, "
            "analysis_current_track_id, analysis_current_track_title, "
            "analysis_current_track_artist, analysis_current_track_label, "
            "analysis_progress_updated_at, library_ready_at, readiness_stage, "
            "required_analysis_file_count, optional_archival_file_count, "
            "optional_archival_status, raw_archival_status, performance_metrics, analysis_queue_track_count, "
            "analysis_running_track_count, analysis_throughput_tracks_per_second, "
            "analysis_estimated_seconds_remaining, user_id"
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


def _get_tracks_for_analysis_status(sb, import_id: str) -> List[dict]:
    """Return every track needed for manifest and progressive status views."""
    from .supabase_pagination import fetch_all_rows  # noqa: PLC0415

    return fetch_all_rows(
        lambda: (
            sb.table("rekordbox_tracks")
            .select(
                "id, rekordbox_content_id, title, artist, "
                "analysis_data_file_path, analysis_parse_status, analysis_manifest_status, "
                "analysis_source_fingerprint, analysis_failure_reason, "
                "analysis_reused_from_track_id"
            )
            .eq("import_id", import_id)
        ),
        order_column="id",
    )


def _get_tracks_with_paths(sb, import_id: str) -> List[dict]:
    """Return tracks with an analysis path for upload and legacy parse work."""
    return [
        track
        for track in _get_tracks_for_analysis_status(sb, import_id)
        if track.get("analysis_data_file_path")
    ]


_FINAL_ANALYSIS_TRACK_STATUSES = frozenset({"completed", "partial", "reused", "skipped"})


def _select_tracks_for_analysis(
    all_tracks: List[dict],
    affected_track_ids: Optional[List[str]] = None,
) -> List[dict]:
    """Return only tracks whose final checkpoint has not been committed."""
    affected = set(affected_track_ids or [])
    return [
        track
        for track in all_tracks
        if (not affected or track.get("id") in affected)
        and str(track.get("analysis_parse_status") or "")
        not in _FINAL_ANALYSIS_TRACK_STATUSES
    ]


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


def _required_asset_types_for_status(status: str) -> frozenset[str]:
    normalized = status or "needs_analysis"
    if normalized in {"reused", "metadata_only", "reparse_from_retained", "unavailable"}:
        return frozenset()
    if normalized == "needs_ext":
        return frozenset({"EXT"})
    return frozenset({"DAT", "EXT"})


def _track_source_fingerprint(track: dict, manifest_entry: ManifestEntryResponse) -> str:
    """Build a stable, cheap track identity without re-hashing USB files."""
    normalized_path = str(track.get("analysis_data_file_path") or manifest_entry.dat_path or "").replace("\\", "/").lower()
    values = (
        str(track.get("rekordbox_content_id") or manifest_entry.rekordbox_content_id or ""),
        normalized_path,
        str(track.get("master_db_id") or ""),
        str(track.get("master_content_id") or ""),
        str(track.get("analysis_data_update_count") or 0),
        str(track.get("cue_update_count") or 0),
        str(track.get("information_update_count") or 0),
        _PARSER_VERSION,
        settings.analysis_feature_schema_version,
    )
    return hashlib.sha256("|".join(values).encode("utf-8")).hexdigest()


def _apply_manifest_work_rules(entry: ManifestEntryResponse) -> None:
    """Translate a manifest status into explicit required and optional work."""
    required = list(_required_asset_types_for_status(entry.manifest_status))
    ordered = [asset_type for asset_type in ("DAT", "EXT") if asset_type in required]
    entry.required_asset_types = ordered
    entry.dat_required = "DAT" in ordered
    entry.ext_required = "EXT" in ordered
    entry.optional_archival_asset_types = ["2EX"] if entry.two_ex_path else []


def _persist_track_manifest_state(sb, import_id: str, entries: Sequence[ManifestEntryResponse]) -> None:
    rows = [
        {
            "track_id": entry.track_id,
            "analysis_parse_status": (
                "reused"
                if entry.manifest_status in {"reused", "metadata_only"}
                else "skipped"
                if entry.manifest_status == "unavailable"
                else "queued"
            ),
            "analysis_manifest_status": entry.manifest_status,
            "analysis_reused_from_track_id": entry.reused_from_track_id,
            "analysis_source_fingerprint": entry.source_fingerprint,
            "analysis_feature_schema_version": settings.analysis_feature_schema_version,
            "analysis_failure_reason": (entry.reuse_reason if entry.manifest_status == "unavailable" else None),
            "analysis_queued_at": (
                None
                if entry.manifest_status in {"reused", "metadata_only", "unavailable"}
                else _now_iso()
            ),
        }
        for entry in entries
    ]
    if not rows:
        return
    try:
        sb.rpc(
            "bulk_update_rekordbox_track_analysis",
            {"p_import_id": import_id, "p_rows": rows},
        ).execute()
        return
    except Exception as exc:
        logger.warning("Bulk manifest status RPC unavailable, using bounded fallback: %s", exc)
    for offset in range(0, len(rows), 200):
        for row in rows[offset : offset + 200]:
            track_id = row["track_id"]
            payload = {key: value for key, value in row.items() if key != "track_id"}
            sb.table("rekordbox_tracks").update(payload).eq("id", track_id).eq(
                "import_id", import_id
            ).execute()


def _build_path_map(tracks: List[dict]) -> Dict[str, dict]:
    """Build the import path map once, restricted to requested blocking assets."""
    from dropdex_importer.analysis_paths import derive_anlz_siblings, normalize_anlz_path

    path_map: Dict[str, dict] = {}
    for track in tracks:
        canonical = normalize_anlz_path(track.get("analysis_data_file_path") or "")
        if not canonical:
            continue
        dat_path, ext_path, two_ex_path = derive_anlz_siblings(canonical)
        required_types = _required_asset_types_for_status(
            str(track.get("analysis_manifest_status") or "needs_analysis")
        )
        for path, asset_type in ((dat_path, "DAT"), (ext_path, "EXT")):
            if asset_type in required_types:
                path_map[path.lower()] = {
                    "track_id": track["id"],
                    "asset_type": asset_type,
                    "required": True,
                    "source_fingerprint": track.get("analysis_source_fingerprint"),
                }
        if settings.analysis_archive_2ex and two_ex_path:
            path_map[two_ex_path.lower()] = {
                "track_id": track["id"],
                "asset_type": "2EX",
                "required": False,
                "optional_archival": True,
                "source_fingerprint": track.get("analysis_source_fingerprint"),
            }
    return path_map


def _invalidate_path_map_cache(import_id: str) -> None:
    with _PATH_MAP_CACHE_LOCK:
        _PATH_MAP_CACHE.pop(import_id, None)
        _PATH_MAP_BUILD_LOCKS.pop(import_id, None)



def _prepare_analysis_batch(import_id: str, user_id: str):
    """Load import metadata and reuse a single path map for every upload batch."""
    sb = _create_supabase()
    import_row = _require_import_for_user(sb, import_id, user_id)
    if import_row.get("status") in {"cancelled", "failed", "deleting"}:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "IMPORT_CANCELLED" if import_row.get("status") != "failed" else "IMPORT_FAILED",
                "detail": import_row.get("error_message") or f"Import is {import_row.get('status')}.",
                "retryable": bool(import_row.get("retryable")),
            },
        )

    with _PATH_MAP_CACHE_LOCK:
        cached = _PATH_MAP_CACHE.get(import_id)
        build_lock = _PATH_MAP_BUILD_LOCKS.setdefault(import_id, Lock())
    if cached is not None:
        return sb, cached, False, import_row

    with build_lock:
        # Concurrent browser upload batches can arrive together. Recheck after
        # acquiring the per-import build lock so only one batch loads all tracks.
        with _PATH_MAP_CACHE_LOCK:
            cached = _PATH_MAP_CACHE.get(import_id)
        if cached is not None:
            return sb, cached, False, import_row

        tracks = _get_tracks_with_paths(sb, import_id)
        path_map = _build_path_map(tracks)
        with _PATH_MAP_CACHE_LOCK:
            _PATH_MAP_CACHE[import_id] = path_map

        return sb, path_map, True, import_row



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
    request_started = time.perf_counter()
    parse_started = request_started
    db_write_elapsed_ms = 0.0
    parse_elapsed_ms = 0.0
    db_bytes = 0
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
        tmp_path, db_bytes = await stream_upload_to_temp(
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
            parse_started = time.perf_counter()
            library = await run_in_threadpool(parse_library, tmp_path)
            parse_elapsed_ms = (time.perf_counter() - parse_started) * 1000.0
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
            db_write_started = time.perf_counter()
            write_result = await run_in_threadpool(
                _write_library_for_job, library, user_id, import_id
            )
            db_write_elapsed_ms = (time.perf_counter() - db_write_started) * 1000.0
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
                    "record has an unexpected format. Update DropDex and try the import again."
                )
                detail["diagnostic"] = "Invalid value syntax for a database column."
                detail["retryable"] = False
            elif exc.db_code in ("PGRST204", "42P01", "42703"):
                detail["detail"] = (
                    "DropDex parsed your Rekordbox library, but the Supabase schema is "
                    "behind this version of DropDex. Apply the pending Supabase migrations "
                    "and restart DropDex before trying again."
                )
                detail["diagnostic"] = (
                    f"Database schema mismatch: {exc.db_message}"
                    if exc.db_message
                    else "Database schema mismatch. The required table or column is missing."
                )
                detail["retryable"] = False
            elif exc.db_code == "23514":
                detail["detail"] = (
                    "DropDex parsed your Rekordbox library, but one track contained a value "
                    "outside the database's allowed range. Update DropDex and retry the import."
                )
                detail["diagnostic"] = "A database check constraint rejected a track record."
                detail["retryable"] = False
            elif exc.db_code == "42501":
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

        # Build the import identity map once. Rescan failures remain non-fatal and
        # conservatively fall back to requesting DAT/EXT for the affected track.
        sb = await run_in_threadpool(_create_supabase)
        new_tracks_full: List[dict] = []
        reuse_decisions: Dict[str, Any] = {}
        try:
            new_tracks_full = await run_in_threadpool(_get_tracks_for_rescan, sb, import_id)
            reuse_decisions = await run_in_threadpool(
                lambda: match_tracks_to_prior_import(
                    sb,
                    user_id,
                    import_id,
                    new_tracks_full,
                    parser_version=_PARSER_VERSION,
                    feature_schema_version=settings.analysis_feature_schema_version,
                )
            )
        except Exception as exc:
            logger.warning(
                "Incremental rescan failed for import %s; using conservative upload plan: %s",
                import_id,
                exc,
            )

        tracks_by_id = {str(track.get("id")): track for track in new_tracks_full}
        tracks_reused = 0
        tracks_needing_upload = 0
        tracks_reparse_from_retained = 0
        tracks_metadata_only = 0
        unavailable_tracks = 0
        reuse_mappings: List[tuple[str, str, Any]] = []

        for entry in manifest:
            decision = reuse_decisions.get(entry.track_id)
            if decision is not None:
                entry.manifest_status = decision.manifest_status
                entry.reused_from_track_id = decision.reused_from_track_id
                entry.reuse_reason = decision.reuse_reason
                entry.cue_changed = decision.cue_changed
                entry.analysis_changed = decision.analysis_changed
                entry.information_changed = decision.information_changed
            else:
                entry.manifest_status = "needs_dat"

            if (
                entry.manifest_status in {"reused", "metadata_only"}
                and entry.reused_from_track_id
                and decision is not None
            ):
                reuse_mappings.append(
                    (entry.reused_from_track_id, entry.track_id, decision)
                )

            if entry.manifest_status == "reused":
                tracks_reused += 1
            elif entry.manifest_status == "metadata_only":
                tracks_metadata_only += 1
            elif entry.manifest_status == "reparse_from_retained":
                tracks_reparse_from_retained += 1
            elif entry.manifest_status == "unavailable":
                unavailable_tracks += 1
            else:
                tracks_needing_upload += 1

            _apply_manifest_work_rules(entry)
            entry.source_fingerprint = _track_source_fingerprint(
                tracks_by_id.get(entry.track_id, {}), entry
            )

        # Persist every cross-import dependency before reading/copying source-owned
        # normalized data or retained DAT/EXT bytes. The RPC shares the source
        # import's per-user advisory lock with hard-delete start, closing the race
        # where deletion could begin after rescan matching but before materialization.
        dependency_entries = [
            entry
            for entry in manifest
            if entry.reused_from_track_id
            and entry.manifest_status in {"reused", "metadata_only", "reparse_from_retained"}
        ]
        dependency_rows = [
            {
                "source_track_id": str(entry.reused_from_track_id),
                "dependent_track_id": entry.track_id,
            }
            for entry in dependency_entries
        ]
        try:
            if dependency_rows:
                await run_in_threadpool(
                    replace_retained_analysis_dependencies,
                    sb,
                    import_id,
                    dependency_rows,
                )
        except RetainedAnalysisSourceUnavailable:
            # The source import won the deletion lock. Do not retain a dangling
            # reference; conservatively request fresh analysis from the USB.
            logger.info(
                "Retained source became unavailable during manifest planning for import %s; "
                "requesting fresh analysis assets",
                import_id,
            )
            fallback_targets = {entry.track_id for entry in dependency_entries}
            tracks_reused = max(
                0,
                tracks_reused
                - sum(
                    1
                    for entry in dependency_entries
                    if entry.manifest_status == "reused"
                ),
            )
            tracks_metadata_only = max(
                0,
                tracks_metadata_only
                - sum(
                    1
                    for entry in dependency_entries
                    if entry.manifest_status == "metadata_only"
                ),
            )
            tracks_reparse_from_retained = max(
                0,
                tracks_reparse_from_retained
                - sum(
                    1
                    for entry in dependency_entries
                    if entry.manifest_status == "reparse_from_retained"
                ),
            )
            for entry in dependency_entries:
                entry.manifest_status = "needs_dat"
                entry.reused_from_track_id = None
                entry.reuse_reason = None
                _apply_manifest_work_rules(entry)
            tracks_needing_upload += len(fallback_targets)
            reuse_mappings = [
                mapping for mapping in reuse_mappings if mapping[1] not in fallback_targets
            ]
            await run_in_threadpool(
                replace_retained_analysis_dependencies,
                sb,
                import_id,
                [],
            )

        if reuse_mappings:
            normalized_targets = [target for _, target, _ in reuse_mappings]
            try:
                reuse_metrics = await run_in_threadpool(
                    copy_normalized_data_for_tracks_bulk,
                    sb,
                    import_id,
                    reuse_mappings,
                )
            except Exception as exc:
                logger.warning(
                    "Bulk normalized reuse failed for import %s; falling back to requested assets: %s",
                    import_id,
                    exc,
                )
                fallback_targets = {target for _, target, _ in reuse_mappings}
                tracks_reused = 0
                tracks_metadata_only = 0
                for entry in manifest:
                    if entry.track_id in fallback_targets:
                        entry.manifest_status = "needs_dat"
                        entry.reused_from_track_id = None
                        entry.reuse_reason = None
                        _apply_manifest_work_rules(entry)
                tracks_needing_upload += len(fallback_targets)
                await run_in_threadpool(
                    release_retained_analysis_dependencies,
                    sb,
                    import_id,
                    list(fallback_targets),
                )
            else:
                # Normalized rows are now owned by the dependent import. Waveform
                # detail blobs may still share a path, and delete cleanup protects
                # those paths by checking surviving waveform references. A failed
                # release is fatal here so the safety guard is never silently lost.
                await run_in_threadpool(
                    release_retained_analysis_dependencies,
                    sb,
                    import_id,
                    normalized_targets,
                )
                logger.info(
                    "Incremental reuse import=%s tracks=%d read_batches=%d write_batches=%d rows=%d",
                    import_id,
                    len(reuse_mappings),
                    reuse_metrics.get("read_batches", 0),
                    reuse_metrics.get("write_batches", 0),
                    reuse_metrics.get("rows_copied", 0),
                )

        required_analysis_file_count = sum(
            len(entry.required_asset_types) for entry in manifest
        )
        optional_archival_file_count = sum(
            1 for entry in manifest if entry.two_ex_path
        )
        tracks_already_reusable = tracks_reused + tracks_metadata_only
        affected_track_count = (
            tracks_needing_upload + tracks_reparse_from_retained
        )
        analysis_status = (
            "awaiting_upload"
            if required_analysis_file_count > 0
            else "queued"
            if tracks_reparse_from_retained > 0
            else "completed"
            if manifest
            else "not_requested"
        )

        await run_in_threadpool(_persist_track_manifest_state, sb, import_id, manifest)
        _invalidate_path_map_cache(import_id)

        metadata_ready_at = _now_iso()
        import_updates = {
            "source_bundle_type": "usb_folder",
            "analysis_expected_track_count": len(manifest),
            "analysis_matched_track_count": max(0, len(manifest) - unavailable_tracks),
            "analysis_parsed_track_count": tracks_already_reusable,
            "analysis_failed_track_count": 0,
            "analysis_status": analysis_status,
            "library_ready_at": metadata_ready_at,
            "readiness_stage": (
                "analysis_complete" if affected_track_count == 0 else "library_metadata_ready"
            ),
            "required_analysis_file_count": required_analysis_file_count,
            "optional_archival_file_count": optional_archival_file_count,
            "optional_archival_status": (
                "queued" if settings.analysis_archive_2ex and optional_archival_file_count else "skipped"
            ),
            "raw_archival_status": (
                "queued" if settings.analysis_archive_raw_assets and required_analysis_file_count else "skipped"
            ),
            "analysis_queue_track_count": affected_track_count,
            "analysis_running_track_count": 0,
            "analysis_progress_processed_track_count": tracks_already_reusable + unavailable_tracks,
            "analysis_progress_total_track_count": len(manifest),
            "analysis_progress_updated_at": metadata_ready_at,
        }
        try:
            await run_in_threadpool(
                lambda: sb.table("rekordbox_imports").update(import_updates).eq(
                    "id", import_id
                ).eq("user_id", user_id).execute()
            )
        except Exception:
            logger.exception("Failed to persist progressive readiness for import %s", import_id)
            raise HTTPException(
                status_code=500,
                detail={
                    "error_code": "IMPORT_READINESS_WRITE_FAILED",
                    "detail": "Library metadata was imported, but readiness state could not be saved.",
                    "retryable": True,
                },
            )

        from .analysis_performance import ImportMetrics, merge_import_metrics
        readiness_metrics = ImportMetrics(import_id)
        readiness_metrics.timings_ms.update({
            "database_parse": round(parse_elapsed_ms, 3),
            "database_import": round(db_write_elapsed_ms, 3),
            "manifest_generation": round(
                max(0.0, (time.perf_counter() - request_started) * 1000.0 - parse_elapsed_ms - db_write_elapsed_ms),
                3,
            ),
            "total_time_to_library_ready": round(
                (time.perf_counter() - request_started) * 1000.0, 3
            ),
        })
        readiness_metrics.counts.update({
            "library_tracks": len(manifest),
            "tracks_reused": tracks_reused,
            "tracks_metadata_only": tracks_metadata_only,
            "tracks_requiring_analysis": affected_track_count,
            "required_analysis_files": required_analysis_file_count,
            "optional_archival_files": optional_archival_file_count,
        })
        readiness_metrics.bytes["database_upload"] = int(db_bytes or 0)
        await run_in_threadpool(merge_import_metrics, sb, import_id, readiness_metrics)

        return ImportStartResponse(
            import_id=import_id,
            analysis_status=analysis_status,
            expected_track_count=len(manifest),
            manifest=manifest,
            tracks_reused=tracks_reused,
            tracks_needing_upload=tracks_needing_upload,
            tracks_reparse_from_retained=tracks_reparse_from_retained,
            tracks_metadata_only=tracks_metadata_only,
            required_analysis_file_count=required_analysis_file_count,
            optional_archival_file_count=optional_archival_file_count,
            tracks_already_reusable=tracks_already_reusable,
            library_ready=True,
            readiness_stage=import_updates["readiness_stage"],
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


def _fetch_existing_assets_for_paths(
    sb,
    import_id: str,
    relative_paths: Sequence[str],
) -> Dict[str, dict]:
    if not relative_paths:
        return {}
    rows: List[dict] = []
    unique_paths = list(dict.fromkeys(path.lower() for path in relative_paths))
    for offset in range(0, len(unique_paths), 250):
        chunk = unique_paths[offset : offset + 250]
        response = (
            sb.table("rekordbox_analysis_assets")
            .select("*")
            .eq("import_id", import_id)
            .in_("relative_path", chunk)
            .execute()
        )
        rows.extend(response.data or [])
    return {str(row.get("relative_path") or "").lower(): row for row in rows}


def _bulk_upsert_assets(sb, rows: List[dict]) -> None:
    if not rows:
        return
    existing = [row for row in rows if row.get("id")]
    new_rows = [{k: v for k, v in row.items() if k != "id"} for row in rows if not row.get("id")]
    if existing:
        sb.table("rekordbox_analysis_assets").upsert(existing, on_conflict="id").execute()
    if new_rows:
        sb.table("rekordbox_analysis_assets").insert(new_rows).execute()


def _mark_batch_activity(
    sb,
    import_id: str,
    user_id: str,
    *,
    required_upload: bool,
    optional_upload: bool,
) -> None:
    updates: dict[str, Any] = {
        "analysis_progress_updated_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    if required_upload:
        updates.update({
            "analysis_status": "uploading",
            "analysis_worker_status": "running",
            "analysis_worker_stage": "staging_assets",
            "analysis_worker_current_track_id": None,
            "analysis_worker_heartbeat_at": _now_iso(),
            "analysis_worker_stopped_acknowledged": False,
            "analysis_worker_stopped_at": None,
        })
    if optional_upload:
        updates["optional_archival_status"] = "running"
    try:
        sb.table("rekordbox_imports").update(updates).eq("id", import_id).eq(
            "user_id", user_id
        ).execute()
    except Exception as exc:
        logger.warning("Failed to publish analysis batch activity for %s: %s", import_id, exc)


def _archive_optional_2ex_rows(
    sb,
    user_id: str,
    import_id: str,
    rows: Sequence[dict],
) -> int:
    """Archive an explicitly supplied optional .2EX batch without parsing it."""
    optional_rows = [
        dict(row)
        for row in rows
        if str(row.get("asset_type") or "") == "2EX"
        and str(row.get("upload_status") or "") not in {"uploaded", "archived"}
        and row.get("staging_key")
    ]
    if not optional_rows:
        return 0

    from .analysis_staging import create_archive, resolve_staging_key, staged_file_exists

    members: list[tuple[str, str]] = []
    by_key: dict[str, dict] = {}
    for row in optional_rows:
        staging_key = str(row["staging_key"])
        if not staged_file_exists(staging_key, settings.analysis_staging_root):
            continue
        member = f"{row.get('track_id')}/{Path(str(row.get('relative_path') or 'asset.2EX')).name}"
        members.append((staging_key, member))
        by_key[staging_key] = row
    if not members:
        return 0

    archive_path, member_map = create_archive(
        import_id, time.time_ns(), members, settings.analysis_staging_root
    )
    storage_path = f"{user_id}/{import_id}/archives/optional-{archive_path.name}"
    sb.storage.from_(_ANALYSIS_BUCKET).upload(
        path=storage_path,
        file=archive_path.read_bytes(),
        file_options={"upsert": "true", "content-type": "application/gzip"},
    )

    updates: list[dict] = []
    for staging_key, member_name in member_map.items():
        row = dict(by_key[staging_key])
        row.update({
            "upload_status": "archived",
            "parse_status": "not_requested",
            "archival_status": "archived",
            "archive_storage_bucket": _ANALYSIS_BUCKET,
            "archive_storage_path": storage_path,
            "archive_member_path": member_name,
        })
        updates.append(row)
    if updates:
        sb.table("rekordbox_analysis_assets").upsert(
            updates, on_conflict="import_id,relative_path"
        ).execute()
        for staging_key in member_map:
            try:
                resolve_staging_key(
                    staging_key, settings.analysis_staging_root
                ).unlink(missing_ok=True)
            except Exception as exc:
                logger.debug("Could not remove optional staging file %s: %s", staging_key, exc)
        archive_path.unlink(missing_ok=True)
    return len(updates)


def _mark_optional_archive_failed(sb, import_id: str, rows: Sequence[dict]) -> None:
    failed_rows: list[dict] = []
    for row in rows:
        if str(row.get("asset_type") or "") != "2EX":
            continue
        failed = dict(row)
        failed["upload_status"] = failed.get("upload_status") or "staged"
        failed["parse_status"] = "not_requested"
        failed["archival_status"] = "failed"
        failed_rows.append(failed)
    if failed_rows:
        sb.table("rekordbox_analysis_assets").upsert(
            failed_rows, on_conflict="import_id,relative_path"
        ).execute()


def _parse_file_metadata(raw: str | None) -> Dict[str, dict]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    if not isinstance(value, list):
        return {}
    result: Dict[str, dict] = {}
    for item in value:
        if not isinstance(item, dict):
            continue
        path = str(item.get("canonical_path") or "").lower()
        if not path:
            continue
        result[path] = {
            "size": int(item.get("size") or 0),
            "last_modified_ms": int(item.get("last_modified_ms") or 0),
        }
    return result


async def process_analysis_batch(
    import_id: str,
    user_id: str,
    files: List[UploadFile],
    file_metadata: str | None = None,
) -> BatchUploadResponse:
    """Validate and durably stage a bounded batch without a Storage round trip."""
    try:
        return await _process_analysis_batch_inner(
            import_id, user_id, files, file_metadata=file_metadata
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("process_analysis_batch failed for import %s", import_id)
        raise HTTPException(
            status_code=500,
            detail={
                "error_code": "ANALYSIS_BATCH_FAILED",
                "detail": "DropDex could not stage this analysis batch. Please retry.",
                "retryable": True,
            },
        ) from exc


async def _process_analysis_batch_inner(
    import_id: str,
    user_id: str,
    files: List[UploadFile],
    *,
    file_metadata: str | None = None,
) -> BatchUploadResponse:
    from dropdex_importer.analysis_paths import is_safe_path, normalize_anlz_path
    from .analysis_performance import ImportMetrics, merge_import_metrics
    from .analysis_staging import build_staging_key, staged_file_exists, write_staged_bytes

    if len(files) > settings.max_analysis_files_per_batch:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Too many files in batch. Maximum is "
                f"{settings.max_analysis_files_per_batch} per batch."
            ),
        )

    metrics = ImportMetrics(import_id)
    metrics.start("file_transfer")
    metrics.increment("upload_batches", 1)
    sb, path_map, built_map, import_row = await run_in_threadpool(
        _prepare_analysis_batch, import_id, user_id
    )
    metrics.increment("track_map_builds", 1 if built_map else 0)
    metadata_by_path = _parse_file_metadata(file_metadata)

    candidates: List[tuple[UploadFile, str, dict]] = []
    results: List[BatchFileResult] = []
    for upload in files:
        raw_path = upload.filename or ""
        if not raw_path or not is_safe_path(raw_path):
            results.append(BatchFileResult(
                canonical_path=raw_path or "(empty)",
                status="rejected",
                reject_reason="Invalid file path.",
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
        suffix = Path(canonical).suffix.lower()
        if suffix not in _VALID_ANLZ_SUFFIXES:
            results.append(BatchFileResult(
                canonical_path=canonical,
                status="rejected",
                reject_reason="File is not a supported ANLZ analysis file.",
            ))
            continue
        track_info = path_map.get(canonical.lower())
        if track_info is None:
            optional_reason = (
                "Optional .2EX archival is disabled for this import."
                if suffix == ".2ex" and not settings.analysis_archive_2ex
                else "File path is not requested by this import manifest."
            )
            results.append(BatchFileResult(
                canonical_path=canonical,
                status="skipped_optional" if suffix == ".2ex" else "rejected",
                reject_reason=optional_reason,
            ))
            continue
        candidates.append((upload, canonical, track_info))

    required_upload = any(not bool(info.get("optional_archival")) for _, _, info in candidates)
    optional_upload = any(bool(info.get("optional_archival")) for _, _, info in candidates)
    if (required_upload and (built_map or import_row.get("analysis_status") != "uploading")) or optional_upload:
        await run_in_threadpool(
            _mark_batch_activity,
            sb,
            import_id,
            user_id,
            required_upload=required_upload,
            optional_upload=optional_upload,
        )

    existing_by_path = await run_in_threadpool(
        _fetch_existing_assets_for_paths,
        sb,
        import_id,
        [canonical for _, canonical, _ in candidates],
    )

    total_batch_bytes = 0
    rows_to_write: List[dict] = []
    optional_rows_to_archive: List[dict] = []
    received_bytes = 0
    for upload, canonical, track_info in candidates:
        canonical_lower = canonical.lower()
        source_meta = metadata_by_path.get(canonical_lower, {})
        existing = existing_by_path.get(canonical_lower)
        expected_size = int(source_meta.get("size") or getattr(upload, "size", 0) or 0)
        expected_mtime = int(source_meta.get("last_modified_ms") or 0)
        unchanged_by_metadata = bool(
            existing
            and expected_size > 0
            and int(existing.get("size_bytes") or 0) == expected_size
            and expected_mtime > 0
            and int(existing.get("source_mtime_ms") or 0) == expected_mtime
            and (
                staged_file_exists(existing.get("staging_key"), settings.analysis_staging_root)
                or existing.get("archive_storage_path")
                or existing.get("storage_path")
            )
        )
        if unchanged_by_metadata:
            results.append(BatchFileResult(
                canonical_path=canonical,
                status="already_received",
                sha256=existing.get("sha256"),
                file_size=expected_size,
            ))
            if track_info.get("optional_archival") and existing:
                optional_rows_to_archive.append(existing)
            metrics.increment("assets_reused_without_hash", 1)
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
            results.append(BatchFileResult(
                canonical_path=canonical,
                status="rejected",
                reject_reason=(
                    exc.detail.get("detail")
                    if isinstance(exc.detail, dict)
                    else str(exc.detail)
                ),
            ))
            continue

        total_batch_bytes += len(content)
        if total_batch_bytes > settings.max_analysis_batch_bytes:
            results.append(BatchFileResult(
                canonical_path=canonical,
                status="rejected",
                reject_reason="Batch size limit exceeded. Please send a smaller batch.",
            ))
            continue

        sha256 = _sha256_bytes(content)
        if existing and existing.get("sha256") == sha256 and (
            staged_file_exists(existing.get("staging_key"), settings.analysis_staging_root)
            or existing.get("archive_storage_path")
            or existing.get("storage_path")
        ):
            results.append(BatchFileResult(
                canonical_path=canonical,
                status="already_received",
                sha256=sha256,
                file_size=len(content),
            ))
            if track_info.get("optional_archival"):
                optional_rows_to_archive.append(existing)
            metrics.increment("assets_reused_by_hash", 1)
            continue

        staging_key = build_staging_key(
            import_id,
            str(track_info["track_id"]),
            str(track_info["asset_type"]),
            sha256,
        )
        await run_in_threadpool(
            write_staged_bytes,
            staging_key,
            content,
            settings.analysis_staging_root,
        )
        source_fingerprint = "|".join((
            str(track_info.get("source_fingerprint") or ""),
            canonical_lower,
            str(len(content)),
            str(expected_mtime),
            sha256,
            _PARSER_VERSION,
            settings.analysis_feature_schema_version,
        ))
        row = dict(existing or {})
        row.update({
            "import_id": import_id,
            "track_id": track_info["track_id"],
            "asset_type": track_info["asset_type"],
            "relative_path": canonical_lower,
            "original_filename": Path(canonical).name,
            "sha256": sha256,
            "size_bytes": len(content),
            "storage_bucket": _ANALYSIS_BUCKET,
            "storage_path": existing.get("storage_path") if existing else None,
            "staging_key": staging_key,
            "source_mtime_ms": expected_mtime or None,
            "source_fingerprint": hashlib.sha256(source_fingerprint.encode("utf-8")).hexdigest(),
            "feature_schema_version": settings.analysis_feature_schema_version,
            "upload_status": "staged",
            "parse_status": "not_requested" if track_info.get("optional_archival") else "queued",
            "archival_status": (
                "queued"
                if track_info.get("optional_archival") or settings.analysis_archive_raw_assets
                else "skipped"
            ),
            "uploaded_at": _now_iso(),
        })
        rows_to_write.append(row)
        if track_info.get("optional_archival"):
            optional_rows_to_archive.append(row)
        results.append(BatchFileResult(
            canonical_path=canonical,
            status="received",
            sha256=sha256,
            file_size=len(content),
        ))
        received_bytes += len(content)
        metrics.increment("assets_staged", 1)
        metrics.add_bytes("assets_staged", len(content))

    try:
        await run_in_threadpool(_bulk_upsert_assets, sb, rows_to_write)
    except Exception:
        logger.exception("Bulk asset metadata write failed for import %s", import_id)
        received_paths = {str(row.get("relative_path")) for row in rows_to_write}
        for result in results:
            if result.canonical_path.lower() in received_paths and result.status == "received":
                result.status = "error"
                result.reject_reason = "The staged file could not be checkpointed. Please retry."
        received_bytes = 0

    if optional_rows_to_archive:
        try:
            with metrics.timed("optional_archival"):
                archived_count = await run_in_threadpool(
                    _archive_optional_2ex_rows,
                    sb,
                    user_id,
                    import_id,
                    optional_rows_to_archive,
                )
            metrics.increment("optional_assets_archived", archived_count)
        except Exception as exc:
            logger.warning("Optional .2EX archival deferred for import %s: %s", import_id, exc)
            try:
                await run_in_threadpool(
                    _mark_optional_archive_failed,
                    sb,
                    import_id,
                    optional_rows_to_archive,
                )
            except Exception:
                logger.exception("Could not persist optional archival failure for %s", import_id)

        optional_status = await run_in_threadpool(
            _resolve_optional_archival_status,
            sb,
            import_id,
            int(import_row.get("optional_archival_file_count") or 0),
        )
        try:
            await run_in_threadpool(
                lambda: sb.table("rekordbox_imports").update({
                    "optional_archival_status": optional_status,
                    "updated_at": _now_iso(),
                }).eq("id", import_id).eq("user_id", user_id).execute()
            )
        except Exception as exc:
            logger.warning("Could not publish optional archival status for %s: %s", import_id, exc)

    metrics.increment("asset_metadata_write_batches", 1 if rows_to_write else 0)
    metrics.stop("file_transfer")
    await run_in_threadpool(merge_import_metrics, sb, import_id, metrics)

    return BatchUploadResponse(
        import_id=import_id,
        received_count=sum(1 for result in results if result.status == "received"),
        already_received_count=sum(1 for result in results if result.status == "already_received"),
        rejected_count=sum(1 for result in results if result.status in {"rejected", "skipped_optional"}),
        error_count=sum(1 for result in results if result.status == "error"),
        received_bytes=received_bytes,
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
    if import_row.get("status") in {"cancelled", "failed", "deleting"}:
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
    _analysis_worker_checkpoint(import_id, user_id, "before_loading_assets", sb=sb)

    # Transition to 'parsing' before starting work
    try:
        sb.table("rekordbox_imports").update(
            {
                "analysis_status": "parsing",
                "analysis_current_track_id": None,
                "analysis_current_track_title": None,
                "analysis_current_track_artist": None,
                "analysis_current_track_label": None,
                "analysis_progress_updated_at": _now_iso(),
                "updated_at": _now_iso(),
            }
        ).eq("id", import_id).execute()
    except Exception as exc:
        logger.warning("Failed to set analysis_status=parsing for %s: %s", import_id, exc)

    from .supabase_pagination import fetch_all_rows  # noqa: PLC0415

    # Load all uploaded asset metadata so resume can publish full-library counts.
    def _asset_query():
        q = (
            sb.table("rekordbox_analysis_assets")
            .select("id, track_id, asset_type, relative_path, storage_path, sha256")
            .eq("import_id", import_id)
            .eq("upload_status", "uploaded")
        )
        return q

    uploaded_assets: List[dict] = fetch_all_rows(_asset_query, order_column="id")

    assets_by_track: Dict[str, List[dict]] = {}
    for asset in uploaded_assets:
        tid = asset.get("track_id")
        if tid:
            assets_by_track.setdefault(tid, []).append(asset)

    all_tracks = _get_tracks_with_paths(sb, import_id)
    track_status_by_id = {
        str(track.get("id")): str(track.get("analysis_parse_status") or "")
        for track in all_tracks
    }
    final_track_statuses = _FINAL_ANALYSIS_TRACK_STATUSES
    # Selective resume touches only requested tracks. A normal run or reload
    # resume never repeats tracks whose final track-status write already landed.
    tracks = _select_tracks_for_analysis(all_tracks, affected_track_ids)

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
        len(all_tracks),
        len(uploaded_assets),
        _dat_count,
        _ext_count,
        _2ex_count,
    )
    if _expected and len(all_tracks) != _expected:
        logger.warning(
            "complete: track count mismatch import=%s expected=%d loaded=%d — "
            "pagination issue or write failure",
            import_id,
            _expected,
            len(all_tracks),
        )

    from dropdex_importer.analysis_paths import (  # noqa: PLC0415
        derive_anlz_siblings,
        normalize_anlz_path,
    )

    track_results: List[TrackCompleteStatus] = []
    completed_count = partial_count = failed_count = missing_required_count = 0
    missing_optional_ext_count = missing_optional_2ex_count = 0

    tmp_dir: Optional[str] = None
    try:
        tmp_dir = tempfile.mkdtemp()
        total_track_count = len(all_tracks)
        already_finalized_count = sum(
            1 for status in track_status_by_id.values() if status in final_track_statuses
        )
        _set_analysis_progress(
            import_id,
            track=None,
            processed_track_count=already_finalized_count,
            total_track_count=total_track_count,
            sb=sb,
            force_persist=True,
        )

        for track in tracks:
            track_id = track["id"]
            _analysis_worker_checkpoint(
                import_id, user_id, "before_next_track", current_track_id=track_id, sb=sb
            )
            _set_analysis_progress(
                import_id,
                track=track,
                processed_track_count=already_finalized_count + len(track_results),
                total_track_count=total_track_count,
                sb=sb,
            )
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
                _analysis_worker_checkpoint(
                    import_id,
                    user_id,
                    "before_updating_track_status",
                    current_track_id=track_id,
                    sb=sb,
                )
                sb.table("rekordbox_tracks").update(
                    {
                        "analysis_parse_status": "missing_required",
                        "analysis_parse_warnings": [
                            {
                                "code": "SIBLING_MISSING",
                                "asset_type": "DAT",
                                "message": "Required DAT file was not uploaded.",
                                "detail": None,
                            }
                        ],
                    }
                ).eq("id", track_id).execute()
                track_status_by_id[str(track_id)] = "missing_required"
                _analysis_worker_checkpoint(
                    import_id, user_id, "after_track_completed", current_track_id=track_id, sb=sb
                )
                _set_analysis_progress(
                    import_id,
                    track=track,
                    processed_track_count=already_finalized_count + len(track_results),
                    total_track_count=total_track_count,
                    sb=sb,
                )
                continue

            local_paths: Dict[str, Optional[str]] = {"DAT": None, "EXT": None, "2EX": None}
            _analysis_worker_checkpoint(
                import_id, user_id, "before_downloading_assets", current_track_id=track_id, sb=sb
            )
            for asset in track_assets:
                _analysis_worker_checkpoint(
                    import_id, user_id, "downloading_asset", current_track_id=track_id, sb=sb
                )
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
                _analysis_worker_checkpoint(
                    import_id, user_id, "after_downloading_asset", current_track_id=track_id, sb=sb
                )

            _analysis_worker_checkpoint(
                import_id, user_id, "after_downloading_assets", current_track_id=track_id, sb=sb
            )
            _analysis_worker_checkpoint(
                import_id, user_id, "before_parsing", current_track_id=track_id, sb=sb
            )
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
                _analysis_worker_checkpoint(
                    import_id,
                    user_id,
                    "before_updating_track_status",
                    current_track_id=track_id,
                    sb=sb,
                )
                sb.table("rekordbox_tracks").update(
                    {
                        "analysis_parse_status": "failed",
                        "analysis_parse_warnings": [
                            {
                                "code": "PARSE_ERROR",
                                "asset_type": "BUNDLE",
                                "message": "An error occurred while parsing analysis files.",
                                "detail": None,
                            }
                        ],
                    }
                ).eq("id", track_id).execute()
                track_status_by_id[str(track_id)] = "failed"
                _analysis_worker_checkpoint(
                    import_id, user_id, "after_track_completed", current_track_id=track_id, sb=sb
                )
                _set_analysis_progress(
                    import_id,
                    track=track,
                    processed_track_count=already_finalized_count + len(track_results),
                    total_track_count=total_track_count,
                    sb=sb,
                )
                continue

            _analysis_worker_checkpoint(
                import_id, user_id, "after_parsing", current_track_id=track_id, sb=sb
            )
            parsed_count = 0
            asset_lookup = {a["asset_type"]: a for a in track_assets}
            _analysis_worker_checkpoint(
                import_id, user_id, "before_writing_asset_status", current_track_id=track_id, sb=sb
            )
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
            _analysis_worker_checkpoint(
                import_id,
                user_id,
                "after_writing_asset_status",
                current_track_id=track_id,
                sb=sb,
            )

            overall = bundle.overall_status

            # ── Feature extraction (each phase is isolated) ────────────────
            feature_statuses: Dict[str, str] = {}
            asset_ids = {
                "DAT": asset_lookup.get("DAT", {}).get("id"),
                "EXT": asset_lookup.get("EXT", {}).get("id"),
                "2EX": asset_lookup.get("2EX", {}).get("id"),
            }
            bg = None  # BeatGridResult; passed to phrase extraction

            _analysis_worker_checkpoint(
                import_id, user_id, "before_writing_beat_grid", current_track_id=track_id, sb=sb
            )
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

            _analysis_worker_checkpoint(
                import_id, user_id, "after_writing_beat_grid", current_track_id=track_id, sb=sb
            )
            _analysis_worker_checkpoint(
                import_id, user_id, "before_writing_waveform", current_track_id=track_id, sb=sb
            )
            try:
                from dropdex_importer.waveform_parser import extract_waveforms  # noqa: PLC0415

                from .analysis_feature_writer import write_waveform  # noqa: PLC0415

                wf = extract_waveforms(bundle.dat, bundle.ext, bundle.two_ex)
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

            _analysis_worker_checkpoint(
                import_id, user_id, "after_writing_waveform", current_track_id=track_id, sb=sb
            )
            _analysis_worker_checkpoint(
                import_id, user_id, "before_writing_cues", current_track_id=track_id, sb=sb
            )
            try:
                from dropdex_importer.cue_parser import parse_anlz_cues  # noqa: PLC0415

                from .analysis_feature_writer import reconcile_and_write_cues  # noqa: PLC0415

                cue_entries, cue_warns = parse_anlz_cues(bundle.dat, bundle.ext)
                ok = reconcile_and_write_cues(sb, import_id, track_id, cue_entries, cue_warns)
                feature_statuses["cues"] = "completed" if ok else "failed"
            except Exception as exc:
                logger.error("Cue extraction failed for track %s: %s", track_id, exc)
                feature_statuses["cues"] = "failed"

            _analysis_worker_checkpoint(
                import_id, user_id, "after_writing_cues", current_track_id=track_id, sb=sb
            )
            _analysis_worker_checkpoint(
                import_id, user_id, "before_writing_phrases", current_track_id=track_id, sb=sb
            )
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

            _analysis_worker_checkpoint(
                import_id, user_id, "after_writing_phrases", current_track_id=track_id, sb=sb
            )
            _analysis_worker_checkpoint(
                import_id, user_id, "before_updating_track_status", current_track_id=track_id, sb=sb
            )
            try:
                sb.table("rekordbox_tracks").update(
                    {
                        "analysis_parse_status": overall,
                        "analysis_parse_warnings": [w.as_dict() for w in (bundle.warnings or [])],
                        "analysis_feature_statuses": feature_statuses,
                    }
                ).eq("id", track_id).execute()
                track_status_by_id[str(track_id)] = overall
            except Exception as exc:
                logger.error("Failed to update track %s: %s", track_id, exc)
                overall = "failed"
                track_status_by_id[str(track_id)] = "failed"

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
            _analysis_worker_checkpoint(
                import_id, user_id, "after_track_completed", current_track_id=track_id, sb=sb
            )
            _set_analysis_progress(
                import_id,
                track=track,
                processed_track_count=already_finalized_count + len(track_results),
                total_track_count=total_track_count,
                sb=sb,
            )

    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    library_total_tracks = len(all_tracks)
    total_asset_count = len(uploaded_assets)
    durable_completed_count = sum(
        1 for status in track_status_by_id.values() if status in {"completed", "reused", "skipped"}
    )
    durable_partial_count = sum(
        1 for status in track_status_by_id.values() if status == "partial"
    )
    durable_failed_count = sum(
        1 for status in track_status_by_id.values() if status == "failed"
    )
    durable_missing_required_count = sum(
        1 for status in track_status_by_id.values() if status == "missing_required"
    )
    durable_problem_count = durable_failed_count + durable_missing_required_count
    durable_missing_optional_ext_count = sum(
        1
        for track in all_tracks
        if not any(
            asset.get("asset_type") == "EXT"
            for asset in assets_by_track.get(str(track.get("id")), [])
        )
    )
    durable_missing_optional_2ex_count = sum(
        1
        for track in all_tracks
        if not any(
            asset.get("asset_type") == "2EX"
            for asset in assets_by_track.get(str(track.get("id")), [])
        )
    )
    parsed_track_count = durable_completed_count + durable_partial_count
    durable_matched_track_count = sum(
        1
        for track in all_tracks
        if any(
            asset.get("asset_type") == "DAT"
            for asset in assets_by_track.get(str(track.get("id")), [])
        )
        or track_status_by_id.get(str(track.get("id"))) in final_track_statuses
    )

    if library_total_tracks == 0:
        final_status = "completed"
    elif parsed_track_count == 0 and durable_problem_count >= library_total_tracks:
        final_status = "failed"
    elif (
        durable_partial_count > 0
        or durable_problem_count > 0
        or parsed_track_count < library_total_tracks
    ):
        final_status = "partial"
    else:
        final_status = "completed"

    _analysis_worker_checkpoint(import_id, user_id, "before_finalizing", sb=sb)
    try:
        response = (
            sb.table("rekordbox_imports")
            .update(
                {
                    "analysis_status": final_status,
                    "analysis_matched_track_count": durable_matched_track_count,
                    "analysis_parsed_track_count": parsed_track_count,
                    "analysis_failed_track_count": durable_problem_count,
                    "analysis_asset_count": total_asset_count,
                    "analysis_parser_version": _PARSER_VERSION,
                    "analysis_completed_at": _now_iso(),
                    "analysis_progress_processed_track_count": library_total_tracks,
                    "analysis_progress_total_track_count": library_total_tracks,
                    "analysis_current_track_id": None,
                    "analysis_current_track_title": None,
                    "analysis_current_track_artist": None,
                    "analysis_current_track_label": None,
                    "analysis_progress_updated_at": _now_iso(),
                    "analysis_worker_status": "completed",
                    "analysis_worker_stage": "completed",
                    "analysis_worker_current_track_id": None,
                    "analysis_worker_heartbeat_at": _now_iso(),
                }
            )
            .eq("id", import_id)
            .in_("status", ["processing", "completed"])
            .execute()
        )
        if import_row.get("status") == "processing":
            complete_import_job(import_id, user_id)
            try:
                upsert_active_import(
                    settings.supabase_url, settings.supabase_secret_key, user_id, import_id
                )
            except Exception as activation_exc:
                # The import is already durably completed. Do not turn a successful
                # six-hour analysis run into an HTTP 500 merely because the active
                # pointer could not be updated in the same instant. The frontend
                # monitor retries activation when it observes the terminal row.
                logger.warning(
                    "Import %s completed but automatic activation failed: %s",
                    import_id,
                    activation_exc,
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
        total_tracks=library_total_tracks,
        completed_count=durable_completed_count,
        partial_count=durable_partial_count,
        failed_count=durable_failed_count,
        missing_required_count=durable_missing_required_count,
        missing_optional_ext_count=durable_missing_optional_ext_count,
        missing_optional_2ex_count=durable_missing_optional_2ex_count,
        parser_version=_PARSER_VERSION,
        tracks=track_results,
    )


def _run_complete_analysis_import_sync(
    import_id: str,
    user_id: str,
    affected_track_ids: Optional[List[str]] = None,
) -> CompleteResponse:
    """Own the worker lifecycle and always publish a stopped acknowledgement."""
    worker_registry.register(import_id)
    try:
        publish_worker_state(
            import_id,
            user_id,
            status="running",
            stage="starting",
            stopped_acknowledged=False,
            analysis_status="parsing",
        )
        result = _complete_analysis_import_sync(import_id, user_id, affected_track_ids)
        try:
            publish_worker_state(
                import_id,
                user_id,
                status="completed",
                stage="completed",
                stopped_acknowledged=True,
            )
        except Exception:
            logger.exception("Could not persist completed worker acknowledgement for %s", import_id)
        finally:
            # The in-process event is the cleanup barrier. Publish the worker's
            # last durable state before waking any delete waiter so no worker
            # write can land after destructive cleanup has started.
            worker_registry.acknowledge_stopped(import_id, status="completed")
        return result
    except (WorkerStopRequested, ImportCancelledError) as exc:
        snapshot = worker_registry.snapshot(import_id)
        reason = snapshot.get("stop_reason") or (
            "delete" if isinstance(exc, ImportCancelledError) else exc.reason
        )
        final_worker_status = "paused" if reason == "pause" else "stopped"
        final_analysis_status = "paused" if reason == "pause" else "stopping"
        try:
            publish_worker_state(
                import_id,
                user_id,
                status=final_worker_status,
                stage="stopped",
                stopped_acknowledged=True,
                analysis_status=final_analysis_status,
            )
        except Exception:
            logger.exception("Could not persist stopped worker acknowledgement for %s", import_id)
        finally:
            worker_registry.acknowledge_stopped(import_id, status=final_worker_status)
        if reason == "pause":
            finalize_paused_import(import_id, user_id)
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "ANALYSIS_PAUSED" if reason == "pause" else "DELETE_REQUESTED",
                "detail": (
                    "Analysis paused at a safe checkpoint."
                    if reason == "pause"
                    else "Analysis stopped and acknowledged the delete request."
                ),
                "retryable": reason == "pause",
            },
        ) from exc
    except HTTPException:
        try:
            publish_worker_state(
                import_id,
                user_id,
                status="failed",
                stage="failed",
                stopped_acknowledged=True,
                error="Analysis request failed.",
            )
        except Exception:
            logger.exception("Could not persist failed worker acknowledgement for %s", import_id)
        finally:
            worker_registry.acknowledge_stopped(import_id, status="failed")
        raise
    except Exception as exc:
        try:
            publish_worker_state(
                import_id,
                user_id,
                status="failed",
                stage="failed",
                stopped_acknowledged=True,
                error=str(exc)[:2000],
                analysis_status="failed",
            )
        except Exception:
            logger.exception("Could not persist failed worker diagnostics for %s", import_id)
        finally:
            worker_registry.acknowledge_stopped(import_id, status="failed", error=str(exc))
        raise


def _summarize_track_states(sb, import_id: str) -> dict[str, int]:
    from .supabase_pagination import fetch_all_rows

    rows = fetch_all_rows(
        lambda: (
            sb.table("rekordbox_tracks")
            .select("id, analysis_parse_status")
            .eq("import_id", import_id)
        ),
        order_column="id",
    )
    counts: dict[str, int] = {}
    for row in rows:
        status = str(row.get("analysis_parse_status") or "not_requested")
        counts[status] = counts.get(status, 0) + 1
    counts["total"] = len(rows)
    return counts


def _resolve_optional_archival_status(
    sb,
    import_id: str,
    expected_file_count: int,
) -> str:
    """Report optional .2EX archival independently from library readiness.

    Existing individual Storage objects count as durable archival, as do the
    bounded archive groups introduced by this patch. Missing optional files
    remain queued for an explicit later upload and never affect track success.
    """
    if not settings.analysis_archive_2ex or expected_file_count <= 0:
        return "skipped"

    from .supabase_pagination import fetch_all_rows

    rows = fetch_all_rows(
        lambda: (
            sb.table("rekordbox_analysis_assets")
            .select("id, upload_status, archival_status")
            .eq("import_id", import_id)
            .eq("asset_type", "2EX")
        ),
        order_column="id",
    )
    if any(
        str(row.get("upload_status") or "") == "failed"
        or str(row.get("archival_status") or "") == "failed"
        for row in rows
    ):
        return "failed"
    if len(rows) >= expected_file_count and all(
        str(row.get("upload_status") or "") in {"uploaded", "archived"}
        for row in rows
    ):
        return "completed"
    if any(
        str(row.get("upload_status") or "") == "uploading"
        or str(row.get("archival_status") or "") in {"queued", "archiving"}
        for row in rows
    ):
        return "running" if any(
            str(row.get("upload_status") or "") == "uploading"
            or str(row.get("archival_status") or "") == "archiving"
            for row in rows
        ) else "queued"
    return "queued"


def _run_fast_analysis_import_sync(
    import_id: str,
    user_id: str,
    affected_track_ids: Optional[List[str]] = None,
    *,
    worker_lease: DurableWorkerLease | None = None,
) -> CompleteResponse:
    """Run the bounded local-parser/single-writer pipeline with safe checkpoints."""
    from .analysis_fast_pipeline import run_fast_analysis_import

    worker_registry.register(import_id)
    sb = _create_supabase()
    started = time.perf_counter()
    last_durable_checkpoint = 0.0
    try:
        import_row = _require_import_for_user(sb, import_id, user_id)
        publish_worker_state(
            import_id,
            user_id,
            status="running",
            stage="loading_staged_assets",
            stopped_acknowledged=False,
            analysis_status="parsing",
        )
        total_queued = max(0, int(import_row.get("analysis_queue_track_count") or 0))
        running_now = min(max(1, settings.analysis_parser_workers), total_queued)
        sb.table("rekordbox_imports").update({
            "analysis_status": "parsing",
            "readiness_stage": "analysis_processing",
            "analysis_worker_status": "running",
            "analysis_worker_stage": "loading_staged_assets",
            "analysis_running_track_count": running_now,
            "analysis_queue_track_count": max(0, total_queued - running_now),
            "updated_at": _now_iso(),
        }).eq("id", import_id).eq("user_id", user_id).execute()

        def checkpoint(stage: str, current_track_id: str | None) -> None:
            # Patch 2's local signal is the hot-path pause/delete check. Durable
            # heartbeats are written by the batch progress callback, not before
            # and after every parser operation.
            worker_registry.checkpoint(
                import_id, stage, current_track_id=current_track_id
            )
            if worker_lease is not None:
                worker_lease.checkpoint(stage, current_track_id)

        def progress(track: dict[str, Any] | None, processed: int, total: int) -> None:
            nonlocal last_durable_checkpoint
            current_track_id = (
                str(track.get("id")) if track and track.get("id") else None
            )
            worker_registry.checkpoint(
                import_id,
                "feature_batch_committed",
                current_track_id=current_track_id,
            )
            if worker_lease is not None:
                worker_lease.checkpoint(
                    "feature_batch_committed", current_track_id, force=True
                )
            elapsed = max(0.001, time.perf_counter() - started)
            throughput = processed / elapsed if processed > 0 else None
            remaining = max(0, total - processed)
            eta = round(remaining / throughput) if throughput and processed >= 2 else None
            running_count = min(max(1, settings.analysis_parser_workers), remaining)
            queue_count = max(0, remaining - running_count)
            readiness_stage = "analysis_processing"
            _set_analysis_progress(
                import_id,
                track=track,
                processed_track_count=processed,
                total_track_count=total,
                sb=sb,
                force_persist=True,
            )
            now = time.monotonic()
            if now - last_durable_checkpoint >= 0.5 or processed >= total:
                sb.table("rekordbox_imports").update({
                    "readiness_stage": readiness_stage,
                    "analysis_queue_track_count": queue_count,
                    "analysis_running_track_count": running_count,
                    "analysis_throughput_tracks_per_second": throughput,
                    "analysis_estimated_seconds_remaining": eta,
                    "analysis_worker_stage": "feature_batch_committed",
                    "analysis_worker_current_track_id": (
                        str(track.get("id")) if track and track.get("id") else None
                    ),
                    "analysis_worker_heartbeat_at": _now_iso(),
                    "updated_at": _now_iso(),
                }).eq("id", import_id).eq("user_id", user_id).execute()
                last_durable_checkpoint = now

        result = run_fast_analysis_import(
            sb,
            import_id,
            user_id,
            affected_track_ids=affected_track_ids,
            parser_version=_PARSER_VERSION,
            checkpoint=checkpoint,
            progress=progress,
        )
        worker_registry.checkpoint(import_id, "finalizing_import")
        if worker_lease is not None:
            worker_lease.checkpoint("finalizing_import", force=True)
        state_counts = _summarize_track_states(sb, import_id)
        completed_count = state_counts.get("completed", 0) + state_counts.get("reused", 0)
        partial_count = state_counts.get("partial", 0)
        failed_count = state_counts.get("failed", 0)
        missing_required_count = state_counts.get("missing_required", 0)
        skipped_count = state_counts.get("skipped", 0)
        total_tracks = int(import_row.get("analysis_expected_track_count") or state_counts["total"])
        finalized = completed_count + partial_count + failed_count + missing_required_count + skipped_count
        if total_tracks == 0:
            final_status = "completed"
        elif completed_count == 0 and partial_count == 0 and failed_count + missing_required_count >= total_tracks:
            final_status = "failed"
        elif failed_count or missing_required_count or partial_count or finalized < total_tracks:
            final_status = "partial"
        else:
            final_status = "completed"

        archival_status = _resolve_optional_archival_status(
            sb,
            import_id,
            int(import_row.get("optional_archival_file_count") or 0),
        )
        sb.table("rekordbox_imports").update({
            "analysis_status": final_status,
            "readiness_stage": "analysis_complete" if final_status == "completed" else "analysis_partial",
            "analysis_matched_track_count": min(
                total_tracks, completed_count + partial_count + failed_count
            ),
            "analysis_parsed_track_count": completed_count + partial_count,
            "analysis_failed_track_count": failed_count + missing_required_count,
            "analysis_asset_count": result.get("metrics").counts.get("assets_loaded", 0),
            "analysis_parser_version": _PARSER_VERSION,
            "analysis_completed_at": _now_iso(),
            "analysis_queue_track_count": 0,
            "analysis_running_track_count": 0,
            "analysis_estimated_seconds_remaining": 0,
            "optional_archival_status": archival_status,
            "raw_archival_status": (
                "queued" if settings.analysis_archive_raw_assets else "skipped"
            ),
            "analysis_worker_status": "completed",
            "analysis_worker_stage": "completed",
            "analysis_worker_current_track_id": None,
            "analysis_worker_heartbeat_at": _now_iso(),
            "analysis_worker_stopped_acknowledged": True,
            "updated_at": _now_iso(),
        }).eq("id", import_id).eq("user_id", user_id).execute()
        try:
            complete_import_job(import_id, user_id)
        except HTTPException:
            # Legacy imports may already be completed while analysis is resumed.
            pass
        try:
            upsert_active_import(
                settings.supabase_url, settings.supabase_secret_key, user_id, import_id
            )
        except Exception as exc:
            logger.warning("Could not refresh active import pointer for %s: %s", import_id, exc)
        publish_worker_state(
            import_id,
            user_id,
            status="completed",
            stage="completed",
            stopped_acknowledged=True,
            analysis_status=final_status,
        )
        worker_registry.acknowledge_stopped(import_id, status="completed")
        raw_archival_started = False
        try:
            raw_archival_started = start_raw_archival(_create_supabase(), import_id, user_id)
        except Exception as exc:
            logger.warning("Could not queue trailing raw archival for %s: %s", import_id, exc)
            sb.table("rekordbox_imports").update({
                "raw_archival_status": "failed",
                "updated_at": _now_iso(),
            }).eq("id", import_id).eq("user_id", user_id).execute()
        raw_archival_status = (
            "running" if raw_archival_started else (
                "queued" if settings.analysis_archive_raw_assets else "skipped"
            )
        )
        return CompleteResponse(
            import_id=import_id,
            analysis_status=final_status,
            total_tracks=total_tracks,
            completed_count=completed_count,
            partial_count=partial_count,
            failed_count=failed_count,
            missing_required_count=missing_required_count,
            missing_optional_ext_count=0,
            missing_optional_2ex_count=0,
            parser_version=_PARSER_VERSION,
            tracks=[],
            background_started=False,
            library_ready=True,
            readiness_stage="analysis_complete" if final_status == "completed" else "analysis_partial",
            queued_track_count=0,
            optional_archival_status=archival_status,
            raw_archival_status=raw_archival_status,
        )
    except (WorkerStopRequested, ImportCancelledError) as exc:
        snapshot = worker_registry.snapshot(import_id)
        reason = snapshot.get("stop_reason") or (
            "delete" if isinstance(exc, ImportCancelledError) else exc.reason
        )
        status = "paused" if reason == "pause" else "stopped"
        try:
            publish_worker_state(
                import_id,
                user_id,
                status=status,
                stage="stopped",
                stopped_acknowledged=True,
                analysis_status="paused" if reason == "pause" else "stopping",
            )
            sb.table("rekordbox_imports").update({
                "readiness_stage": "analysis_paused" if reason == "pause" else "analysis_partial",
                "analysis_running_track_count": 0,
                "analysis_worker_stopped_acknowledged": True,
                "updated_at": _now_iso(),
            }).eq("id", import_id).eq("user_id", user_id).execute()
        finally:
            worker_registry.acknowledge_stopped(import_id, status=status)
        if reason == "pause":
            finalize_paused_import(import_id, user_id)
        raise
    except WorkerLeaseLost:
        # Another process acquired the expired lease. Stop immediately and do
        # not publish stale final state over the new owner.
        worker_registry.acknowledge_stopped(import_id, status="interrupted")
        raise
    except Exception as exc:
        logger.exception("Fast analysis worker failed for import %s", import_id)
        try:
            sb.table("rekordbox_imports").update({
                "analysis_status": "partial",
                "readiness_stage": "analysis_partial",
                "analysis_running_track_count": 0,
                "analysis_worker_status": "failed",
                "analysis_worker_stage": "failed",
                "analysis_worker_stopped_acknowledged": True,
                "error_code": "ANALYSIS_WORKER_FAILED",
                "error_message": "Background analysis stopped unexpectedly. Resume is available.",
                "retryable": True,
                "updated_at": _now_iso(),
            }).eq("id", import_id).eq("user_id", user_id).execute()
        except Exception:
            logger.exception("Could not persist fast worker failure for %s", import_id)
        worker_registry.acknowledge_stopped(import_id, status="failed", error=str(exc))
        raise
    finally:
        with _BACKGROUND_WORKER_LOCK:
            current = _BACKGROUND_WORKERS.get(import_id)
            if current is threading.current_thread():
                _BACKGROUND_WORKERS.pop(import_id, None)


def _background_analysis_entry(
    import_id: str,
    user_id: str,
    affected_track_ids: Optional[List[str]],
    worker_lease: DurableWorkerLease,
) -> None:
    finalize_pause_after_release = False
    try:
        _run_fast_analysis_import_sync(
            import_id,
            user_id,
            affected_track_ids,
            worker_lease=worker_lease,
        )
    except WorkerStopRequested as exc:
        finalize_pause_after_release = exc.reason == "pause"
        logger.info("Background analysis %s stopped at a safe checkpoint", import_id)
    except ImportCancelledError:
        logger.info("Background analysis %s stopped at a safe checkpoint", import_id)
    except WorkerLeaseLost:
        logger.warning(
            "Background analysis %s stopped after losing its durable worker lease",
            import_id,
        )
    except Exception:
        # State is persisted by _run_fast_analysis_import_sync. Never crash the API process.
        logger.exception("Background analysis thread ended for import %s", import_id)
    finally:
        try:
            worker_lease.release()
        except Exception:
            logger.exception("Could not release analysis lease for import %s", import_id)
        if finalize_pause_after_release:
            # The worker-side pause handler runs while this lease is still valid,
            # so its first finalization attempt intentionally does nothing. Once
            # ownership is released, persist the paused state even if the API's
            # bounded wait already returned `stopping`.
            try:
                finalize_paused_import(import_id, user_id)
            except Exception:
                logger.exception(
                    "Could not finalize paused analysis after lease release for %s",
                    import_id,
                )


def _start_background_analysis(
    import_id: str,
    user_id: str,
    affected_track_ids: Optional[List[str]],
) -> bool:
    with _BACKGROUND_WORKER_LOCK:
        existing = _BACKGROUND_WORKERS.get(import_id)
        if existing and existing.is_alive():
            return False
        sb = _create_supabase()
        try:
            worker_lease = DurableWorkerLease.claim(sb, import_id, user_id, "analysis")
        except WorkerLeaseConflict:
            logger.info("Analysis import %s is already leased by another worker", import_id)
            return False
        worker_lease.start_heartbeat()
        thread = threading.Thread(
            target=_background_analysis_entry,
            args=(import_id, user_id, affected_track_ids, worker_lease),
            name=f"dropdex-analysis-{str(import_id)[:8]}",
            daemon=True,
        )
        _BACKGROUND_WORKERS[import_id] = thread
        try:
            thread.start()
        except Exception:
            _BACKGROUND_WORKERS.pop(import_id, None)
            worker_lease.release()
            raise
        return True


def resume_recoverable_analysis_imports() -> int:
    """Restart only jobs interrupted by process shutdown, never user-paused jobs."""
    sb = _create_supabase()
    response = (
        sb.table("rekordbox_imports")
        .select("id, user_id")
        .eq("status", "interrupted")
        .in_("analysis_status", ["queued", "uploading", "parsing", "partial", "interrupted"])
        .execute()
    )
    started = 0
    for row in response.data or []:
        import_id = str(row.get("id") or "")
        user_id = str(row.get("user_id") or "")
        if import_id and user_id and _start_background_analysis(import_id, user_id, None):
            started += 1
    return started


async def complete_analysis_import(
    import_id: str,
    user_id: str,
    affected_track_ids: Optional[List[str]] = None,
    *,
    background: bool = False,
    client_metrics: Optional[Dict[str, Any]] = None,
) -> CompleteResponse:
    """Queue fast analysis for API callers while preserving synchronous test compatibility."""
    if not background:
        return await run_in_threadpool(
            _run_complete_analysis_import_sync, import_id, user_id, affected_track_ids
        )

    sb = await run_in_threadpool(_create_supabase)
    row = await run_in_threadpool(_require_import_for_user, sb, import_id, user_id)
    # Upload dispatch is complete before this endpoint is called. Release the
    # cached path plan; a later retry can rebuild it from persisted manifest state.
    _invalidate_path_map_cache(import_id)
    if client_metrics:
        from .analysis_performance import merge_import_metrics, sanitize_client_import_metrics

        safe_client_metrics = sanitize_client_import_metrics(client_metrics)
        if safe_client_metrics:
            await run_in_threadpool(
                merge_import_metrics, sb, import_id, safe_client_metrics
            )
    queued_count = len(set(affected_track_ids or [])) or int(
        row.get("analysis_queue_track_count") or row.get("analysis_expected_track_count") or 0
    )
    if queued_count == 0:
        return CompleteResponse(
            import_id=import_id,
            analysis_status="completed",
            total_tracks=int(row.get("analysis_expected_track_count") or 0),
            completed_count=int(row.get("analysis_parsed_track_count") or 0),
            partial_count=0,
            failed_count=int(row.get("analysis_failed_track_count") or 0),
            missing_required_count=0,
            parser_version=_PARSER_VERSION,
            tracks=[],
            library_ready=True,
            readiness_stage="analysis_complete",
            optional_archival_status=str(row.get("optional_archival_status") or "skipped"),
            raw_archival_status=str(row.get("raw_archival_status") or "skipped"),
        )
    await run_in_threadpool(
        lambda: sb.table("rekordbox_imports").update({
            "analysis_status": "queued",
            "readiness_stage": "library_metadata_ready",
            "analysis_queue_track_count": queued_count,
            "analysis_worker_status": "queued",
            "analysis_worker_stage": "queued",
            "analysis_worker_stopped_acknowledged": False,
            "updated_at": _now_iso(),
        }).eq("id", import_id).eq("user_id", user_id).execute()
    )
    started = await run_in_threadpool(
        _start_background_analysis, import_id, user_id, affected_track_ids
    )
    return CompleteResponse(
        import_id=import_id,
        analysis_status="queued",
        total_tracks=int(row.get("analysis_expected_track_count") or queued_count),
        completed_count=int(row.get("analysis_parsed_track_count") or 0),
        partial_count=0,
        failed_count=int(row.get("analysis_failed_track_count") or 0),
        missing_required_count=0,
        parser_version=_PARSER_VERSION,
        tracks=[],
        background_started=started,
        library_ready=True,
        readiness_stage="library_metadata_ready",
        queued_track_count=queued_count,
        optional_archival_status=str(row.get("optional_archival_status") or "skipped"),
        raw_archival_status=str(row.get("raw_archival_status") or "skipped"),
    )


async def resume_analysis_import(
    import_id: str,
    user_id: str,
    affected_track_ids: Optional[List[str]] = None,
    *,
    background: bool = False,
    client_metrics: Optional[Dict[str, Any]] = None,
) -> CompleteResponse:
    """Resume retained analysis work and skip tracks already finalized."""
    sb = _create_supabase()
    row = _require_import_for_user(sb, import_id, user_id)
    if row.get("status") in {"cancelled", "deleting", "failed"}:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "IMPORT_NOT_RESUMABLE",
                "detail": f"Import is {row.get('status')} and cannot be resumed.",
                "retryable": False,
            },
        )
    snapshot = worker_registry.snapshot(import_id)
    if snapshot.get("active"):
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "ANALYSIS_ALREADY_RUNNING",
                "detail": "Analysis is already running.",
                "retryable": False,
            },
        )
    job_status = str(row.get("status") or "")
    analysis_status = str(row.get("analysis_status") or "")
    if job_status in {"pause_requested", "stopping", "cancel_requested"} or analysis_status in {
        "pause_requested",
        "stopping",
    }:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "ANALYSIS_STILL_STOPPING",
                "detail": "Wait for the worker's stopped acknowledgement before resuming.",
                "retryable": True,
            },
        )
    if job_status not in {"paused", "interrupted", "completed"}:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "IMPORT_NOT_RESUMABLE",
                "detail": f"Import is {job_status or 'unknown'} and cannot be resumed.",
                "retryable": False,
            },
        )
    worker_registry.clear_stop_requests(import_id)
    updates = {
        "analysis_status": "parsing",
        "analysis_worker_status": "queued",
        "analysis_worker_stage": "resume_queued",
        "analysis_worker_current_track_id": None,
        "analysis_worker_stopped_acknowledged": False,
        "analysis_worker_stopped_at": None,
        "error_code": None,
        "error_message": None,
        "retryable": False,
        "updated_at": _now_iso(),
    }
    if job_status in {"paused", "interrupted"}:
        updates["status"] = "processing"
    sb.table("rekordbox_imports").update(updates).eq("id", import_id).eq(
        "user_id", user_id
    ).execute()
    return await complete_analysis_import(
        import_id,
        user_id,
        affected_track_ids=affected_track_ids,
        background=background,
        client_metrics=client_metrics,
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

    tracks = _get_tracks_for_analysis_status(sb, import_id)

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
        if status in {"staged", "uploaded", "archived"}:
            uploaded_by_type[atype].add(path_lower)
        elif status in ("failed", "error"):
            failed_uploads_by_type[atype].add(path_lower)

    missing_required: List[str] = []
    missing_optional_ext: List[str] = []
    missing_optional_2ex: List[str] = []
    unresolved_targets: List[ResumeTargetItem] = []
    affected_track_ids: set = set()

    for track in tracks:
        track_id = str(track.get("id") or "")
        rekordbox_content_id = track.get("rekordbox_content_id")
        manifest_status = str(track.get("analysis_manifest_status") or "needs_analysis")
        parse_status = str(track.get("analysis_parse_status") or "not_requested")
        raw = track.get("analysis_data_file_path") or ""
        canonical = normalize_anlz_path(raw)
        if not canonical:
            continue
        dat_path, ext_path, _two_ex_path = derive_anlz_siblings(canonical)

        # Reused, metadata-only, and unavailable tracks are already final and
        # never become USB resume targets merely because this import owns no raw
        # asset row. Retained reparses resume from their prior source object.
        if manifest_status in {"reused", "metadata_only", "unavailable"}:
            continue
        if manifest_status == "reparse_from_retained":
            if parse_status in {"failed", "missing_required", "partial"}:
                unresolved_targets.append(
                    ResumeTargetItem(
                        track_id=track_id,
                        rekordbox_content_id=rekordbox_content_id,
                        relative_path=dat_path,
                        asset_type="DAT",
                        required=False,
                        status="parse_failed",
                        reason="Retry parsing from the retained source asset.",
                        attempt_count=None,
                    )
                )
            if parse_status not in _FINAL_ANALYSIS_TRACK_STATUSES:
                affected_track_ids.add(track_id)
            continue
        if parse_status in _FINAL_ANALYSIS_TRACK_STATUSES:
            continue

        requested_types = _required_asset_types_for_status(manifest_status)
        track_has_target = False
        specs = []
        if "DAT" in requested_types:
            specs.append((dat_path, "DAT", True))
        if "EXT" in requested_types:
            specs.append((ext_path, "EXT", manifest_status == "needs_ext"))

        for relative_path, asset_type, required in specs:
            lower = relative_path.lower()
            if lower in uploaded_by_type[asset_type]:
                continue
            upload_failed = lower in failed_uploads_by_type[asset_type]
            if asset_type == "DAT":
                missing_required.append(relative_path)
            else:
                missing_optional_ext.append(relative_path)
            unresolved_targets.append(
                ResumeTargetItem(
                    track_id=track_id,
                    rekordbox_content_id=rekordbox_content_id,
                    relative_path=relative_path,
                    asset_type=asset_type,
                    required=required,
                    status="upload_failed"
                    if upload_failed
                    else "missing"
                    if required
                    else "optional_missing",
                    reason="Upload failed; retry this asset." if upload_failed else None,
                    attempt_count=None,
                )
            )
            track_has_target = True

        if parse_status in {"failed", "missing_required", "partial"} and not track_has_target:
            unresolved_targets.append(
                ResumeTargetItem(
                    track_id=track_id,
                    rekordbox_content_id=rekordbox_content_id,
                    relative_path=dat_path,
                    asset_type="DAT",
                    required=True,
                    status="parse_failed",
                    reason=str(track.get("analysis_failure_reason") or "Retry parsing retained staged assets."),
                    attempt_count=None,
                )
            )
        affected_track_ids.add(track_id)

    # .2EX is optional archival work and is intentionally absent from the
    # readiness/resume target list. Existing retained .2EX rows stay readable.

    # Summary counts from structured targets
    missing_required_count = sum(
        1 for t in unresolved_targets if t.required and t.status in ("missing", "parse_failed")
    )
    missing_optional_count = sum(
        1 for t in unresolved_targets if not t.required and t.status == "optional_missing"
    )
    failed_upload_count = sum(1 for t in unresolved_targets if t.status == "upload_failed")
    failed_parse_count = sum(1 for t in unresolved_targets if t.status == "parse_failed")

    analysis_status = import_row.get("analysis_status") or "unknown"
    expected_track_count = int(import_row.get("analysis_expected_track_count") or len(tracks) or 0)
    final_track_statuses = {"completed", "partial", "failed", "skipped", "reused"}
    completed_track_count = sum(
        1
        for track in tracks
        if str(track.get("analysis_parse_status") or "") in {"completed", "reused"}
    )
    partial_track_count = sum(
        1 for track in tracks if str(track.get("analysis_parse_status") or "") == "partial"
    )
    analysis_ready_track_count = sum(
        1
        for track in tracks
        if str(track.get("analysis_parse_status") or "")
        in {"completed", "partial", "reused", "skipped"}
    )
    derived_parsed_track_count = sum(
        1 for t in tracks if (t.get("analysis_parse_status") or "") in final_track_statuses
    )
    persisted_progress = {
        "processed_track_count": import_row.get("analysis_progress_processed_track_count"),
        "total_track_count": import_row.get("analysis_progress_total_track_count"),
        "current_track_id": import_row.get("analysis_current_track_id"),
        "current_track_title": import_row.get("analysis_current_track_title"),
        "current_track_artist": import_row.get("analysis_current_track_artist"),
        "current_track_label": import_row.get("analysis_current_track_label"),
        "updated_at": import_row.get("analysis_progress_updated_at"),
    }
    live_progress = persisted_progress if analysis_status == "parsing" else {}
    if analysis_status == "parsing":
        # Same-process memory can be slightly fresher than the throttled DB
        # heartbeat, while persisted data remains correct across workers.
        memory_progress = _get_live_analysis_progress(import_id)
        if memory_progress:
            live_progress = {**persisted_progress, **memory_progress}
    live_processed_track_count = int(live_progress.get("processed_track_count") or 0)
    live_total_track_count = int(live_progress.get("total_track_count") or 0)
    if live_total_track_count > expected_track_count:
        expected_track_count = live_total_track_count

    parsed_track_count = max(
        int(import_row.get("analysis_parsed_track_count") or 0),
        derived_parsed_track_count,
        live_processed_track_count,
    )
    if expected_track_count > 0:
        parsed_track_count = min(parsed_track_count, expected_track_count)
        progress_percent = round((parsed_track_count / expected_track_count) * 100)
    else:
        progress_percent = 0
    progress_percent = max(0, min(progress_percent, 100))

    current_track: Optional[dict] = None
    current_track_id = live_progress.get("current_track_id")
    if current_track_id:
        current_track = next((t for t in tracks if str(t.get("id")) == str(current_track_id)), None)
    if current_track is None and analysis_status == "parsing":
        current_track = next(
            (
                t
                for t in tracks
                if (t.get("analysis_parse_status") or "") not in final_track_statuses
            ),
            None,
        )

    current_track_label = (
        str(live_progress.get("current_track_label"))
        if live_progress.get("current_track_label")
        else _format_current_track_label(current_track)
    )

    worker_snapshot = worker_registry.snapshot(import_id)
    durable_lease = get_worker_lease(sb, import_id, "analysis")
    durable_worker_active = lease_row_is_active(durable_lease)
    return AnalysisStatusResponse(
        import_id=import_id,
        analysis_status=analysis_status,
        expected_track_count=expected_track_count,
        matched_track_count=import_row.get("analysis_matched_track_count", 0),
        parsed_track_count=parsed_track_count,
        completed_track_count=completed_track_count,
        partial_track_count=partial_track_count,
        failed_track_count=import_row.get("analysis_failed_track_count", 0),
        asset_count=import_row.get("analysis_asset_count", 0),
        missing_required_paths=missing_required,
        missing_optional_ext=missing_optional_ext,
        missing_optional_2ex=missing_optional_2ex,
        parser_version=import_row.get("analysis_parser_version"),
        warnings=import_row.get("analysis_warnings") or [],
        current_track_id=(
            str(current_track.get("id"))
            if current_track and current_track.get("id")
            else (str(current_track_id) if current_track_id else None)
        ),
        current_track_title=(
            str(current_track.get("title")).strip()
            if current_track and current_track.get("title")
            else live_progress.get("current_track_title")
        ),
        current_track_artist=(
            str(current_track.get("artist")).strip()
            if current_track and current_track.get("artist")
            else live_progress.get("current_track_artist")
        ),
        current_track_label=current_track_label,
        progress_percent=progress_percent,
        unresolved_targets=unresolved_targets,
        missing_required_count=missing_required_count,
        missing_optional_count=missing_optional_count,
        failed_upload_count=failed_upload_count,
        failed_parse_count=failed_parse_count,
        affected_track_count=len(affected_track_ids),
        job_status=str(import_row.get("status") or "unknown"),
        worker_status=str(
            worker_snapshot.get("worker_status")
            or import_row.get("analysis_worker_status")
            or "idle"
        ),
        worker_active=bool(worker_snapshot.get("active") or durable_worker_active),
        worker_stage=(
            worker_snapshot.get("current_stage")
            or (durable_lease or {}).get("stage")
            or import_row.get("analysis_worker_stage")
        ),
        worker_last_heartbeat=(
            worker_snapshot.get("last_heartbeat")
            or (durable_lease or {}).get("heartbeat_at")
            or import_row.get("analysis_worker_heartbeat_at")
        ),
        worker_stopped_acknowledged=bool(
            not durable_worker_active
            and (
                worker_snapshot.get("stopped_acknowledged")
                or import_row.get("analysis_worker_stopped_acknowledged")
            )
        ),
        library_ready=bool(import_row.get("library_ready_at")),
        readiness_stage=str(import_row.get("readiness_stage") or "library_metadata_ready"),
        required_analysis_file_count=int(import_row.get("required_analysis_file_count") or 0),
        optional_archival_file_count=int(import_row.get("optional_archival_file_count") or 0),
        tracks_ready_count=max(0, analysis_ready_track_count),
        tracks_remaining_count=max(0, expected_track_count - parsed_track_count),
        tracks_queued_count=int(import_row.get("analysis_queue_track_count") or 0),
        tracks_running_count=int(import_row.get("analysis_running_track_count") or 0),
        optional_archival_status=str(import_row.get("optional_archival_status") or "skipped"),
        raw_archival_status=str(import_row.get("raw_archival_status") or "skipped"),
        measured_tracks_per_second=(
            float(import_row["analysis_throughput_tracks_per_second"])
            if import_row.get("analysis_throughput_tracks_per_second") is not None
            else None
        ),
        estimated_seconds_remaining=(
            int(import_row["analysis_estimated_seconds_remaining"])
            if import_row.get("analysis_estimated_seconds_remaining") is not None
            else None
        ),
        performance_metrics=import_row.get("performance_metrics") or {},
    )


async def get_analysis_status(import_id: str, user_id: str) -> AnalysisStatusResponse:
    """Load the potentially large import status view outside the event loop."""
    return await run_in_threadpool(_get_analysis_status_sync, import_id, user_id)
