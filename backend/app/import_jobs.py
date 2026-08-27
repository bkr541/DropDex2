"""Durable import-job state transitions and cooperative cancellation."""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi import HTTPException

from .analysis_worker_lease import get_worker_lease, lease_row_is_active
from .config import settings
from .import_worker_registry import worker_registry
from .retained_analysis_dependencies import (
    begin_rekordbox_hard_delete,
    reconcile_retained_analysis_dependencies,
    rekordbox_metadata_delete_block,
)
from .supabase_pagination import fetch_all_rows

logger = logging.getLogger(__name__)

IMPORT_STATES = frozenset(
    {
        "created",
        "uploading",
        "queued",
        "processing",
        "running",
        "pause_requested",
        "paused",
        "cancel_requested",
        "stopping",
        "deleting",
        "cancelled",
        "completed",
        "failed",
        "interrupted",
    }
)
TERMINAL_IMPORT_STATES = frozenset({"cancelled", "completed", "failed"})
IMMUTABLE_IMPORT_STATES = frozenset({"cancelled"})
CANCELLATION_STATES = frozenset({"cancel_requested", "stopping", "deleting", "cancelled"})
DELETE_ACTIVE_STRATEGIES = frozenset({"activate_next", "start_over"})

_ANALYSIS_STORAGE_BUCKET = "rekordbox-analysis-assets"
_STORAGE_DELETE_BATCH_SIZE = 100
_STORAGE_REFERENCE_QUERY_CHUNK = 20


_ACTIVE_ANALYSIS_STATES = frozenset({"awaiting_upload", "uploading", "uploaded", "parsing", "pause_requested", "stopping"})


def _metadata_delete_http_exception(block: str) -> HTTPException:
    if block == "recovery":
        return HTTPException(
            status_code=409,
            detail={
                "error_code": "DELETE_METADATA_RECOVERY_LOCKED",
                "detail": (
                    "This library has a verified or unresolved local Genre apply that still needs "
                    "cloud recovery. Resolve the Pending Changes recovery state before deleting it."
                ),
                "retryable": False,
            },
        )
    return HTTPException(
        status_code=409,
        detail={
            "error_code": "DELETE_METADATA_PENDING",
            "detail": (
                "This library still has pending Genre changes. Apply or discard those changes "
                "before permanently deleting the library."
            ),
            "retryable": False,
        },
    )


def _metadata_delete_block_from_exception(exc: Exception) -> str | None:
    text = str(exc).lower()
    marker = "metadata_delete_blocked:"
    if marker not in text:
        return None
    suffix = text.split(marker, 1)[1]
    if suffix.startswith("recovery"):
        return "recovery"
    if suffix.startswith("pending"):
        return "pending"
    return None


def _ensure_metadata_delete_allowed(sb, import_id: str, user_id: str) -> None:
    try:
        block = rekordbox_metadata_delete_block(sb, import_id, user_id)
    except Exception as exc:
        if "import not found" in str(exc).lower():
            raise HTTPException(status_code=404, detail="Import job not found") from exc
        raise
    if block is not None:
        raise _metadata_delete_http_exception(block)


def _terminal_consistency_updates(row: dict[str, Any], new_state: str) -> dict[str, Any]:
    """Return subordinate fields that keep a terminal import internally truthful.

    Older deployments could leave rows such as status=failed with
    analysis_status=parsing, which made the UI continue presenting dead work as
    active. The durable job state is authoritative; terminal transitions clear
    live progress labels and terminate any active analysis sub-state.
    """
    if new_state not in TERMINAL_IMPORT_STATES:
        return {}

    now = _now()
    updates: dict[str, Any] = {
        "analysis_current_track_id": None,
        "analysis_current_track_title": None,
        "analysis_current_track_artist": None,
        "analysis_current_track_label": None,
        "analysis_progress_updated_at": now,
    }
    analysis_status = row.get("analysis_status")

    if new_state == "completed":
        updates.update({"error_code": None, "error_message": None, "retryable": False})
        if analysis_status in _ACTIVE_ANALYSIS_STATES:
            expected = max(0, int(row.get("analysis_expected_track_count") or 0))
            parsed = max(0, int(row.get("analysis_parsed_track_count") or 0))
            failed = max(0, int(row.get("analysis_failed_track_count") or 0))
            if expected == 0:
                normalized = "not_requested"
            elif parsed >= expected and failed == 0:
                normalized = "completed"
            elif parsed > 0:
                normalized = "partial"
            else:
                normalized = "failed"
            updates["analysis_status"] = normalized
            updates["analysis_completed_at"] = row.get("analysis_completed_at") or now
    elif analysis_status in _ACTIVE_ANALYSIS_STATES:
        updates["analysis_status"] = "failed"
        updates["analysis_completed_at"] = row.get("analysis_completed_at") or now

    return updates


ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "created": frozenset({"uploading", "pause_requested", "cancel_requested", "cancelled", "failed", "interrupted"}),
    "uploading": frozenset({"queued", "pause_requested", "cancel_requested", "cancelled", "failed", "interrupted"}),
    "queued": frozenset({"processing", "running", "pause_requested", "cancel_requested", "cancelled", "failed", "interrupted"}),
    "processing": frozenset({"running", "pause_requested", "cancel_requested", "stopping", "completed", "failed", "interrupted"}),
    "running": frozenset({"pause_requested", "cancel_requested", "stopping", "completed", "failed", "interrupted"}),
    "pause_requested": frozenset({"paused", "stopping", "cancel_requested", "failed", "interrupted"}),
    "paused": frozenset({"queued", "processing", "running", "cancel_requested", "deleting", "failed", "interrupted"}),
    "cancel_requested": frozenset({"stopping", "deleting", "cancelled", "interrupted"}),
    "stopping": frozenset({"paused", "deleting", "cancelled", "interrupted"}),
    "deleting": frozenset({"cancelled", "interrupted"}),
    "cancelled": frozenset(),
    "completed": frozenset({"pause_requested", "paused", "cancel_requested", "deleting", "interrupted"}),
    "failed": frozenset({"cancel_requested", "deleting"}),
    "interrupted": frozenset({"queued", "processing", "running", "paused", "cancel_requested", "deleting", "failed"}),
}

