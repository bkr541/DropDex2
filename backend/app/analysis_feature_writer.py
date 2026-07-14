"""
Feature-level writers for Rekordbox ANLZ analysis data.

Each writer is isolated: a failure in one feature (e.g., waveform) does not
prevent the others (beat grid, cues, phrases) from being persisted.

Security invariants
-------------------
- No server filesystem paths appear in DB records.
- Detail waveform bytes are uploaded via the service-role client; only the
  logical Storage path is stored in the DB.
- All writes use the service-role client — RLS is not enforced here.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_ANALYSIS_BUCKET = "rekordbox-analysis-assets"


# ── Beat grid ─────────────────────────────────────────────────────────────────

def write_beat_grid(
    sb: Any,
    import_id: str,
    track_id: str,
    result: Any,            # BeatGridResult from beatgrid_parser
    source_asset_id: Optional[str],
    parser_version: str,
) -> bool:
    """
    Upsert one rekordbox_track_beat_grids row for the track.
    Returns True on success.
    """
    try:
        row = {
            "import_id": import_id,
            "track_id": track_id,
            "source_tag": result.source_tag,
            "beats": [b.as_dict() for b in result.beats],
            "beat_count": result.beat_count,
            "downbeat_count": result.downbeat_count,
            "bar_count": result.bar_count,
            "first_beat_ms": result.first_beat_ms,
            "first_downbeat_ms": result.first_downbeat_ms,
            "minimum_bpm": result.minimum_bpm,
            "maximum_bpm": result.maximum_bpm,
            "is_variable_tempo": result.is_variable_tempo,
            "parser_version": parser_version,
            "source_asset_id": source_asset_id,
        }
        sb.table("rekordbox_track_beat_grids").upsert(
            row,
            on_conflict="track_id",
        ).execute()
        return True
    except Exception as exc:
        logger.error("Failed to write beat grid for track %s: %s", track_id, exc)
        return False


# ── Waveform ──────────────────────────────────────────────────────────────────

def write_waveform(
    sb: Any,
    import_id: str,
    track_id: str,
    result: Any,                        # WaveformBundle from waveform_parser
    user_id: str,
    asset_ids: Dict[str, Optional[str]],  # {"DAT": uuid|None, "EXT": uuid|None, ...}
    parser_version: str,
) -> bool:
    """
    Upsert one rekordbox_track_waveforms row.  Uploads detail waveform to Storage
    when present.  Returns True on success.
    """
    try:
        row: Dict[str, Any] = {
            "import_id": import_id,
            "track_id": track_id,
            "source_dat_asset_id": asset_ids.get("DAT"),
            "source_ext_asset_id": asset_ids.get("EXT"),
            "source_2ex_asset_id": asset_ids.get("2EX"),
            "parser_version": parser_version,
        }

        if result.preview is not None:
            p = result.preview
            row["preview_format"] = p.format
            row["preview_column_count"] = p.column_count
            row["preview_columns"] = p.columns

        if result.detail is not None:
            d = result.detail
            storage_path = (
                f"{user_id}/{import_id}/waveform/{track_id}/"
                f"detail.v{parser_version}.json.gz"
            )
            try:
                sb.storage.from_(_ANALYSIS_BUCKET).upload(
                    path=storage_path,
                    file=d.compressed_bytes,
                    file_options={
                        "upsert": "true",
                        "content-type": "application/gzip",
                    },
                )
                row["detail_format"] = d.format
                row["detail_column_count"] = d.column_count
                row["detail_storage_bucket"] = _ANALYSIS_BUCKET
                row["detail_storage_path"] = storage_path
            except Exception as upload_exc:
                logger.error(
                    "Detail waveform upload failed for track %s: %s", track_id, upload_exc
                )
                # Continue — preview still gets written

        sb.table("rekordbox_track_waveforms").upsert(
            row,
            on_conflict="track_id",
        ).execute()
        return True
    except Exception as exc:
        logger.error("Failed to write waveform for track %s: %s", track_id, exc)
        return False


# ── Cues ──────────────────────────────────────────────────────────────────────

def reconcile_and_write_cues(
    sb: Any,
    import_id: str,
    track_id: str,
    anlz_entries: List[Any],    # List[AnlzCueEntry] from cue_parser
    warnings: List[Any],        # List[AnalysisParseWarning] (unused here but kept for callers)
) -> bool:
    """
    Reconcile ANLZ cue entries against existing DB rows for the track.

    Matching algorithm:
    - Hot cues: match requires same slot AND start timing within tolerance.
    - Memory cues: match requires start timing within tolerance.
    - Matched rows: updated with ANLZ color/comment/slot data.
    - Unmatched ANLZ entries: inserted as new rows (source_db_present=False).
    Returns True on success.
    """
    from dropdex_importer.cue_parser import CUE_MATCH_TOLERANCE_MS  # noqa: PLC0415

    try:
        resp = (
            sb.table("rekordbox_cues")
            .select("id, cue_family, hot_cue_slot, start_ms")
            .eq("track_id", track_id)
            .execute()
        )
        existing: List[dict] = resp.data or []
    except Exception as exc:
        logger.error("Failed to fetch existing cues for track %s: %s", track_id, exc)
        return False

    matched_db_ids: set = set()

    for anlz in anlz_entries:
        match = _find_db_match(anlz, existing, matched_db_ids, CUE_MATCH_TOLERANCE_MS)

        if match:
            matched_db_ids.add(match["id"])
            update: Dict[str, Any] = {
                "source_anlz_present": True,
            }
            # Enrich with ANLZ slot if DB slot was unknown
            if anlz.hot_cue_slot is not None:
                update["hot_cue_slot"] = anlz.hot_cue_slot
            if anlz.color_hex is not None:
                update["color_hex"] = anlz.color_hex
            if anlz.color_id is not None:
                update["color_table_index"] = anlz.color_id
            if anlz.comment is not None:
                update["comment"] = anlz.comment
            if anlz.beat_loop_numerator is not None:
                update["beat_loop_numerator"] = anlz.beat_loop_numerator
            if anlz.beat_loop_denominator is not None:
                update["beat_loop_denominator"] = anlz.beat_loop_denominator
            try:
                sb.table("rekordbox_cues").update(update).eq("id", match["id"]).execute()
            except Exception as exc:
                logger.error("Failed to update cue %s: %s", match["id"], exc)

        else:
            dedupe_key = f"anlz:{import_id}:{anlz.source_tag}:{anlz.source_index}"
            row = {
                "import_id": import_id,
                "track_id": track_id,
                "dedupe_key": dedupe_key,
                "cue_family": anlz.cue_family,
                "hot_cue_slot": anlz.hot_cue_slot,
                "point_type": anlz.point_type,
                "start_ms": anlz.start_ms,
                "end_ms": anlz.end_ms,
                "color_hex": anlz.color_hex,
                "color_table_index": anlz.color_id,
                "comment": anlz.comment,
                "is_active_loop": anlz.is_active_loop,
                "beat_loop_numerator": anlz.beat_loop_numerator,
                "beat_loop_denominator": anlz.beat_loop_denominator,
                "source_db_present": False,
                "source_anlz_present": True,
                "source_conflict": False,
                "source_payload": anlz.source_payload,
            }
            try:
                sb.table("rekordbox_cues").insert(row).execute()
            except Exception as exc:
                logger.error(
                    "Failed to insert ANLZ-only cue for track %s (idx=%s): %s",
                    track_id, anlz.source_index, exc,
                )

    return True


def _find_db_match(
    anlz: Any,
    existing: List[dict],
    already_matched: set,
    tolerance_ms: float,
) -> Optional[dict]:
    """
    Find the best-matching existing DB cue row for an ANLZ entry.

    Hot cues: must match on both slot and timing.
    Memory cues: must match on timing only.
    """
    for db_cue in existing:
        if db_cue["id"] in already_matched:
            continue
        if db_cue["cue_family"] != anlz.cue_family:
            continue
        if anlz.cue_family == "hot":
            db_slot = db_cue.get("hot_cue_slot")
            anlz_slot = anlz.hot_cue_slot
            # Reject only when both slots are known and disagree
            if db_slot is not None and anlz_slot is not None and db_slot != anlz_slot:
                continue
        db_ms = db_cue.get("start_ms")
        if db_ms is None:
            continue
        if abs(float(db_ms) - anlz.start_ms) <= tolerance_ms:
            return db_cue
    return None


# ── Phrases ───────────────────────────────────────────────────────────────────

def write_phrases(
    sb: Any,
    import_id: str,
    track_id: str,
    entries: List[Any],     # List[PhraseEntry] from phrase_parser
    parser_version: str,
) -> bool:
    """
    Upsert phrase rows for the track.
    Uses on_conflict=(track_id, phrase_index) to handle re-imports cleanly.
    Returns True on success.
    """
    if not entries:
        return True

    try:
        rows = [
            {
                "import_id": import_id,
                "track_id": track_id,
                "phrase_index": e.phrase_index,
                "source_mood": e.source_mood,
                "source_kind": e.source_kind,
                "source_bank": e.source_bank,
                "normalized_label": e.normalized_label,
                "start_beat": e.start_beat,
                "end_beat": e.end_beat,
                "start_ms": e.start_ms,
                "end_ms": e.end_ms,
                "fill_start_beat": e.fill_start_beat,
                "fill_start_ms": e.fill_start_ms,
                "source_flags": e.source_flags,
                "source_payload": e.source_payload,
                "parser_version": parser_version,
            }
            for e in entries
        ]
        sb.table("rekordbox_track_phrases").upsert(
            rows,
            on_conflict="track_id,phrase_index",
        ).execute()
        return True
    except Exception as exc:
        logger.error("Failed to write phrases for track %s: %s", track_id, exc)
        return False
