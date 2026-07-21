"""
Import Related Tracks data from the desktop Rekordbox bridge.

Security invariants:
- user_id comes from JWT only, never from payload
- Import ownership verified before any mutation
- Payload validated (schema version, size limits) before deleting existing data
- Failed payload does not erase valid existing lists
- Track matching uses stable IDs; sole-title match is rejected
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from .config import settings
from .models import (
    RelatedTracksImportResponse,
    RelatedTracksPayload,
)

logger = logging.getLogger(__name__)

_SUPPORTED_SCHEMA_VERSION = 1
_MAX_LISTS_PER_PAYLOAD = 2000
_MAX_MEMBERS_PER_LIST = 10000


def _create_supabase():
    """Return a service-role Supabase client. Import is deferred so tests can patch."""
    import supabase as _sb  # noqa: PLC0415
    return _sb.create_client(settings.supabase_url, settings.supabase_secret_key)


async def import_related_tracks(
    import_id: str,
    user_id: str,
    payload: RelatedTracksPayload,
) -> RelatedTracksImportResponse:
    """Run the synchronous Supabase import outside FastAPI's event loop."""
    return await run_in_threadpool(
        _import_related_tracks_sync,
        import_id,
        user_id,
        payload,
    )


def _import_related_tracks_sync(
    import_id: str,
    user_id: str,
    payload: RelatedTracksPayload,
) -> RelatedTracksImportResponse:
    """
    Import desktop Rekordbox Related Tracks lists.

    Steps:
    1. Validate schema version
    2. Verify import ownership
    3. Enforce payload size limits
    4. Build content_id -> track_id lookup map
    5. Upsert all lists (first pass, no parent linkage)
    6. Resolve parent list relationships (second pass)
    7. Replace memberships per list (delete-then-insert, after full payload validation)
    8. Return counts
    """
    # ── Step 1: Validate schema version ───────────────────────────────────────
    if payload.schema_version != _SUPPORTED_SCHEMA_VERSION:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Unsupported schema_version {payload.schema_version!r}. "
                f"Expected {_SUPPORTED_SCHEMA_VERSION}."
            ),
        )

    # ── Step 2: Verify import ownership ───────────────────────────────────────
    sb = _create_supabase()
    import_result = (
        sb.table("rekordbox_imports")
        .select("id")
        .eq("id", import_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if import_result is None or not import_result.data:
        raise HTTPException(status_code=404, detail="Import not found")

    # ── Step 3: Enforce payload size limits ────────────────────────────────────
    if len(payload.lists) > _MAX_LISTS_PER_PAYLOAD:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Payload contains {len(payload.lists)} lists; "
                f"maximum is {_MAX_LISTS_PER_PAYLOAD}."
            ),
        )
    for lst in payload.lists:
        if len(lst.members) > _MAX_MEMBERS_PER_LIST:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"List {lst.source_list_id!r} contains {len(lst.members)} members; "
                    f"maximum is {_MAX_MEMBERS_PER_LIST}."
                ),
            )

    # ── Step 4: Build content_id → track_id map ────────────────────────────────
    tracks_result = (
        sb.table("rekordbox_tracks")
        .select("id, rekordbox_content_id, master_content_id")
        .eq("import_id", import_id)
        .execute()
    )
    tracks_data: List[Dict[str, Any]] = tracks_result.data or []

    # Index by master_content_id first, then by rekordbox_content_id as fallback.
    # Each maps content_id_value -> list[track_id] (to detect ambiguity).
    master_id_map: Dict[str, List[str]] = {}
    content_id_map: Dict[str, List[str]] = {}
    for row in tracks_data:
        track_id = row["id"]
        mcid = row.get("master_content_id")
        rcid = row.get("rekordbox_content_id")
        if mcid:
            master_id_map.setdefault(mcid, []).append(track_id)
        if rcid:
            content_id_map.setdefault(rcid, []).append(track_id)

    # ── Step 5: Upsert all lists (first pass — no parent linkage) ─────────────
    # source_list_id → newly upserted DB uuid
    source_to_db_id: Dict[str, str] = {}
    warnings: List[str] = []
    lists_imported = 0
    folders_imported = 0
    duplicate_records = 0

    for lst in payload.lists:
        row = {
            "import_id": import_id,
            "source_list_id": lst.source_list_id,
            "name": lst.name,
            "sort_order": lst.sort_order,
            "is_folder": lst.is_folder,
            "attribute": lst.attribute,
            "criteria_raw": lst.criteria_raw,
            "parent_list_id": None,  # resolved in second pass
        }
        try:
            upsert_result = (
                sb.table("rekordbox_related_track_lists")
                .upsert(row, on_conflict="import_id,source_list_id")
                .execute()
            )
            upserted = upsert_result.data
            if upserted:
                db_id = upserted[0]["id"] if isinstance(upserted, list) else upserted.get("id")
                if db_id:
                    source_to_db_id[lst.source_list_id] = db_id
            if lst.is_folder:
                folders_imported += 1
            else:
                lists_imported += 1
        except Exception as exc:
            err_str = str(exc)
            if "duplicate" in err_str.lower() or "unique" in err_str.lower():
                duplicate_records += 1
                warnings.append(
                    f"Duplicate list skipped: source_list_id={lst.source_list_id!r}"
                )
            else:
                logger.error("Failed to upsert list %s: %s", lst.source_list_id, exc)
                warnings.append(f"Failed to upsert list {lst.source_list_id!r}: skipped")

    # ── Step 6: Resolve parent list relationships (second pass) ────────────────
    for lst in payload.lists:
        if lst.parent_source_list_id and lst.source_list_id in source_to_db_id:
            parent_db_id = source_to_db_id.get(lst.parent_source_list_id)
            if parent_db_id is None:
                warnings.append(
                    f"Parent list {lst.parent_source_list_id!r} not found for "
                    f"list {lst.source_list_id!r}; parent_list_id left NULL."
                )
                continue
            child_db_id = source_to_db_id[lst.source_list_id]
            try:
                sb.table("rekordbox_related_track_lists").update(
                    {"parent_list_id": parent_db_id}
                ).eq("id", child_db_id).execute()
            except Exception as exc:
                logger.error(
                    "Failed to set parent for list %s: %s", lst.source_list_id, exc
                )
                warnings.append(
                    f"Failed to set parent for list {lst.source_list_id!r}."
                )

    # ── Step 7: Replace memberships ────────────────────────────────────────────
    members_imported = 0
    unmatched_tracks = 0
    ambiguous_tracks = 0

    for lst in payload.lists:
        if lst.is_folder:
            continue
        list_db_id = source_to_db_id.get(lst.source_list_id)
        if list_db_id is None:
            # List failed to upsert earlier; skip membership processing
            continue

        # Resolve track IDs for all members before touching the DB
        resolved_members: List[Tuple[str, int]] = []  # (track_id, position)
        list_unmatched = 0
        list_ambiguous = 0

        for member in lst.members:
            mcid = member.master_content_id
            # Primary: match by master_content_id
            candidates = master_id_map.get(mcid)
            if candidates is None:
                # Fallback: match by rekordbox_content_id
                candidates = content_id_map.get(mcid)

            if candidates is None or len(candidates) == 0:
                list_unmatched += 1
                continue
            if len(candidates) > 1:
                list_ambiguous += 1
                warnings.append(
                    f"Ambiguous track match for master_content_id={mcid!r} "
                    f"in list {lst.source_list_id!r}: {len(candidates)} candidates; skipped."
                )
                continue
            resolved_members.append((candidates[0], member.position))

        unmatched_tracks += list_unmatched
        ambiguous_tracks += list_ambiguous

        # Delete existing memberships for this list, then insert new ones
        try:
            sb.table("rekordbox_related_track_members").delete().eq(
                "list_id", list_db_id
            ).execute()
        except Exception as exc:
            logger.error(
                "Failed to delete existing members for list %s: %s",
                lst.source_list_id,
                exc,
            )
            warnings.append(
                f"Failed to clear existing members for list {lst.source_list_id!r}; skipped."
            )
            continue

        # Insert new members sorted by position
        sorted_members = sorted(resolved_members, key=lambda t: t[1])
        for track_id, position in sorted_members:
            try:
                sb.table("rekordbox_related_track_members").insert(
                    {
                        "list_id": list_db_id,
                        "track_id": track_id,
                        "position": position,
                    }
                ).execute()
                members_imported += 1
            except Exception as exc:
                err_str = str(exc)
                if "duplicate" in err_str.lower() or "unique" in err_str.lower():
                    duplicate_records += 1
                else:
                    logger.error(
                        "Failed to insert member track_id=%s in list %s: %s",
                        track_id,
                        lst.source_list_id,
                        exc,
                    )
                    warnings.append(
                        f"Failed to insert member in list {lst.source_list_id!r}."
                    )

    return RelatedTracksImportResponse(
        import_id=import_id,
        lists_imported=lists_imported,
        folders_imported=folders_imported,
        members_imported=members_imported,
        unmatched_tracks=unmatched_tracks,
        ambiguous_tracks=ambiguous_tracks,
        duplicate_records=duplicate_records,
        warnings=warnings,
    )