_events: dict[str, threading.Event] = {}
_lock = threading.Lock()
_delete_finalizers: set[str] = set()
_delete_finalizers_lock = threading.Lock()


class ImportCancelledError(RuntimeError):
    pass


class ImportCleanupError(RuntimeError):
    """A hard-delete cleanup failure with a stable stage identifier."""

    def __init__(self, stage: str, message: str):
        super().__init__(message)
        self.stage = stage


def _delete_failure_payload(
    *,
    error_code: str,
    detail: str,
    retryable: bool,
    exc: Exception,
    stage: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "error_code": error_code,
        "detail": detail,
        "retryable": retryable,
    }
    resolved_stage = stage or getattr(exc, "stage", None)
    if resolved_stage:
        payload["stage"] = str(resolved_stage)
    # Local/development builds need enough information to identify a persistent
    # cleanup fault. Production keeps the same safe user-facing message.
    if settings.environment.strip().lower() != "production":
        payload["diagnostic"] = str(exc)[:1000]
    return payload


def _create_supabase():
    import supabase as _sb  # noqa: PLC0415

    return _sb.create_client(settings.supabase_url, settings.supabase_secret_key)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def signal_local_cancellation(import_id: str) -> None:
    with _lock:
        _events.setdefault(import_id, threading.Event()).set()


def local_cancellation_requested(import_id: str | None) -> bool:
    if not import_id:
        return False
    with _lock:
        event = _events.get(import_id)
    return bool(event and event.is_set())


def create_import_job(
    *,
    user_id: str,
    source_filename: str,
    source_bundle_type: str,
    device_name: str | None = None,
) -> dict[str, Any]:
    response = (
        _create_supabase()
        .table("rekordbox_imports")
        .insert(
            {
                "user_id": user_id,
                "source_filename": source_filename or "upload",
                "source_type": "onelibrary",
                "source_bundle_type": source_bundle_type,
                "device_name": device_name,
                "status": "created",
                "error_message": None,
                "error_code": None,
                "retryable": False,
            }
        )
        .execute()
    )
    if not response.data:
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "IMPORT_JOB_CREATE_FAILED",
                "detail": "DropDex could not create an import job. Please try again.",
                "retryable": True,
            },
        )
    return response.data[0]


def get_import_job(import_id: str, user_id: str, *, sb=None) -> dict[str, Any]:
    client = sb or _create_supabase()
    response = (
        client.table("rekordbox_imports")
        .select("*")
        .eq("id", import_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    data = response.data if response is not None else None
    if data is None:
        raise HTTPException(status_code=404, detail="Import not found.")
    return data


def transition_import_job(
    import_id: str,
    user_id: str,
    *,
    expected_states: Iterable[str],
    new_state: str,
    updates: dict[str, Any] | None = None,
    sb=None,
) -> dict[str, Any]:
    client = sb or _create_supabase()
    current = get_import_job(import_id, user_id, sb=client)
    state = str(current.get("status") or "")
    if state == new_state:
        return current
    if state in IMMUTABLE_IMPORT_STATES:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "IMPORT_TERMINAL_STATE",
                "detail": f"This import is already {state}.",
                "status": state,
                "retryable": False,
            },
        )
    if state not in set(expected_states) or new_state not in ALLOWED_TRANSITIONS.get(
        state, frozenset()
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "IMPORT_STATE_CONFLICT",
                "detail": f"Import cannot move from {state or 'unknown'} to {new_state}.",
                "status": state or "unknown",
                "retryable": False,
            },
        )
    terminal_updates = _terminal_consistency_updates(current, new_state)
    payload = {
        "status": new_state,
        "updated_at": _now(),
        **(updates or {}),
        **terminal_updates,
    }
    response = (
        client.table("rekordbox_imports")
        .update(payload)
        .eq("id", import_id)
        .eq("user_id", user_id)
        .eq("status", state)
        .execute()
    )
    if response.data:
        return response.data[0]
    latest = get_import_job(import_id, user_id, sb=client)
    if latest.get("status") in CANCELLATION_STATES:
        signal_local_cancellation(import_id)
        raise ImportCancelledError(import_id)
    raise HTTPException(
        status_code=409,
        detail={
            "error_code": "IMPORT_STATE_CONFLICT",
            "detail": "Import state changed concurrently.",
            "status": latest.get("status"),
            "retryable": True,
        },
    )


def assert_import_not_cancelled(
    import_id: str | None, user_id: str | None = None, *, sb=None
) -> None:
    if not import_id:
        return
    if local_cancellation_requested(import_id):
        raise ImportCancelledError(import_id)
    if (
        user_id is not None
        and get_import_job(import_id, user_id, sb=sb).get("status") in CANCELLATION_STATES
    ):
        signal_local_cancellation(import_id)
        raise ImportCancelledError(import_id)


def mark_import_failed(
    import_id: str | None,
    user_id: str,
    *,
    error_code: str,
    message: str,
    retryable: bool,
) -> None:
    if not import_id:
        return
    try:
        sb = _create_supabase()
        row = get_import_job(import_id, user_id, sb=sb)
        state = str(row.get("status") or "")
        if state in TERMINAL_IMPORT_STATES or state in CANCELLATION_STATES:
            return
        transition_import_job(
            import_id,
            user_id,
            expected_states={state},
            new_state="failed",
            sb=sb,
            updates={
                "error_code": error_code,
                "error_message": message[:2000],
                "retryable": retryable,
            },
        )
    except Exception:
        logger.exception("Could not mark import %s failed", import_id)


