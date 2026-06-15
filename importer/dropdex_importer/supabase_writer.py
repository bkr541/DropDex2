"""
Write a ParsedLibrary to Supabase using the service-role key.

Insert order:
  1. rekordbox_imports  — one row (status = processing)
  2. rekordbox_tracks   — batched inserts; capture UUID map
  3. rekordbox_playlists — insert without parent refs; capture UUID map
  4. rekordbox_playlists — second pass: set parent_playlist_id via individual UPDATEs
  5. rekordbox_playlist_tracks — batched inserts using resolved UUIDs;
                                  positions are reassigned to gapless 1-based order
                                  per playlist to satisfy the PK constraint
  6. rekordbox_imports  — update status = completed + final counts

On any exception after step 1, the import row is marked status = failed.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Dict, Iterator, List, Optional

from .models import ParsedLibrary

logger = logging.getLogger(__name__)

_BATCH_SIZE = 500


# ── Public API ────────────────────────────────────────────────────────────────


def write_to_supabase(
    library: ParsedLibrary,
    supabase_url: str,
    supabase_key: str,
    owner_user_id: str,
) -> str:
    """
    Write library to Supabase. Returns the new import UUID on success.

    The service-role key bypasses RLS, so inserts succeed regardless of auth state.
    On failure after the import row is created, the row is marked 'failed' before
    re-raising.
    """
    try:
        from supabase import create_client
    except ImportError as exc:
        raise ImportError(
            "supabase package is not installed.\n"
            "Run: pip install -r importer/requirements.txt"
        ) from exc

    sb = create_client(supabase_url, supabase_key)
    import_id: Optional[str] = None

    try:
        import_id = _create_import_row(sb, library, owner_user_id)
        logger.info("Created import row: %s", import_id)

        rb_to_sb_track = _insert_tracks(sb, library, import_id)
        logger.info("Inserted %d tracks", len(rb_to_sb_track))

        rb_to_sb_playlist = _insert_playlists(sb, library, import_id)
        logger.info("Inserted %d playlists", len(rb_to_sb_playlist))

        _update_parent_playlist_ids(sb, library, rb_to_sb_playlist)

        placed = _insert_placements(sb, library, rb_to_sb_track, rb_to_sb_playlist)
        logger.info("Inserted %d placements", placed)

        _finalize_import(sb, import_id, library)
        logger.info("Import finalized: %s", import_id)

    except Exception as exc:
        if import_id:
            _mark_failed(sb, import_id, str(exc))
        raise

    return import_id  # type: ignore[return-value]


def remove_latest_failed_import(sb: object, owner_user_id: str) -> Optional[str]:
    """
    Delete the most-recent 'failed' import owned by owner_user_id.
    Cascading FK constraints remove all related tracks/playlists/placements.
    Returns the deleted import UUID, or None if no failed import was found.
    """
    response = (
        sb.table("rekordbox_imports")  # type: ignore[attr-defined]
        .select("id")
        .eq("user_id", owner_user_id)
        .eq("status", "failed")
        .order("imported_at", desc=True)
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    failed_id = response.data[0]["id"]
    sb.table("rekordbox_imports").delete().eq("id", failed_id).execute()  # type: ignore[attr-defined]
    logger.info("Deleted failed import: %s", failed_id)
    return failed_id


# ── Private helpers ───────────────────────────────────────────────────────────


def _create_import_row(sb: object, library: ParsedLibrary, owner_user_id: str) -> str:
    row = {
        "user_id": owner_user_id,
        "source_filename": library.source_filename,
        "source_type": "onelibrary",
        "database_version": library.database_version,
        "device_name": library.device_name,
        "rekordbox_created_date": library.rekordbox_created_date,
        "status": "processing",
    }
    response = sb.table("rekordbox_imports").insert(row).execute()  # type: ignore[attr-defined]
    return response.data[0]["id"]


def _insert_tracks(
    sb: object, library: ParsedLibrary, import_id: str
) -> Dict[str, str]:
    """Insert tracks in batches. Returns {rekordbox_content_id: supabase_uuid}."""
    rows = [
        {
            "import_id": import_id,
            "rekordbox_content_id": t.rekordbox_content_id,
            "title": t.title,
            "artist": t.artist,
            "album": t.album,
            "remixer": t.remixer,
            "genre": t.genre,
            "label": t.label,
            "musical_key": t.musical_key,
            "camelot_key": t.camelot_key,
            "normalized_key_name": t.normalized_key_name,
            "key_tonic": t.key_tonic,
            "key_mode": t.key_mode,
            "bpm": float(t.bpm) if t.bpm is not None else None,
            "duration_seconds": t.duration_seconds,
            "rating": t.rating,
            "comments": t.comments,
            "file_path": t.file_path,
            "file_format": t.file_format,
            "date_added": t.date_added,
        }
        for t in library.tracks
    ]

    rb_to_sb: Dict[str, str] = {}
    for batch in _chunks(rows, _BATCH_SIZE):
        response = sb.table("rekordbox_tracks").insert(batch).execute()  # type: ignore[attr-defined]
        if not response.data:
            raise RuntimeError(
                "Supabase returned no data after track insert — "
                "check your service-role key and RLS policies."
            )
        for row in response.data:
            rb_to_sb[row["rekordbox_content_id"]] = row["id"]

    return rb_to_sb


def _insert_playlists(
    sb: object, library: ParsedLibrary, import_id: str
) -> Dict[str, str]:
    """
    Insert playlists without parent references (first pass).
    Returns {rekordbox_playlist_id: supabase_uuid}.
    Parent links are wired in _update_parent_playlist_ids().
    """
    rows = [
        {
            "import_id": import_id,
            "rekordbox_playlist_id": p.rekordbox_playlist_id,
            "name": p.name,
            "parent_playlist_id": None,
            "sort_order": p.sort_order,
            "is_folder": p.is_folder,
        }
        for p in library.playlists
    ]

    rb_to_sb: Dict[str, str] = {}
    for batch in _chunks(rows, _BATCH_SIZE):
        response = sb.table("rekordbox_playlists").insert(batch).execute()  # type: ignore[attr-defined]
        if not response.data:
            raise RuntimeError(
                "Supabase returned no data after playlist insert — "
                "check your service-role key and RLS policies."
            )
        for row in response.data:
            rb_to_sb[row["rekordbox_playlist_id"]] = row["id"]

    return rb_to_sb


def _update_parent_playlist_ids(
    sb: object,
    library: ParsedLibrary,
    rb_to_sb: Dict[str, str],
) -> None:
    """Second pass: resolve parent references and UPDATE each child playlist row."""
    for p in library.playlists:
        if not p.parent_rekordbox_playlist_id:
            continue
        parent_supabase_id = rb_to_sb.get(p.parent_rekordbox_playlist_id)
        child_supabase_id = rb_to_sb.get(p.rekordbox_playlist_id)
        if not parent_supabase_id or not child_supabase_id:
            logger.warning(
                "Playlist '%s': could not resolve parent link "
                "(rekordbox parent id=%s) — parent_playlist_id will be NULL",
                p.name,
                p.parent_rekordbox_playlist_id,
            )
            continue
        sb.table("rekordbox_playlists").update(  # type: ignore[attr-defined]
            {"parent_playlist_id": parent_supabase_id}
        ).eq("id", child_supabase_id).execute()


def _insert_placements(
    sb: object,
    library: ParsedLibrary,
    rb_to_sb_track: Dict[str, str],
    rb_to_sb_playlist: Dict[str, str],
) -> int:
    """
    Insert playlist-track rows in batches.

    Positions are reassigned to gapless 1-based integers per playlist
    (sorted by the source sequenceNo) to satisfy the (playlist_id, position) PK.
    """
    # Group placements by playlist, sorting by source sequenceNo
    grouped: dict[str, list] = defaultdict(list)
    for pc in library.placements:
        grouped[pc.rekordbox_playlist_id].append(pc)

    rows: List[dict] = []
    skipped = 0

    for rb_playlist_id, pcs in grouped.items():
        playlist_sb_id = rb_to_sb_playlist.get(rb_playlist_id)
        if not playlist_sb_id:
            skipped += len(pcs)
            logger.debug("Playlist %s not in UUID map — skipping %d placements", rb_playlist_id, len(pcs))
            continue

        # Sort by source sequenceNo; break ties by content_id for determinism
        sorted_pcs = sorted(pcs, key=lambda x: (x.position, x.rekordbox_content_id))

        for new_pos, pc in enumerate(sorted_pcs, start=1):
            track_sb_id = rb_to_sb_track.get(pc.rekordbox_content_id)
            if not track_sb_id:
                skipped += 1
                logger.debug(
                    "Content %s not in UUID map — skipping placement", pc.rekordbox_content_id
                )
                continue
            rows.append(
                {
                    "playlist_id": playlist_sb_id,
                    "track_id": track_sb_id,
                    "position": new_pos,
                }
            )

    if skipped:
        logger.warning("Skipped %d placement(s) — UUID resolution failed", skipped)

    for batch in _chunks(rows, _BATCH_SIZE):
        sb.table("rekordbox_playlist_tracks").insert(batch).execute()  # type: ignore[attr-defined]

    return len(rows)


def _finalize_import(sb: object, import_id: str, library: ParsedLibrary) -> None:
    sb.table("rekordbox_imports").update(  # type: ignore[attr-defined]
        {
            "status": "completed",
            "track_count": len(library.tracks),
            "playlist_count": len(library.playlists),
            "playlist_track_count": len(library.placements),
        }
    ).eq("id", import_id).execute()


def _mark_failed(sb: object, import_id: str, error_message: str) -> None:
    try:
        sb.table("rekordbox_imports").update(  # type: ignore[attr-defined]
            {
                "status": "failed",
                "error_message": error_message[:2000],
            }
        ).eq("id", import_id).execute()
        logger.info("Marked import %s as failed", import_id)
    except Exception as exc:
        logger.error("Could not mark import as failed: %s", exc)


def _chunks(lst: List, n: int) -> Iterator[List]:
    for i in range(0, len(lst), n):
        yield lst[i : i + n]
