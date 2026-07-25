"""Durable import-job state transitions and cooperative cancellation."""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi import HTTPException

from .config import settings
from .import_worker_registry import worker_registry

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


_ACTIVE_ANALYSIS_STATES = frozenset({"awaiting_upload", "uploading", "uploaded", "parsing", "pause_requested", "stopping"})


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
            logger.exception("Cleanup failed for %s on import %s", table, import_id)
            errors.append(f"{table}: {exc}")
    return errors


def cleanup_partial_import(
    import_id: str,
    user_id: str,
    *,
    sb=None,
    require_worker_ack: bool = False,
) -> None:
    client = sb or _create_supabase()
    row = get_import_job(import_id, user_id, sb=client)
    if require_worker_ack:
        live = worker_registry.snapshot(import_id)
        acknowledged = bool(
            live.get("stopped_acknowledged")
            or row.get("analysis_worker_stopped_acknowledged")
        )
        if live.get("active") or not acknowledged:
            raise RuntimeError("Refusing cleanup before analysis worker acknowledgement")
    paths: list[str] = []
    try:
        response = (
            client.table("rekordbox_analysis_assets")
            .select("storage_path, archive_storage_path")
            .eq("import_id", import_id)
            .execute()
        )
        paths = sorted({
            str(path)
            for item in (response.data or [])
            for path in (item.get("storage_path"), item.get("archive_storage_path"))
            if path
        })
    except Exception as exc:
        logger.exception("Could not enumerate storage paths for import %s", import_id)
        raise RuntimeError(
            f"Import cleanup is incomplete: could not enumerate cloud assets: {exc}"
        ) from exc
    # Remove cloud objects before deleting their metadata. If storage is
    # temporarily unavailable, retaining the asset rows preserves the exact
    # paths needed for an idempotent retry instead of orphaning objects.
    if paths:
        try:
            client.storage.from_("rekordbox-analysis-assets").remove(paths)
        except Exception as exc:
            logger.exception("Storage cleanup failed for cancelled import %s", import_id)
            raise RuntimeError(f"Import cleanup is incomplete: storage: {exc}") from exc

    errors = _delete_import_children(client, import_id)
    if errors:
        raise RuntimeError("Import cleanup is incomplete: " + "; ".join(errors))
    try:
        from .analysis_staging import remove_import_staging
        remove_import_staging(import_id, settings.analysis_staging_root)
    except Exception as exc:
        logger.exception("Staging cleanup failed for cancelled import %s", import_id)
        raise RuntimeError(f"Import cleanup is incomplete: staging: {exc}") from exc


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
    return {
        "import_id": import_id,
        "job_status": row.get("status"),
        "analysis_status": row.get("analysis_status") or "unknown",
        "worker_status": live.get("worker_status")
        if live.get("active") or live.get("last_heartbeat")
        else (row.get("analysis_worker_status") or "idle"),
        "worker_active": bool(live.get("active")),
        "current_track_id": live.get("current_track_id")
        or row.get("analysis_worker_current_track_id")
        or row.get("analysis_current_track_id"),
        "processing_stage": live.get("current_stage")
        or row.get("analysis_worker_stage"),
        "last_heartbeat": live.get("last_heartbeat")
        or row.get("analysis_worker_heartbeat_at"),
        "stop_reason": live.get("stop_reason"),
        "stopped_acknowledged": bool(
            live.get("stopped_acknowledged")
            or row.get("analysis_worker_stopped_acknowledged")
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
    if worker_registry.wait_for_stopped(import_id, wait_timeout_seconds):
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
    acknowledged = bool(
        live.get("stopped_acknowledged")
        or row.get("analysis_worker_stopped_acknowledged")
    )
    if live.get("active") or not acknowledged:
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


def _cleanup_after_worker_ack(import_id: str, user_id: str, *, sb) -> dict[str, Any]:
    live = worker_registry.snapshot(import_id)
    row = get_import_job(import_id, user_id, sb=sb)
    acknowledged = bool(
        live.get("stopped_acknowledged")
        or row.get("analysis_worker_stopped_acknowledged")
    )
    if live.get("active") or not acknowledged:
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

    _update_import_row(
        sb,
        import_id,
        user_id,
        {
            "status": "deleting",
            "analysis_status": "stopping",
            "analysis_worker_status": "deleting",
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
            detail={
                "error_code": "DELETE_CLEANUP_FAILED",
                "detail": "The worker stopped, but cloud cleanup is incomplete. Retry Delete Import.",
                "retryable": True,
            },
        ) from exc
    return _update_import_row(
        sb,
        import_id,
        user_id,
        {
            "status": "cancelled",
            "analysis_status": "cancelled",
            "analysis_worker_status": "stopped",
            "analysis_worker_stage": "deleted",
            "analysis_worker_stopped_acknowledged": True,
            "analysis_worker_stopped_at": _now(),
            "cancelled_at": _now(),
            "error_code": "IMPORT_CANCELLED",
            "error_message": "Import and retained cloud analysis data were deleted.",
            "retryable": False,
        },
    )


def _schedule_delete_finalizer(
    import_id: str,
    user_id: str,
    *,
    max_wait_seconds: float = 300.0,
) -> None:
    """Continue waiting without ever treating a timeout as worker acknowledgement."""
    with _delete_finalizers_lock:
        if import_id in _delete_finalizers:
            return
        _delete_finalizers.add(import_id)

    def _finalize() -> None:
        try:
            if not worker_registry.wait_for_stopped(import_id, max_wait_seconds):
                logger.warning(
                    "Delete for import %s remains in stopping after %.1f seconds",
                    import_id,
                    max_wait_seconds,
                )
                return
            sb = _create_supabase()
            row = get_import_job(import_id, user_id, sb=sb)
            if str(row.get("status") or "") in {
                "cancel_requested",
                "stopping",
                "deleting",
            }:
                _cleanup_after_worker_ack(import_id, user_id, sb=sb)
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
) -> dict[str, Any]:
    """Stop the worker, await acknowledgement, then perform idempotent cleanup."""
    sb = _create_supabase()
    row = get_import_job(import_id, user_id, sb=sb)
    current_status = str(row.get("status") or "")
    if current_status == "cancelled":
        return row

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
    if not worker_registry.wait_for_stopped(import_id, wait_timeout_seconds):
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
        _schedule_delete_finalizer(import_id, user_id)
        return stopping
    return _cleanup_after_worker_ack(import_id, user_id, sb=sb)


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
    job_response = (
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
        .execute()
    )
    analysis_response = (
        sb.table("rekordbox_imports")
        .select("*")
        .eq("status", "completed")
        .in_(
            "analysis_status",
            ["parsing", "pause_requested", "stopping"],
        )
        .execute()
    )

    rows_by_id = {str(row["id"]): row for row in (job_response.data or [])}
    rows_by_id.update({str(row["id"]): row for row in (analysis_response.data or [])})

    recovered = 0
    for row in rows_by_id.values():
        import_id = str(row["id"])
        user_id = str(row["user_id"])
        state = str(row.get("status") or "")
        analysis_status = str(row.get("analysis_status") or "")
        durable_worker_status = str(row.get("analysis_worker_status") or "")
        try:
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