def _is_missing_cleanup_relation(exc: Exception, table: str) -> bool:
    """Return True when a cleanup target does not exist in PostgREST/Postgres.

    Rekordbox child tables have changed over the lifetime of DropDex. Older or
    partially-migrated projects can legitimately lack a historical child table
    (notably ``rekordbox_analysis_asset_references``). A missing relation means
    there are no rows in that relation to delete, so destructive cleanup should
    treat it as already clean rather than trapping the import in ``deleting``
    forever. Other database errors (timeouts, permissions, connectivity, etc.)
    remain fatal and retryable.
    """
    code = str(getattr(exc, "code", "") or "").upper()
    text = str(exc).lower()
    table_name = table.lower()

    if code in {"PGRST205", "42P01"}:
        return True

    has_missing_relation_message = (
        "could not find the table" in text
        or "relation" in text and "does not exist" in text
        or "schema cache" in text and "could not find" in text
    )
    return has_missing_relation_message and (
        f"public.{table_name}" in text or table_name in text
    )


def _delete_import_children(sb, import_id: str) -> list[str]:
    errors: list[str] = []
    for table in (
        "rekordbox_analysis_asset_references",
        "rekordbox_track_beat_grids",
        "rekordbox_track_waveforms",
        "rekordbox_track_phrases",
        "rekordbox_cues",
        "rekordbox_recommendation_edges",
        "rekordbox_related_track_lists",
        "rekordbox_analysis_assets",
        "rekordbox_playlists",
        "rekordbox_tracks",
    ):
        try:
            sb.table(table).delete().eq("import_id", import_id).execute()
        except Exception as exc:
            if _is_missing_cleanup_relation(exc, table):
                logger.warning(
                    "Cleanup target %s is absent for import %s; treating it as already clean",
                    table,
                    import_id,
                )
                continue
            logger.exception("Cleanup failed for %s on import %s", table, import_id)
            errors.append(f"{table}: {exc}")
    return errors


def _storage_object(bucket: Any, path: Any) -> tuple[str, str] | None:
    normalized_path = str(path or "").strip().strip("/")
    if not normalized_path:
        return None
    normalized_bucket = str(bucket or _ANALYSIS_STORAGE_BUCKET).strip() or _ANALYSIS_STORAGE_BUCKET
    return normalized_bucket, normalized_path


def _is_postgrest_filter_uri_error(exc: Exception) -> bool:
    """Return True when PostgREST rejected an oversized GET filter URI.

    ``postgrest-py`` serializes ``in_`` filters into the request URL. Supabase
    gateways can report an oversized predicate as either 414 URI Too Long or
    a generic 400 Bad Request whose response body is not JSON.
    """
    code = getattr(exc, "code", None)
    text = str(exc).lower()
    return (
        code in {400, 414, "400", "414"}
        or "'code': 400" in text
        or '"code": 400' in text
        or "'code': 414" in text
        or '"code": 414' in text
    ) and (
        "json could not be generated" in text
        or "uri too long" in text
        or "bad request" in text
    )


def _fetch_external_waveform_reference_rows(
    sb,
    import_id: str,
    paths: list[str],
) -> list[dict]:
    """Fetch shared-waveform references without allowing ``in_`` URLs to grow unbounded."""
    try:
        return fetch_all_rows(
            lambda: (
                sb.table("rekordbox_track_waveforms")
                .select("id, import_id, detail_storage_bucket, detail_storage_path")
                .neq("import_id", import_id)
                .in_("detail_storage_path", paths)
            ),
            order_column="id",
        )
    except Exception as exc:
        # postgrest-py sends filters as GET query parameters. If a gateway has a
        # smaller request-line limit than expected, split the predicate until it
        # fits instead of making the entire destructive cleanup permanently fail.
        if len(paths) <= 1 or not _is_postgrest_filter_uri_error(exc):
            raise
        midpoint = len(paths) // 2
        logger.warning(
            "PostgREST rejected waveform reference filter for %d path(s); retrying smaller batches",
            len(paths),
        )
        return (
            _fetch_external_waveform_reference_rows(sb, import_id, paths[:midpoint])
            + _fetch_external_waveform_reference_rows(sb, import_id, paths[midpoint:])
        )


def _external_waveform_storage_references(
    sb,
    import_id: str,
    candidates: set[tuple[str, str]],
) -> set[tuple[str, str]]:
    """Return detail objects that another snapshot still references.

    Incremental normalized-waveform reuse historically copied the detail path
    verbatim. Preserve such an object until its final referencing snapshot is
    deleted rather than breaking the surviving waveform row.
    """
    if not candidates:
        return set()
    candidate_paths = sorted({path for _bucket, path in candidates})
    referenced: set[tuple[str, str]] = set()
    for offset in range(0, len(candidate_paths), _STORAGE_REFERENCE_QUERY_CHUNK):
        chunk = candidate_paths[offset : offset + _STORAGE_REFERENCE_QUERY_CHUNK]
        rows = _fetch_external_waveform_reference_rows(sb, import_id, chunk)
        for row in rows:
            obj = _storage_object(
                row.get("detail_storage_bucket"),
                row.get("detail_storage_path"),
            )
            if obj in candidates:
                referenced.add(obj)
    return referenced


def _enumerate_import_storage_objects(sb, import_id: str) -> set[tuple[str, str]]:
    """Discover every Storage object whose metadata belongs to one import.

    Both source queries are fully paginated before any metadata or cloud object
    is deleted. This preserves the complete retry map even when PostgREST clamps
    an individual response below the requested page size.
    """
    asset_rows = fetch_all_rows(
        lambda: (
            sb.table("rekordbox_analysis_assets")
            .select(
                "id, storage_bucket, storage_path, "
                "archive_storage_bucket, archive_storage_path"
            )
            .eq("import_id", import_id)
        ),
        order_column="id",
    )
    waveform_rows = fetch_all_rows(
        lambda: (
            sb.table("rekordbox_track_waveforms")
            .select("id, detail_storage_bucket, detail_storage_path")
            .eq("import_id", import_id)
        ),
        order_column="id",
    )

    objects: set[tuple[str, str]] = set()
    for row in asset_rows:
        for bucket_key, path_key in (
            ("storage_bucket", "storage_path"),
            ("archive_storage_bucket", "archive_storage_path"),
        ):
            obj = _storage_object(row.get(bucket_key), row.get(path_key))
            if obj:
                objects.add(obj)

    waveform_objects: set[tuple[str, str]] = set()
    for row in waveform_rows:
        obj = _storage_object(
            row.get("detail_storage_bucket"),
            row.get("detail_storage_path"),
        )
        if obj:
            waveform_objects.add(obj)
            objects.add(obj)

    shared_waveform_objects = _external_waveform_storage_references(
        sb, import_id, waveform_objects
    )
    if shared_waveform_objects:
        logger.info(
            "Preserving %d waveform detail object(s) still referenced by another import",
            len(shared_waveform_objects),
        )
        objects.difference_update(shared_waveform_objects)
    return objects


