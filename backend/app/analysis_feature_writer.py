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
    """Reconcile one track through the canonical DB + ANLZ cue path."""
    from dropdex_importer.cue_parser import CUE_MATCH_TOLERANCE_MS  # noqa: PLC0415
    from dropdex_importer.cue_reconciliation import (  # noqa: PLC0415
        apply_cue_reconciliation_plan,
        build_cue_reconciliation_plan,
    )

    try:
        resp = (
            sb.table("rekordbox_cues")
            .select("*")
            .eq("track_id", track_id)
            .execute()
        )
        plan = build_cue_reconciliation_plan(
            resp.data or [],
            anlz_entries,
            import_id=import_id,
            track_id=track_id,
            tolerance_ms=CUE_MATCH_TOLERANCE_MS,
        )
        apply_cue_reconciliation_plan(sb, plan)
        return True
    except Exception as exc:
        logger.error("Failed to reconcile cues for track %s: %s", track_id, exc)
        return False


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


# ── Optional PVDI vocal analysis ──────────────────────────────────────────────

def write_vocal_analysis(
    sb: Any,
    import_id: str,
    track_id: str,
    result: Any,
    source_asset_id: Optional[str],
    parser_version: str,
) -> bool:
    """Persist compact optional PVDI evidence for one track.

    ``result is None`` means a complete .2EX scan found no PVDI tag; any stale
    row for this track is removed.  All failures stay feature-local and return
    False so callers can log diagnostics without affecting library readiness.
    """
    try:
        table = sb.table("rekordbox_track_vocal_analysis")
        if result is None:
            table.delete().eq("track_id", track_id).execute()
            return True

        row = {
            "import_id": import_id,
            "track_id": track_id,
            "source_2ex_asset_id": source_asset_id,
            "source_tag": result.source_tag,
            "source_header_length": result.source_header_length,
            "source_u1": result.source_u1,
            "source_u2": result.source_u2,
            "frame_duration_ms": result.frame_duration_ms,
            "frame_count": result.frame_count,
            "regions": [region.as_dict() for region in result.regions],
            "integrity_status": result.integrity_status,
            "complete": bool(result.complete),
            "parse_warnings": result.warning_dicts(),
            "parser_version": parser_version,
        }
        table.upsert(row, on_conflict="track_id").execute()
        return True
    except Exception as exc:
        logger.error("Failed to write optional PVDI analysis for track %s: %s", track_id, exc)
        return False
