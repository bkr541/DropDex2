"""Durable import-job state transitions and cooperative cancellation."""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi import HTTPException

from .config import settings

logger = logging.getLogger(__name__)

IMPORT_STATES = frozenset(
    {
        "created",
        "uploading",
        "queued",
        "processing",
        "cancel_requested",
        "cancelled",
        "completed",
        "failed",
    }
)
TERMINAL_IMPORT_STATES = frozenset({"cancelled", "completed", "failed"})
CANCELLATION_STATES = frozenset({"cancel_requested", "cancelled"})
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "created": frozenset({"uploading", "cancel_requested", "cancelled", "failed"}),
    "uploading": frozenset({"queued", "cancel_requested", "cancelled", "failed"}),
    "queued": frozenset({"processing", "cancel_requested", "cancelled", "failed"}),
    "processing": frozenset({"cancel_requested", "cancelled", "completed", "failed"}),
    "cancel_requested": frozenset({"cancelled"}),
    "cancelled": frozenset(),
    "completed": frozenset(),
    "failed": frozenset(),
}

_events: dict[str, threading.Event] = {}
_lock = threading.Lock()


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
    if state in TERMINAL_IMPORT_STATES:
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
    payload = {"status": new_state, "updated_at": _now(), **(updates or {})}
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


def _delete_import_children(sb, import_id: str) -> None:
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
            logger.debug("Cleanup skipped %s: %s", table, exc)


def cleanup_partial_import(import_id: str, user_id: str, *, sb=None) -> None:
    client = sb or _create_supabase()
    get_import_job(import_id, user_id, sb=client)
    paths: list[str] = []
    try:
        response = (
            client.table("rekordbox_analysis_assets")
            .select("storage_path")
            .eq("import_id", import_id)
            .execute()
        )
        paths = [str(x["storage_path"]) for x in (response.data or []) if x.get("storage_path")]
    except Exception:
        pass
    _delete_import_children(client, import_id)
    if paths:
        try:
            client.storage.from_("rekordbox-analysis-assets").remove(paths)
        except Exception:
            logger.warning("Storage cleanup failed for cancelled import %s", import_id)


def cancel_import_job(import_id: str, user_id: str) -> dict[str, Any]:
    sb = _create_supabase()
    row = get_import_job(import_id, user_id, sb=sb)
    # Verify ownership before publishing the in-process cancellation signal.
    signal_local_cancellation(import_id)
    state = str(row.get("status") or "")
    if state in TERMINAL_IMPORT_STATES:
        return row
    if state != "cancel_requested":
        row = transition_import_job(
            import_id,
            user_id,
            expected_states={"created", "uploading", "queued", "processing"},
            new_state="cancel_requested",
            sb=sb,
        )
    cleanup_partial_import(import_id, user_id, sb=sb)
    return transition_import_job(
        import_id,
        user_id,
        expected_states={"cancel_requested"},
        new_state="cancelled",
        sb=sb,
        updates={
            "cancelled_at": _now(),
            "error_code": "IMPORT_CANCELLED",
            "error_message": "Import was cancelled.",
            "retryable": False,
        },
    )


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
    """Mark non-terminal jobs left by a process restart as retryable failures.

    Work is intentionally not resumed because this repository has no durable queue.
    Cancellation requests are finalized as cancelled; all other in-flight jobs become
    failed with IMPORT_INTERRUPTED so history is truthful after restart.
    """
    sb = _create_supabase()
    response = (
        sb.table("rekordbox_imports")
        .select("id,user_id,status")
        .in_("status", ["created", "uploading", "queued", "processing", "cancel_requested"])
        .execute()
    )
    recovered = 0
    for row in response.data or []:
        import_id = str(row["id"])
        user_id = str(row["user_id"])
        state = str(row["status"])
        try:
            if state == "cancel_requested":
                signal_local_cancellation(import_id)
                cleanup_partial_import(import_id, user_id, sb=sb)
                transition_import_job(
                    import_id,
                    user_id,
                    expected_states={"cancel_requested"},
                    new_state="cancelled",
                    updates={
                        "cancelled_at": _now(),
                        "error_code": "IMPORT_CANCELLED",
                        "error_message": "Import was cancelled before the server restarted.",
                        "retryable": False,
                    },
                    sb=sb,
                )
            else:
                transition_import_job(
                    import_id,
                    user_id,
                    expected_states={state},
                    new_state="failed",
                    updates={
                        "error_code": "IMPORT_INTERRUPTED",
                        "error_message": "The import was interrupted by a server restart. Please retry.",
                        "retryable": True,
                    },
                    sb=sb,
                )
            recovered += 1
        except Exception:
            logger.exception("Could not recover interrupted import %s", import_id)
    return recovered