def _remove_storage_objects(sb, objects: set[tuple[str, str]]) -> None:
    by_bucket: dict[str, list[str]] = {}
    for bucket, path in sorted(objects):
        by_bucket.setdefault(bucket, []).append(path)

    for bucket, paths in by_bucket.items():
        for offset in range(0, len(paths), _STORAGE_DELETE_BATCH_SIZE):
            batch = paths[offset : offset + _STORAGE_DELETE_BATCH_SIZE]
            sb.storage.from_(bucket).remove(batch)


def cleanup_partial_import(
    import_id: str,
    user_id: str,
    *,
    sb=None,
    require_worker_ack: bool = False,
) -> None:
    client = sb or _create_supabase()
    get_import_job(import_id, user_id, sb=client)
    if require_worker_ack:
        live = worker_registry.snapshot(import_id)
        active_kinds = [
            kind
            for kind in ("analysis", "raw_archival")
            if _worker_kind_active(client, import_id, kind)
        ]
        if live.get("active") or active_kinds:
            raise RuntimeError(
                "Refusing cleanup while import workers still hold ownership: "
                + ", ".join(active_kinds or ["local analysis worker"])
            )

    try:
        storage_objects = _enumerate_import_storage_objects(client, import_id)
    except Exception as exc:
        logger.exception("Could not enumerate storage paths for import %s", import_id)
        raise ImportCleanupError(
            "storage_enumeration",
            f"Import cleanup is incomplete: could not enumerate cloud assets: {exc}",
        ) from exc

    # Remove every discovered cloud object before deleting any metadata. If a
    # later batch fails, all database rows remain intact, including paths for
    # objects already removed and paths still pending, so retry stays idempotent.
    if storage_objects:
        try:
            _remove_storage_objects(client, storage_objects)
        except Exception as exc:
            logger.exception("Storage cleanup failed for cancelled import %s", import_id)
            raise ImportCleanupError(
                "storage_delete",
                f"Import cleanup is incomplete: storage: {exc}",
            ) from exc

    errors = _delete_import_children(client, import_id)
    if errors:
        raise ImportCleanupError(
            "database_children",
            "Import cleanup is incomplete: " + "; ".join(errors),
        )
    try:
        from .analysis_staging import remove_import_staging

        remove_import_staging(import_id, settings.analysis_staging_root)
    except Exception as exc:
        logger.exception("Staging cleanup failed for cancelled import %s", import_id)
        raise ImportCleanupError(
            "staging_delete",
            f"Import cleanup is incomplete: staging: {exc}",
        ) from exc


def _update_import_row(
    sb,
    import_id: str,
    user_id: str,
    updates: dict[str, Any],
) -> dict[str, Any]:
    response = (
        sb.table("rekordbox_imports")
        .update({"updated_at": _now(), **updates})
        .eq("id", import_id)
        .eq("user_id", user_id)
        .execute()
    )
    if response.data:
        return response.data[0]
    return get_import_job(import_id, user_id, sb=sb)


def _durable_lease_snapshot(sb, import_id: str, worker_kind: str) -> dict[str, Any] | None:
    try:
        return get_worker_lease(sb, import_id, worker_kind)  # type: ignore[arg-type]
    except Exception as exc:
        logger.exception(
            "Could not inspect %s worker lease for import %s", worker_kind, import_id
        )
        raise RuntimeError(
            f"Could not verify {worker_kind} worker ownership for import {import_id}"
        ) from exc


def _worker_kind_active(sb, import_id: str, worker_kind: str) -> bool:
    return lease_row_is_active(_durable_lease_snapshot(sb, import_id, worker_kind))


def _wait_for_worker_kinds_inactive(
    sb,
    import_id: str,
    worker_kinds: Iterable[str],
    timeout_seconds: float,
) -> bool:
    """Wait until both local and durable workers have relinquished ownership."""
    deadline = time.monotonic() + max(0.0, timeout_seconds)
    kinds = tuple(worker_kinds)
    while True:
        local_active = bool(worker_registry.snapshot(import_id).get("active"))
        durable_active = any(
            _worker_kind_active(sb, import_id, worker_kind) for worker_kind in kinds
        )
        if not local_active and not durable_active:
            return True
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        # The durable worker refresh interval is normally one second. Polling
        # faster keeps Pause/Delete responsive without hammering Postgres.
        time.sleep(min(0.25, remaining))


def _worker_state_updates(
    *,
    status: str,
    stage: str | None = None,
    current_track_id: str | None = None,
    stopped_acknowledged: bool,
    error: str | None = None,
) -> dict[str, Any]:
    now = _now()
    return {
        "analysis_worker_status": status,
        "analysis_worker_stage": stage,
        "analysis_worker_current_track_id": current_track_id,
        "analysis_worker_heartbeat_at": now,
        "analysis_worker_stopped_acknowledged": stopped_acknowledged,
        "analysis_worker_stopped_at": now if stopped_acknowledged else None,
        "analysis_worker_error": error,
    }


def publish_worker_state(
    import_id: str,
    user_id: str,
    *,
    status: str,
    stage: str | None = None,
    current_track_id: str | None = None,
    stopped_acknowledged: bool,
    error: str | None = None,
    analysis_status: str | None = None,
    sb=None,
) -> dict[str, Any]:
    client = sb or _create_supabase()
    updates = _worker_state_updates(
        status=status,
        stage=stage,
        current_track_id=current_track_id,
        stopped_acknowledged=stopped_acknowledged,
        error=error,
    )
    if analysis_status is not None:
        updates["analysis_status"] = analysis_status
    return _update_import_row(client, import_id, user_id, updates)


