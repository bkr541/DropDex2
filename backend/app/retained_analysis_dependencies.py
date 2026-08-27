"""Persistent guards for cross-import retained Rekordbox analysis reuse.

A new import may temporarily depend on DAT/EXT assets owned by an older import
while the fast analysis pipeline materializes those bytes into the new import's
own durable staging.  These helpers keep that dependency explicit in Postgres so
hard deletion cannot remove the source snapshot during that window.
"""
from __future__ import annotations

from typing import Any, Iterable, Sequence


_SOURCE_UNAVAILABLE_MARKER = "RETAINED_ANALYSIS_SOURCE_UNAVAILABLE"


class RetainedAnalysisSourceUnavailable(RuntimeError):
    """The planned retained source can no longer be safely depended on."""


def _scalar_bool(data: Any) -> bool:
    if isinstance(data, bool):
        return data
    if isinstance(data, list) and len(data) == 1:
        item = data[0]
        if isinstance(item, bool):
            return item
        if isinstance(item, dict) and len(item) == 1:
            return bool(next(iter(item.values())))
    if isinstance(data, dict) and len(data) == 1:
        return bool(next(iter(data.values())))
    return bool(data)


def replace_retained_analysis_dependencies(
    sb: Any,
    import_id: str,
    dependencies: Sequence[dict[str, str]],
) -> int:
    """Replace unresolved retained-analysis dependencies for one import.

    The database RPC serializes this operation with source-import hard-delete
    start using a per-user advisory lock.  If a source has already begun
    deletion, the caller must conservatively fall back to requesting fresh
    analysis assets instead of continuing with a dangling source reference.
    """
    try:
        response = sb.rpc(
            "replace_rekordbox_retained_analysis_dependencies",
            {
                "p_import_id": import_id,
                "p_dependencies": list(dependencies),
            },
        ).execute()
    except Exception as exc:
        if _SOURCE_UNAVAILABLE_MARKER in str(exc):
            raise RetainedAnalysisSourceUnavailable(str(exc)) from exc
        raise

    data = response.data if response is not None else None
    if isinstance(data, int):
        return data
    if isinstance(data, list) and len(data) == 1 and isinstance(data[0], int):
        return data[0]
    return len(dependencies)


def release_retained_analysis_dependencies(
    sb: Any,
    import_id: str,
    track_ids: Iterable[str],
) -> int:
    """Release dependencies for tracks whose required DAT is independently local.

    Callers only pass tracks after `_resolve_asset_source` has produced an actual
    local file owned by the dependent import.  In production that staging root is
    required to be persistent, so a released dependency remains restart-safe.
    """
    unique_ids = sorted({str(track_id) for track_id in track_ids if track_id})
    if not unique_ids:
        return 0
    released = 0
    # This RPC is safe to invoke incrementally because each call only deletes
    # dependencies for the supplied tracks. Keep payloads bounded for parser-
    # version upgrades where an entire large library may materialize retained DAT.
    for offset in range(0, len(unique_ids), 250):
        chunk = unique_ids[offset : offset + 250]
        response = sb.rpc(
            "release_rekordbox_retained_analysis_dependencies",
            {
                "p_import_id": import_id,
                "p_track_ids": chunk,
            },
        ).execute()
        data = response.data if response is not None else None
        if isinstance(data, int):
            released += data
        elif isinstance(data, list) and len(data) == 1 and isinstance(data[0], int):
            released += data[0]
    return released


def reconcile_retained_analysis_dependencies(sb: Any, import_id: str) -> int:
    """Prune crash-window guards that no longer match persisted track intent.

    Dependency registration intentionally happens before source-owned bytes are
    read. If the process dies before the track manifest is persisted, the guard
    is safe but stale. Startup recovery calls this RPC so those stale guards do
    not block source deletion forever, while persisted reuse/reparse guards stay.
    """
    response = sb.rpc(
        "reconcile_rekordbox_retained_analysis_dependencies",
        {"p_import_id": import_id},
    ).execute()
    data = response.data if response is not None else None
    if isinstance(data, int):
        return data
    if isinstance(data, list) and len(data) == 1 and isinstance(data[0], int):
        return data[0]
    return 0


def rekordbox_metadata_delete_block(sb: Any, import_id: str, user_id: str) -> str | None:
    """Return the server-owned metadata reason that blocks destructive import deletion."""
    response = sb.rpc(
        "rekordbox_import_metadata_delete_block_v1",
        {
            "p_import_id": import_id,
            "p_user_id": user_id,
        },
    ).execute()
    data = response.data if response is not None else None
    if data is None:
        return None
    if isinstance(data, str):
        return data or None
    if isinstance(data, list) and len(data) == 1:
        value = data[0]
        if value is None:
            return None
        if isinstance(value, str):
            return value or None
    raise RuntimeError("Unexpected metadata delete-block response")


def begin_rekordbox_hard_delete(sb: Any, import_id: str, user_id: str) -> bool:
    """Atomically close the dependency-registration gate for a source import."""
    response = sb.rpc(
        "begin_rekordbox_import_hard_delete",
        {
            "p_import_id": import_id,
            "p_user_id": user_id,
        },
    ).execute()
    return _scalar_bool(response.data if response is not None else None)
