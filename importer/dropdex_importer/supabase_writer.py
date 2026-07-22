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
  6. rekordbox_cues     — batched inserts; skips rows whose content_id is unresolved
  7. rekordbox_recommendation_edges — batched inserts; skips unresolved pairs
  8. rekordbox_imports  — update status = completed + final counts + analysis_status

On any exception after step 1, the import row is marked status = failed.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Dict, Iterator, List, Optional

from .models import NormalizedAnalysisManifestEntry, ParsedLibrary

logger = logging.getLogger(__name__)

_BATCH_SIZE = 500


# ── Structured write error ────────────────────────────────────────────────────


def _extract_postgrest_error(original_error: Exception) -> dict[str, object | None]:
    """Return the safe structured fields exposed by postgrest.APIError.

    postgrest-py exposes ``code``, ``message``, ``hint`` and ``details`` as
    attributes. Older releases and several test doubles instead place a dict in
    ``args[0]``. Supporting both forms prevents the real database error code
    from being erased before the API layer can classify it.
    """

    raw: dict[str, object] = {}

    json_method = getattr(original_error, "json", None)
    if callable(json_method):
        try:
            value = json_method()
            if isinstance(value, dict):
                raw = value
        except Exception:
            pass

    if not raw and getattr(original_error, "args", None):
        first = original_error.args[0]
        if isinstance(first, dict):
            raw = first

    def _safe_value(name: str) -> object | None:
        value = getattr(original_error, name, None)
        return value if value is not None else raw.get(name)

    return {
        "code": _safe_value("code"),
        "message": _safe_value("message"),
        "hint": _safe_value("hint"),
        "details": _safe_value("details"),
    }


class RekordboxWriteError(RuntimeError):
    """Raised when a specific Supabase write stage fails.

    Attributes are safe for logging and for inclusion in API error responses —
    they never contain credentials, JWTs, or raw database payloads.
    """

    def __init__(
        self,
        *,
        stage: str,
        table: str,
        operation: str,
        original_error: Exception,
        import_id: Optional[str] = None,
    ) -> None:
        self.stage = stage
        self.table = table
        self.operation = operation
        self.import_id = import_id

        # Extract safe PostgREST fields; never forward credentials or raw SQL.
        err_dict = _extract_postgrest_error(original_error)
        self.db_code = str(err_dict["code"]) if err_dict["code"] is not None else None
        self.db_message = (
            str(err_dict["message"]) if err_dict["message"] is not None else None
        )
        self.db_hint = str(err_dict["hint"]) if err_dict["hint"] is not None else None
        self.db_details = (
            str(err_dict["details"]) if err_dict["details"] is not None else None
        )

        super().__init__(
            f"Rekordbox import write failed stage={stage} table={table} "
            f"operation={operation} import_id={import_id} "
            f"error_code={self.db_code} message={self.db_message}"
        )

    def log(self) -> None:
        logger.error(
            "Rekordbox import write failed\n"
            "  stage=%s\n  table=%s\n  operation=%s\n  import_id=%s\n"
            "  error_code=%s\n  message=%s\n  hint=%s\n  details=%s",
            self.stage,
            self.table,
            self.operation,
            self.import_id,
            self.db_code,
            self.db_message,
            self.db_hint,
            self.db_details,
        )


# ── Public result type ────────────────────────────────────────────────────────


@dataclass
class ImportWriteResult:
    """Full metadata returned by a successful write_to_supabase call."""

    import_id: str
    rb_to_sb_track: Dict[str, str]
    """Maps Rekordbox content_id → Supabase track UUID."""
    manifest: List[NormalizedAnalysisManifestEntry]
    """Analysis manifest entries, one per track with an analysis path."""
    cue_count: int
    """Number of cue rows successfully inserted."""
    recommendation_edge_count: int
    """Number of recommendedLike rows successfully inserted."""


# ── Public API ────────────────────────────────────────────────────────────────