def get_import_worker_state(import_id: str, user_id: str) -> dict[str, Any]:
    sb = _create_supabase()
    row = get_import_job(import_id, user_id, sb=sb)
    live = worker_registry.snapshot(import_id)
    try:
        durable = get_worker_lease(sb, import_id, "analysis")
    except Exception:
        logger.exception("Could not read durable analysis lease for %s", import_id)
        durable = None
    durable_active = lease_row_is_active(durable)
    worker_active = bool(live.get("active") or durable_active)
    return {
        "import_id": import_id,
        "job_status": row.get("status"),
        "analysis_status": row.get("analysis_status") or "unknown",
        "worker_status": (
            live.get("worker_status")
            if live.get("active") or live.get("last_heartbeat")
            else ("running" if durable_active else row.get("analysis_worker_status") or "idle")
        ),
        "worker_active": worker_active,
        "current_track_id": live.get("current_track_id")
        or (durable or {}).get("current_track_id")
        or row.get("analysis_worker_current_track_id")
        or row.get("analysis_current_track_id"),
        "processing_stage": live.get("current_stage")
        or (durable or {}).get("stage")
        or row.get("analysis_worker_stage"),
        "last_heartbeat": live.get("last_heartbeat")
        or (durable or {}).get("heartbeat_at")
        or row.get("analysis_worker_heartbeat_at"),
        "stop_reason": live.get("stop_reason"),
        "stopped_acknowledged": bool(
            not worker_active
            and (
                live.get("stopped_acknowledged")
                or row.get("analysis_worker_stopped_acknowledged")
            )
        ),
        "stopped_at": live.get("stopped_at") or row.get("analysis_worker_stopped_at"),
        "error": live.get("error") or row.get("analysis_worker_error"),
    }


def pause_import_analysis(
    import_id: str,
    user_id: str,
    *,
    wait_timeout_seconds: float = 5.0,
) -> dict[str, Any]:
    """Request a safe pause and preserve every uploaded or completed artifact."""
    sb = _create_supabase()
    row = get_import_job(import_id, user_id, sb=sb)
    analysis_status = str(row.get("analysis_status") or "")
    worker_snapshot = worker_registry.snapshot(import_id)
    if analysis_status in {"paused", "interrupted"}:
        return row
    if analysis_status in {"completed", "partial", "failed", "not_requested"} and not worker_snapshot.get("active"):
        return row
    job_status = str(row.get("status") or "")
    durable_worker_status = str(row.get("analysis_worker_status") or "")
    if job_status in {"cancelled", "failed", "deleting"}:
        return row
    if (
        job_status in {"cancel_requested", "deleting"}
        or (
            job_status == "stopping"
            and (
                worker_snapshot.get("stop_reason") == "delete"
                or durable_worker_status in {"cancel_requested", "deleting"}
            )
        )
    ):
        return row

    worker_registry.request_stop(import_id, "pause")
    preserve_completed_snapshot = job_status == "completed"
    if preserve_completed_snapshot:
        requested_job_status = "completed"
    elif job_status in {"pause_requested", "stopping"}:
        requested_job_status = job_status
    else:
        requested_job_status = "pause_requested"
    row = _update_import_row(
        sb,
        import_id,
        user_id,
        {
            "status": requested_job_status,
            "analysis_status": "pause_requested",
            "analysis_worker_status": "pause_requested",
            "analysis_worker_stage": row.get("analysis_worker_stage") or "pause_requested",
            "analysis_worker_stop_requested_at": _now(),
            "analysis_worker_stopped_acknowledged": False,
            "analysis_worker_stopped_at": None,
        },
    )
    if _wait_for_worker_kinds_inactive(
        sb, import_id, ("analysis",), wait_timeout_seconds
    ):
        publish_worker_state(
            import_id,
            user_id,
            status="paused",
            stage="stopped",
            stopped_acknowledged=True,
            analysis_status="paused",
            sb=sb,
        )
        return finalize_paused_import(import_id, user_id, sb=sb)
    publish_worker_state(
        import_id,
        user_id,
        status="stopping",
        stage=worker_registry.snapshot(import_id).get("current_stage") or "stopping",
        stopped_acknowledged=False,
        analysis_status="stopping",
        sb=sb,
    )
    return _update_import_row(
        sb,
        import_id,
        user_id,
        {"status": "completed" if preserve_completed_snapshot else "stopping"},
    )


def finalize_paused_import(import_id: str, user_id: str, *, sb=None) -> dict[str, Any]:
    """Persist the resumable paused state after the worker has acknowledged stop.

    This is called by the worker itself as well as the bounded pause request. The
    worker-side call closes the timeout gap where the API may already have
    returned ``stopping`` before the next safe checkpoint was reached.
    """
    client = sb or _create_supabase()
    row = get_import_job(import_id, user_id, sb=client)
    live = worker_registry.snapshot(import_id)
    try:
        durable_active = _worker_kind_active(client, import_id, "analysis")
    except RuntimeError:
        return row
    if live.get("active") or durable_active:
        return row

    state = str(row.get("status") or "")
    if state in {"cancel_requested", "deleting", "cancelled"}:
        return row
    if state not in {"completed", "pause_requested", "stopping", "paused"}:
        return row
    return _update_import_row(
        client,
        import_id,
        user_id,
        {
            "status": "completed" if state == "completed" else "paused",
            "analysis_status": "paused",
            "analysis_worker_status": "paused",
            "analysis_worker_stage": "stopped",
            "analysis_worker_current_track_id": None,
            "analysis_worker_stopped_acknowledged": True,
            "analysis_worker_stopped_at": row.get("analysis_worker_stopped_at") or _now(),
        },
    )


def _cleanup_after_worker_ack(
    import_id: str,
    user_id: str,
    *,
    sb,
    active_strategy: str = "activate_next",
) -> dict[str, Any]:
    live = worker_registry.snapshot(import_id)
    row = get_import_job(import_id, user_id, sb=sb)
    durable_active = any(
        _worker_kind_active(sb, import_id, kind)
        for kind in ("analysis", "raw_archival")
    )
    if live.get("active") or durable_active:
        return _update_import_row(
            sb,
            import_id,
            user_id,
            {
                "status": "stopping",
                "analysis_status": "stopping",
                "analysis_worker_status": "stopping",
                "analysis_worker_stopped_acknowledged": False,
            },
        )

    _ensure_metadata_delete_allowed(sb, import_id, user_id)
    try:
        dependency_gate_closed = begin_rekordbox_hard_delete(sb, import_id, user_id)
    except Exception as exc:
        metadata_block = _metadata_delete_block_from_exception(exc)
        if metadata_block is not None:
            raise _metadata_delete_http_exception(metadata_block) from exc
        logger.exception("Could not begin hard-delete cleanup for import %s", import_id)
        _update_import_row(
            sb,
            import_id,
            user_id,
            {
                "analysis_worker_error": str(exc)[:2000],
                "error_code": "DELETE_CLEANUP_FAILED",
                "error_message": "DropDex could not verify retained-analysis dependencies. Retry Delete Import.",
                "retryable": True,
            },
        )
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "DELETE_CLEANUP_FAILED",
                "detail": "DropDex could not verify retained-analysis dependencies. Retry Delete Import.",
                "retryable": True,
            },
        ) from exc

    if not dependency_gate_closed:
        _update_import_row(
            sb,
            import_id,
            user_id,
            {
                "analysis_worker_status": "stopped",
                "analysis_worker_stopped_acknowledged": True,
                "analysis_worker_stopped_at": row.get("analysis_worker_stopped_at") or _now(),
                "analysis_worker_error": None,
                "error_code": "DELETE_DEPENDENCY_ACTIVE",
                "error_message": (
                    "Another Rekordbox import still needs retained analysis from this library. "
                    "Let that import finish materializing analysis, or delete it, then retry."
                ),
                "retryable": True,
            },
        )
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "DELETE_DEPENDENCY_ACTIVE",
                "detail": (
                    "Another Rekordbox import still needs retained analysis from this library. "
                    "Let that import finish materializing analysis, or delete it, then retry."
                ),
                "retryable": True,
            },
        )

    _update_import_row(
        sb,
        import_id,
        user_id,
        {
            "analysis_status": "stopping",
            "analysis_worker_status": "deleting",
            "analysis_worker_error": None,
            "error_code": None,
            "error_message": None,
        },
    )
    try:
        cleanup_partial_import(import_id, user_id, sb=sb, require_worker_ack=True)
    except Exception as exc:
        _update_import_row(
            sb,
            import_id,
            user_id,
            {
                "status": "deleting",
                "analysis_status": "stopping",
                "analysis_worker_status": "deleting",
                "analysis_worker_error": str(exc)[:2000],
                "error_code": "DELETE_CLEANUP_FAILED",
                "error_message": "The worker stopped, but cloud cleanup is incomplete. Retry Delete Import.",
                "retryable": True,
            },
        )
        raise HTTPException(
            status_code=503,
            detail=_delete_failure_payload(
                error_code="DELETE_CLEANUP_FAILED",
                detail="The worker stopped, but cloud cleanup is incomplete. Retry Delete Import.",
                retryable=True,
                exc=exc,
            ),
        ) from exc

    deleted_response = {
        **row,
        "status": "cancelled",
        "analysis_status": "cancelled",
        "analysis_worker_status": "stopped",
        "analysis_worker_stage": "deleted",
        "analysis_worker_stopped_acknowledged": True,
        "analysis_worker_stopped_at": _now(),
        "cancelled_at": _now(),
        "error_code": None,
        "error_message": None,
        "retryable": False,
    }
    try:
        sb.rpc(
            "hard_delete_rekordbox_import",
            {
                "p_import_id": import_id,
                "p_user_id": user_id,
                "p_active_strategy": active_strategy,
            },
        ).execute()
    except Exception as exc:
        logger.exception("Hard-delete finalization failed for import %s", import_id)
        try:
            _update_import_row(
                sb,
                import_id,
                user_id,
                {
                    "status": "deleting",
                    "analysis_status": "stopping",
                    "analysis_worker_status": "deleting",
                    "analysis_worker_error": str(exc)[:2000],
                    "error_code": "DELETE_FINALIZE_FAILED",
                    "error_message": "Library data was cleaned, but DropDex could not finalize deletion. Retry Delete Import.",
                    "retryable": True,
                },
            )
        except Exception:
            logger.exception("Could not persist hard-delete finalization failure for %s", import_id)
        raise HTTPException(
            status_code=503,
            detail=_delete_failure_payload(
                error_code="DELETE_FINALIZE_FAILED",
                detail="Library data was cleaned, but DropDex could not finalize deletion. Retry Delete Import.",
                retryable=True,
                exc=exc,
                stage="database_finalize",
            ),
        ) from exc
    return deleted_response


def _schedule_delete_finalizer(
    import_id: str,
    user_id: str,
    *,
    active_strategy: str = "activate_next",
    max_wait_seconds: float = 300.0,
) -> None:
    """Continue waiting without ever treating a timeout as worker acknowledgement."""
    with _delete_finalizers_lock:
        if import_id in _delete_finalizers:
            return
        _delete_finalizers.add(import_id)

    def _finalize() -> None:
        try:
            sb = _create_supabase()
            if not _wait_for_worker_kinds_inactive(
                sb, import_id, ("analysis", "raw_archival"), max_wait_seconds
            ):
                logger.warning(
                    "Delete for import %s remains in stopping after %.1f seconds",
                    import_id,
                    max_wait_seconds,
                )
                return
            row = get_import_job(import_id, user_id, sb=sb)
            if str(row.get("status") or "") in {
                "cancel_requested",
                "stopping",
                "deleting",
            }:
                persisted_strategy = str(row.get("delete_active_strategy") or active_strategy)
                _cleanup_after_worker_ack(
                    import_id,
                    user_id,
                    sb=sb,
                    active_strategy=persisted_strategy,
                )
        except Exception:
            logger.exception("Could not finalize acknowledged delete for import %s", import_id)
        finally:
            with _delete_finalizers_lock:
                _delete_finalizers.discard(import_id)

    threading.Thread(
        target=_finalize,
        name=f"rekordbox-delete-{import_id[:8]}",
        daemon=True,
    ).start()