def write_to_supabase(
    library: ParsedLibrary,
    supabase_url: str,
    supabase_key: str,
    owner_user_id: str,
    *,
    import_id: str | None = None,
    finalize_status: str | None = "completed",
    should_cancel: Callable[[], bool] | None = None,
) -> ImportWriteResult:
    """
    Write library to Supabase. Returns an ImportWriteResult on success.

    The service-role key bypasses RLS, so inserts succeed regardless of auth state.
    On failure after the import row is created, the row is marked 'failed' before
    re-raising.
    """
    try:
        from supabase import create_client
    except ImportError as exc:
        raise ImportError(
            "supabase package is not installed.\nRun: pip install -r importer/requirements.txt"
        ) from exc

    sb = create_client(supabase_url, supabase_key)
    created_here = import_id is None

    def _check_cancelled() -> None:
        if should_cancel and should_cancel():
            raise RuntimeError("IMPORT_CANCELLED")

    def _wrap(stage: str, table: str, operation: str, fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except RekordboxWriteError:
            raise
        except Exception as exc:
            raise RekordboxWriteError(
                stage=stage,
                table=table,
                operation=operation,
                original_error=exc,
                import_id=import_id,
            ) from exc

    try:
        _check_cancelled()
        if import_id is None:
            import_id = _wrap(
                "create_import",
                "rekordbox_imports",
                "insert",
                _create_import_row,
                sb,
                library,
                owner_user_id,
            )
            logger.info("Created import row: %s", import_id)
        else:
            response = (
                sb.table("rekordbox_imports")
                .update(
                    {
                        "database_version": library.database_version,
                        "device_name": library.device_name,
                        "rekordbox_created_date": library.rekordbox_created_date,
                    }
                )
                .eq("id", import_id)
                .eq("user_id", owner_user_id)
                .eq("status", "processing")
                .execute()
            )
            if not response.data:
                raise RuntimeError("IMPORT_CANCELLED_OR_STATE_CHANGED")

        _check_cancelled()
        rb_to_sb_track = _wrap(
            "insert_tracks",
            "rekordbox_tracks",
            "batch_insert",
            _insert_tracks,
            sb,
            library,
            import_id,
        )
        logger.info("Inserted %d tracks", len(rb_to_sb_track))
        _check_cancelled()

        rb_to_sb_playlist = _wrap(
            "insert_playlists",
            "rekordbox_playlists",
            "batch_insert",
            _insert_playlists,
            sb,
            library,
            import_id,
        )
        logger.info("Inserted %d playlists", len(rb_to_sb_playlist))
        _check_cancelled()

        _wrap(
            "update_playlist_parents",
            "rekordbox_playlists",
            "batch_update",
            _update_parent_playlist_ids,
            sb,
            library,
            rb_to_sb_playlist,
        )

        placed = _wrap(
            "insert_playlist_tracks",
            "rekordbox_playlist_tracks",
            "batch_insert",
            _insert_placements,
            sb,
            library,
            rb_to_sb_track,
            rb_to_sb_playlist,
        )
        logger.info("Inserted %d placements", placed)
        _check_cancelled()

        cue_count = _wrap(
            "insert_cues",
            "rekordbox_cues",
            "batch_insert",
            _insert_cues,
            sb,
            library,
            import_id,
            rb_to_sb_track,
        )
        logger.info("Inserted %d cues", cue_count)
        _check_cancelled()

        edge_count = _wrap(
            "insert_recommendation_edges",
            "rekordbox_recommendation_edges",
            "batch_insert",
            _insert_recommendation_edges,
            sb,
            library,
            import_id,
            rb_to_sb_track,
        )
        logger.info("Inserted %d recommendation edges", edge_count)
        _check_cancelled()

        _wrap(
            "finalize_import",
            "rekordbox_imports",
            "update",
            _finalize_import,
            sb,
            import_id,
            library,
            finalize_status,
        )
        logger.info("Import finalized: %s", import_id)

    except Exception as exc:
        if import_id and created_here:
            safe_msg = str(exc)[:2000]
            _mark_failed(sb, import_id, safe_msg)
        if isinstance(exc, RekordboxWriteError):
            exc.log()
        raise

    return ImportWriteResult(
        import_id=import_id,  # type: ignore[arg-type]
        rb_to_sb_track=rb_to_sb_track,  # type: ignore[possibly-undefined]
        manifest=library.analysis_manifest,
        cue_count=cue_count,  # type: ignore[possibly-undefined]
        recommendation_edge_count=edge_count,  # type: ignore[possibly-undefined]
    )


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


def _insert_tracks(sb: object, library: ParsedLibrary, import_id: str) -> Dict[str, str]:
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
            "duration_ms": t.duration_ms,
            "rating": t.rating,
            "comments": t.comments,
            "file_path": t.file_path,
            "file_path_normalized": t.file_path_normalized,
            "file_path_volume": t.file_path_volume,
            "file_path_casefold": t.file_path_casefold,
            "file_name": t.file_name,
            "file_format": t.file_format,
            "file_type_code": t.file_type_code,
            "file_extension": t.file_extension,
            "file_size_bytes": t.file_size_bytes,
            "bitrate_kbps": t.bitrate_kbps,
            "bit_depth": t.bit_depth,
            "sample_rate_hz": t.sample_rate_hz,
            "date_added": t.date_added,
            "source_title": t.source_title,
            "subtitle": t.subtitle,
            "original_artist": t.original_artist,
            "composer": t.composer,
            "lyricist": t.lyricist,
            "track_number": t.track_number,
            "disc_number": t.disc_number,
            "release_year": t.release_year,
            "release_date": t.release_date,
            "color_name": t.color_name,
            "artwork_path": t.artwork_path,
            "isrc": t.isrc,
            "hot_cue_auto_load": t.hot_cue_auto_load,
            "source_metadata": t.source_metadata,
            # Analysis pipeline columns (null when not extracted)
            "master_db_id": t.master_db_id,
            "master_content_id": t.master_content_id,
            "analysis_data_file_path": t.analysis_data_file_path,
            "analysed_bits": t.analysed_bits,
            "cue_update_count": t.cue_update_count,
            "analysis_data_update_count": t.analysis_data_update_count,
            "information_update_count": t.information_update_count,
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


def _insert_playlists(sb: object, library: ParsedLibrary, import_id: str) -> Dict[str, str]:
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
    grouped: dict[str, list] = defaultdict(list)
    for pc in library.placements:
        grouped[pc.rekordbox_playlist_id].append(pc)

    rows: List[dict] = []
    skipped = 0

    for rb_playlist_id, pcs in grouped.items():
        playlist_sb_id = rb_to_sb_playlist.get(rb_playlist_id)
        if not playlist_sb_id:
            skipped += len(pcs)
            logger.debug(
                "Playlist %s not in UUID map — skipping %d placements",
                rb_playlist_id,
                len(pcs),
            )
            continue

        sorted_pcs = sorted(pcs, key=lambda x: (x.position, x.rekordbox_content_id))

        for new_pos, pc in enumerate(sorted_pcs, start=1):
            track_sb_id = rb_to_sb_track.get(pc.rekordbox_content_id)
            if not track_sb_id:
                skipped += 1
                logger.debug(
                    "Content %s not in UUID map — skipping placement",
                    pc.rekordbox_content_id,
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


def _insert_cues(
    sb: object,
    library: ParsedLibrary,
    import_id: str,
    rb_to_sb_track: Dict[str, str],
) -> int:
    """Insert cue rows. Returns the count of successfully inserted rows."""
    rows: List[dict] = []
    skipped = 0

    for cue in library.cues:
        track_sb_id = rb_to_sb_track.get(cue.rekordbox_content_id)
        if not track_sb_id:
            skipped += 1
            logger.warning(
                "Cue %s: content_id %s not resolved — skipping",
                cue.rekordbox_cue_id,
                cue.rekordbox_content_id,
            )
            continue

        start_ms: Optional[float] = cue.in_usec / 1000.0 if cue.in_usec is not None else None
        end_ms: Optional[float] = cue.out_usec / 1000.0 if cue.out_usec is not None else None

        source_payload = {
            "cue_id": cue.rekordbox_cue_id,
            "kind": cue.kind,
            "in_150_frames_per_second": cue.in_150_frames_per_second,
            "out_150_frames_per_second": cue.out_150_frames_per_second,
            "in_mpeg_frame_number": cue.in_mpeg_frame_number,
            "out_mpeg_frame_number": cue.out_mpeg_frame_number,
            "in_mpeg_abs": cue.in_mpeg_abs,
            "out_mpeg_abs": cue.out_mpeg_abs,
            "in_decoding_start_frame_position": cue.in_decoding_start_frame_position,
            "out_decoding_start_frame_position": cue.out_decoding_start_frame_position,
            "in_file_offset_in_block": cue.in_file_offset_in_block,
            "out_file_offset_in_block": cue.out_file_offset_in_block,
            "in_number_of_sample_in_block": cue.in_number_of_sample_in_block,
            "out_number_of_sample_in_block": cue.out_number_of_sample_in_block,
        }

        rows.append(
            {
                "import_id": import_id,
                "track_id": track_sb_id,
                "rekordbox_cue_id": cue.rekordbox_cue_id,
                "dedupe_key": cue.dedupe_key,
                "cue_family": cue.cue_family,
                "hot_cue_slot": cue.hot_cue_slot,
                "point_type": cue.point_type,
                "source_kind": str(cue.kind),
                "start_usec": cue.in_usec,
                "end_usec": cue.out_usec,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "color_table_index": cue.color_table_index,
                "color_hex": None,  # Color table has no hex/RGB column
                "color_name": cue.color_name,
                "comment": cue.cue_comment,
                "is_active_loop": cue.is_active_loop,
                "beat_loop_numerator": cue.beat_loop_numerator,
                "beat_loop_denominator": cue.beat_loop_denominator,
                "source_db_present": True,
                "source_anlz_present": False,
                "source_conflict": False,
                "source_payload": source_payload,
            }
        )

    if skipped:
        logger.warning("Skipped %d cue(s) — content_id resolution failed", skipped)

    for batch in _chunks(rows, _BATCH_SIZE):
        sb.table("rekordbox_cues").insert(batch).execute()  # type: ignore[attr-defined]

    return len(rows)


def _insert_recommendation_edges(
    sb: object,
    library: ParsedLibrary,
    import_id: str,
    rb_to_sb_track: Dict[str, str],
) -> int:
    """Insert recommendedLike rows. Returns the count of successfully inserted rows."""
    rows: List[dict] = []
    skipped = 0

    for edge in library.recommendation_edges:
        source_sb_id = rb_to_sb_track.get(edge.source_rekordbox_content_id)
        target_sb_id = rb_to_sb_track.get(edge.target_rekordbox_content_id)

        if not source_sb_id or not target_sb_id:
            skipped += 1
            logger.warning(
                "Recommendation edge %s → %s: could not resolve UUIDs — skipping",
                edge.source_rekordbox_content_id,
                edge.target_rekordbox_content_id,
            )
            continue

        rows.append(
            {
                "import_id": import_id,
                "source_track_id": source_sb_id,
                "target_track_id": target_sb_id,
                "source_content_id": edge.source_rekordbox_content_id,
                "target_content_id": edge.target_rekordbox_content_id,
                "rating": edge.rating,
                "source_created_at": edge.source_created_at,
                "relationship_source": "recommended_like",
                "direction_preserved": edge.direction_preserved,
                "source_payload": edge.source_payload,
            }
        )

    if skipped:
        logger.warning("Skipped %d recommendation edge(s) — UUID resolution failed", skipped)

    for batch in _chunks(rows, _BATCH_SIZE):
        sb.table("rekordbox_recommendation_edges").insert(batch).execute()  # type: ignore[attr-defined]

    return len(rows)


def _finalize_import(
    sb: object,
    import_id: str,
    library: ParsedLibrary,
    finalize_status: str | None = "completed",
) -> None:
    has_analysis = len(library.analysis_manifest) > 0
    analysis_status = "awaiting_upload" if has_analysis else "not_requested"

    sb.table("rekordbox_imports").update(  # type: ignore[attr-defined]
        {
            **({"status": finalize_status} if finalize_status else {}),
            "track_count": len(library.tracks),
            "playlist_count": len(library.playlists),
            "playlist_track_count": len(library.placements),
            "analysis_status": analysis_status,
            "analysis_expected_track_count": len(library.analysis_manifest),
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