def delete_import_job(
    import_id: str,
    user_id: str,
    *,
    wait_timeout_seconds: float = 5.0,
    active_strategy: str = "activate_next",
) -> dict[str, Any]:
    """Stop the worker, await acknowledgement, then hard-delete the library snapshot."""
    if active_strategy not in DELETE_ACTIVE_STRATEGIES:
        raise HTTPException(
            status_code=422,
            detail={
                "error_code": "INVALID_DELETE_ACTIVE_STRATEGY",
                "detail": "Unsupported active-library behavior for deletion.",
                "retryable": False,
            },
        )
    sb = _create_supabase()
    row = get_import_job(import_id, user_id, sb=sb)
    _ensure_metadata_delete_allowed(sb, import_id, user_id)
    current_status = str(row.get("status") or "")
    if current_status == "cancelled":
        return row

    persisted_strategy = str(row.get("delete_active_strategy") or "")
    deletion_already_pending = current_status in {"cancel_requested", "stopping", "deleting"}
    if deletion_already_pending and persisted_strategy in DELETE_ACTIVE_STRATEGIES:
        # The first confirmed destructive request owns the pending intent. A retry
        # continues that request; transient frontend state must never reinterpret it.
        effective_active_strategy = persisted_strategy
    else:
        effective_active_strategy = active_strategy

    signal_local_cancellation(import_id)
    worker_registry.request_stop(import_id, "delete")
    stop_snapshot = worker_registry.snapshot(import_id)
    stopped_acknowledged = bool(stop_snapshot.get("stopped_acknowledged"))
    request_updates: dict[str, Any] = {
        "analysis_status": "stopping",
        "analysis_worker_status": "cancel_requested",
        "analysis_worker_stop_requested_at": _now(),
        "analysis_worker_stopped_acknowledged": stopped_acknowledged,
        "analysis_worker_stopped_at": (
            row.get("analysis_worker_stopped_at") or _now()
            if stopped_acknowledged
            else None
        ),
        "delete_active_strategy": effective_active_strategy,
    }
    if current_status not in {"cancel_requested", "stopping", "deleting"}:
        request_updates["status"] = "cancel_requested"
        current_status = "cancel_requested"
    row = _update_import_row(
        sb,
        import_id,
        user_id,
        request_updates,
    )
    if not _wait_for_worker_kinds_inactive(
        sb, import_id, ("analysis", "raw_archival"), wait_timeout_seconds
    ):
        timeout_updates: dict[str, Any] = {
            "analysis_status": "stopping",
            "analysis_worker_status": "stopping",
            "analysis_worker_stage": worker_registry.snapshot(import_id).get(
                "current_stage"
            )
            or "stopping",
            "analysis_worker_stopped_acknowledged": False,
        }
        if current_status == "cancel_requested":
            timeout_updates["status"] = "stopping"
        stopping = _update_import_row(
            sb,
            import_id,
            user_id,
            timeout_updates,
        )
        _schedule_delete_finalizer(
            import_id,
            user_id,
            active_strategy=effective_active_strategy,
        )
        return stopping
    return _cleanup_after_worker_ack(
        import_id,
        user_id,
        sb=sb,
        active_strategy=effective_active_strategy,
    )


def _list_user_rekordbox_imports(sb, user_id: str) -> list[dict[str, Any]]:
    rows = fetch_all_rows(
        lambda: (
            sb.table("rekordbox_imports")
            .select("id, imported_at, status")
            .eq("user_id", user_id)
        ),
        order_column="id",
    )
    # Retained-analysis dependencies always point from a newer dependent import
    # to an older source import. Deleting newest-first naturally releases those
    # dependency rows before their source snapshot is removed.
    return sorted(
        rows,
        key=lambda row: (str(row.get("imported_at") or ""), str(row.get("id") or "")),
        reverse=True,
    )


def delete_all_import_jobs(
    user_id: str,
    *,
    wait_timeout_seconds: float = 0.25,
) -> dict[str, Any]:
    """Delete every Rekordbox snapshot owned by one user.

    This is intentionally implemented through the same worker-stop, cloud
    storage cleanup, child-row cleanup, retained-dependency gate, and atomic
    parent-row finalization used by Delete Import. One request performs one
    newest-first cleanup pass. If workers are still stopping, callers may retry
    until ``remaining_count`` reaches zero.
    """
    sb = _create_supabase()
    rows = _list_user_rekordbox_imports(sb, user_id)
    for row in rows:
        import_id = str(row.get("id") or "")
        if not import_id:
            continue
        try:
            _ensure_metadata_delete_allowed(sb, import_id, user_id)
        except HTTPException as exc:
            if exc.status_code == 404:
                # A background finalizer may remove a row between list and
                # preflight. The destructive pass already treats that race as
                # success, so the metadata preflight must preserve that rule.
                continue
            raise

    deleted_count = 0

    for row in rows:
        import_id = str(row.get("id") or "")
        if not import_id:
            continue
        try:
            if str(row.get("status") or "") == "cancelled":
                # Older deployments could leave a terminal cancelled parent row
                # behind. Delete All must also purge those hidden/stale snapshots.
                signal_local_cancellation(import_id)
                worker_registry.request_stop(import_id, "delete")
                if not _wait_for_worker_kinds_inactive(
                    sb,
                    import_id,
                    ("analysis", "raw_archival"),
                    wait_timeout_seconds,
                ):
                    _update_import_row(
                        sb,
                        import_id,
                        user_id,
                        {
                            "status": "stopping",
                            "analysis_status": "stopping",
                            "analysis_worker_status": "stopping",
                            "analysis_worker_stop_requested_at": _now(),
                            "analysis_worker_stopped_acknowledged": False,
                            "delete_active_strategy": "start_over",
                        },
                    )
                    _schedule_delete_finalizer(
                        import_id,
                        user_id,
                        active_strategy="start_over",
                    )
                    continue
                result = _cleanup_after_worker_ack(
                    import_id,
                    user_id,
                    sb=sb,
                    active_strategy="start_over",
                )
            else:
                result = delete_import_job(
                    import_id,
                    user_id,
                    wait_timeout_seconds=wait_timeout_seconds,
                    active_strategy="start_over",
                )
        except HTTPException as exc:
            if exc.status_code == 404:
                # A background finalizer can win the race between the initial
                # list and this pass. Parent disappearance means success.
                deleted_count += 1
                continue
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            if exc.status_code == 409 and detail.get("error_code") == "DELETE_DEPENDENCY_ACTIVE":
                continue
            raise

        if str(result.get("status") or "") == "cancelled":
            deleted_count += 1

    remaining_rows = _list_user_rekordbox_imports(sb, user_id)
    remaining_ids = [str(row.get("id")) for row in remaining_rows if row.get("id")]

    if not remaining_ids:
        # Remove the now-meaningless active-library pointer row as part of a true
        # first-import reset. Account/profile/theme/discovery preferences live in
        # separate tables and are intentionally untouched.
        sb.table("rekordbox_user_settings").delete().eq("user_id", user_id).execute()
        return {
            "status": "completed",
            "deleted_count": deleted_count,
            "remaining_count": 0,
            "pending_import_ids": [],
        }

    return {
        "status": "pending",
        "deleted_count": deleted_count,
        "remaining_count": len(remaining_ids),
        "pending_import_ids": remaining_ids,
    }


def cancel_import_job(import_id: str, user_id: str) -> dict[str, Any]:
    """Backward-compatible alias for the explicit destructive delete operation."""
    return delete_import_job(import_id, user_id)


def complete_import_job(
    import_id: str, user_id: str, *, updates: dict[str, Any] | None = None
) -> dict[str, Any]:
    assert_import_not_cancelled(import_id, user_id)
    return transition_import_job(
        import_id,
        user_id,
        expected_states={"processing"},
        new_state="completed",
        updates={"completed_at": _now(), **(updates or {})},
    )


def recover_interrupted_import_jobs() -> int:
    """Convert stale in-process work into resumable, non-destructive states."""
    sb = _create_supabase()
    # Startup recovery is service-wide, not user-scoped. A production deployment
    # can easily accumulate more rows than PostgREST's response cap, so recovery
    # itself must paginate rather than silently ignoring imports after row 1,000.
    job_rows = fetch_all_rows(
        lambda: (
            sb.table("rekordbox_imports")
            .select("*")
            .in_(
                "status",
                [
                    "created",
                    "uploading",
                    "queued",
                    "processing",
                    "running",
                    "pause_requested",
                    "stopping",
                    "cancel_requested",
                    "deleting",
                ],
            )
        ),
        order_column="id",
    )
    analysis_rows = fetch_all_rows(
        lambda: (
            sb.table("rekordbox_imports")
            .select("*")
            .eq("status", "completed")
            .in_(
                "analysis_status",
                ["parsing", "pause_requested", "stopping"],
            )
        ),
        order_column="id",
    )

    rows_by_id = {str(row["id"]): row for row in job_rows}
    rows_by_id.update({str(row["id"]): row for row in analysis_rows})

    recovered = 0
    for row in rows_by_id.values():
        import_id = str(row["id"])
        user_id = str(row["user_id"])
        state = str(row.get("status") or "")
        analysis_status = str(row.get("analysis_status") or "")
        durable_worker_status = str(row.get("analysis_worker_status") or "")
        try:
            if any(
                _worker_kind_active(sb, import_id, kind)
                for kind in ("analysis", "raw_archival")
            ):
                # Another API process/container still owns this import. Startup
                # recovery must never rewrite live work owned elsewhere.
                continue
            try:
                reconcile_retained_analysis_dependencies(sb, import_id)
            except Exception:
                # Preserving a stale dependency is fail-safe: it can delay source
                # deletion but cannot make a source disappear too early.
                logger.exception(
                    "Could not reconcile retained-analysis dependencies for import %s",
                    import_id,
                )
            # A process restart proves the old in-process thread no longer exists,
            # but never proves that destructive cleanup should occur.
            delete_intent = state in {"cancel_requested", "deleting"} or (
                state == "stopping"
                and durable_worker_status in {"cancel_requested", "deleting"}
            )
            if delete_intent:
                next_status = "deleting" if state == "deleting" else "stopping"
            elif state == "completed":
                next_status = "completed"
            elif state == "pause_requested":
                next_status = "paused"
            else:
                next_status = "interrupted"

            next_analysis_status = analysis_status
            if delete_intent:
                next_analysis_status = "stopping"
            elif analysis_status in {"parsing", "pause_requested", "stopping"}:
                next_analysis_status = "paused" if state == "pause_requested" else "interrupted"

            error_code = "DELETE_INTERRUPTED" if delete_intent else "ANALYSIS_INTERRUPTED"
            error_message = (
                "The worker stopped during a service restart. Retry Delete Import to finish cloud cleanup."
                if delete_intent
                else "Analysis stopped because the DropDex service restarted. Resume analysis to continue."
            )
            recovered_worker_status = "stopped" if delete_intent else "interrupted"

            _update_import_row(
                sb,
                import_id,
                user_id,
                {
                    "status": next_status,
                    "analysis_status": next_analysis_status or "interrupted",
                    "analysis_worker_status": recovered_worker_status,
                    "analysis_worker_stage": "server_restart",
                    "analysis_worker_current_track_id": None,
                    "analysis_current_track_id": None,
                    "analysis_current_track_title": None,
                    "analysis_current_track_artist": None,
                    "analysis_current_track_label": None,
                    "analysis_worker_stopped_acknowledged": True,
                    "analysis_worker_stopped_at": _now(),
                    "analysis_worker_heartbeat_at": _now(),
                    "analysis_worker_error": "Analysis worker stopped during a server restart.",
                    "error_code": error_code,
                    "error_message": error_message,
                    "retryable": True,
                },
            )
            worker_registry.acknowledge_stopped(import_id, status=recovered_worker_status)
            recovered += 1
        except Exception:
            logger.exception("Could not recover interrupted import %s", import_id)
    return recovered
