"""
Phrase analysis extraction from PSSI tags.

PSSI (Song Structure Information) encodes the phrase segmentation of a track
as determined by Rekordbox's analysis engine.

Mood labels (track-level, from tag.content.mood):
  1 → "high_energy"
  2 → "mid_energy"
  3 → "low_energy"

Phrase kind labels (per entry, vary by mood):
  High energy (mood=1): 1→intro, 2→up, 3→down, 4→chorus, 5→verse, 6→bridge, 7→outro
  Mid/Low energy (mood=2,3): 1→intro, 2→verse, 3→chorus, 4→verse2, 5→bridge, 6→outro
  Unknown combinations → normalized_label=None (warning emitted)

Rules
-----
- Do not use average BPM to compute phrase timestamps.
- Derive phrase ms positions from the beat grid when available.
- Preserve all raw PSSI entry fields in source_payload.
- end_beat of phrase N = start_beat of phrase N+1 (or tag.content.end_beat for last).
- Fill metadata (beat_fill, fill flag) is preserved in source_flags.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .analysis_models import AnalysisParseWarning, ParsedAnalysisAsset
from .anlz_parser import get_first_tag
from .beatgrid_parser import BeatGridResult

logger = logging.getLogger(__name__)


_MOOD_LABELS: Dict[int, str] = {
    1: "high_energy",
    2: "mid_energy",
    3: "low_energy",
}

_KIND_LABELS_HIGH_ENERGY: Dict[int, str] = {
    1: "intro",
    2: "up",
    3: "down",
    4: "chorus",
    5: "verse",
    6: "bridge",
    7: "outro",
}

_KIND_LABELS_MID_LOW: Dict[int, str] = {
    1: "intro",
    2: "verse",
    3: "chorus",
    4: "verse2",
    5: "bridge",
    6: "outro",
}


def _map_kind_label(mood: int, kind: int) -> Optional[str]:
    if mood == 1:
        return _KIND_LABELS_HIGH_ENERGY.get(kind)
    if mood in (2, 3):
        return _KIND_LABELS_MID_LOW.get(kind)
    return None


@dataclass
class PhraseEntry:
    """One phrase segment extracted from PSSI data."""
    phrase_index: int               # 0-based position within track
    source_mood: str                # raw mood integer as string, e.g. "1"
    source_kind: str                # raw kind integer as string
    source_bank: str                # raw bank integer as string
    normalized_label: Optional[str] # e.g. "chorus"; None if unmapped
    start_beat: int                 # 1-based beat number
    end_beat: Optional[int]         # exclusive end beat; None if unknown
    start_ms: Optional[float]       # from beat grid; None if no beat grid
    end_ms: Optional[float]         # from beat grid; None if no beat grid
    fill_start_beat: Optional[int]  # from entry.beat_fill; None if no fill
    fill_start_ms: Optional[float]  # from beat grid; None if no fill or no grid
    source_flags: Dict[str, Any] = field(default_factory=dict)
    source_payload: Dict[str, Any] = field(default_factory=dict)


def extract_phrases(
    ext_asset: Optional[ParsedAnalysisAsset],
    beat_grid: Optional[BeatGridResult] = None,
) -> Tuple[List[PhraseEntry], List[AnalysisParseWarning]]:
    """
    Extract phrase segments from the PSSI tag in EXT asset.

    Beat grid is used to convert beat numbers to ms; pass None to skip
    ms derivation (start_ms and end_ms will be None).

    Returns (entries, warnings).
    """
    warnings: List[AnalysisParseWarning] = []

    if ext_asset is None:
        return [], warnings

    tag = get_first_tag(ext_asset, "PSSI")
    if tag is None:
        return [], warnings

    try:
        content = tag.content
        raw_entries = content.entries
        mood_int = int(content.mood)
        bank_int = int(content.bank)
        end_beat_total = int(content.end_beat)
    except AttributeError as exc:
        warnings.append(AnalysisParseWarning(
            code="PHRASE_PARSE_ERROR",
            asset_type=ext_asset.asset_type,
            message=f"PSSI tag missing required fields: {exc}",
        ))
        return [], warnings

    # Build beat-seq → ms lookup (beat seq is 1-based, matching PSSI beat values)
    beat_ms_map: Dict[int, float] = {}
    if beat_grid is not None:
        for b in beat_grid.beats:
            beat_ms_map[b.seq] = b.ms

    if mood_int not in _MOOD_LABELS:
        warnings.append(AnalysisParseWarning(
            code="PHRASE_UNKNOWN_MOOD",
            asset_type=ext_asset.asset_type,
            message=f"PSSI mood={mood_int} is not in known set [1,2,3]; normalized_label will be null",
        ))

    entries: List[PhraseEntry] = []
    raw_list = list(raw_entries)

    for idx, raw in enumerate(raw_list):
        try:
            start_beat = int(raw.beat)
            kind_int = int(raw.kind)
            fill = int(raw.fill)
            beat_fill = int(raw.beat_fill)
        except Exception as exc:
            warnings.append(AnalysisParseWarning(
                code="PHRASE_PARSE_ERROR",
                asset_type=ext_asset.asset_type,
                message=f"PSSI entry {idx} could not be read: {exc}",
            ))
            continue

        # End beat: next entry's start_beat, or tag.end_beat for the last phrase
        end_beat: Optional[int]
        if idx + 1 < len(raw_list):
            try:
                end_beat = int(raw_list[idx + 1].beat)
            except Exception:
                end_beat = None
        else:
            end_beat = end_beat_total if end_beat_total > 0 else None

        start_ms: Optional[float] = beat_ms_map.get(start_beat)
        end_ms: Optional[float] = beat_ms_map.get(end_beat) if end_beat is not None else None

        fill_start_beat: Optional[int] = int(beat_fill) if fill else None
        fill_start_ms: Optional[float] = (
            beat_ms_map.get(fill_start_beat) if fill_start_beat is not None else None
        )

        normalized_label = _map_kind_label(mood_int, kind_int)
        if normalized_label is None and mood_int in _MOOD_LABELS:
            warnings.append(AnalysisParseWarning(
                code="PHRASE_UNKNOWN_KIND",
                asset_type=ext_asset.asset_type,
                message=f"PSSI entry {idx}: mood={mood_int}, kind={kind_int} has no normalized label",
                detail=f"beat={start_beat}",
            ))

        source_flags: Dict[str, Any] = {
            "fill": bool(fill),
            "beat_fill": beat_fill if fill else None,
        }
        try:
            source_flags.update({
                "k1": int(raw.k1),
                "k2": int(raw.k2),
                "k3": int(raw.k3),
                "b": int(raw.b),
            })
        except AttributeError:
            pass

        source_payload: Dict[str, Any] = {
            "index": idx,
            "mood": mood_int,
            "bank": bank_int,
            "kind": kind_int,
            "beat": start_beat,
        }
        try:
            source_payload.update({
                "beat_2": int(raw.beat_2),
                "beat_3": int(raw.beat_3),
                "beat_4": int(raw.beat_4),
            })
        except AttributeError:
            pass

        entries.append(PhraseEntry(
            phrase_index=idx,
            source_mood=str(mood_int),
            source_kind=str(kind_int),
            source_bank=str(bank_int),
            normalized_label=normalized_label,
            start_beat=start_beat,
            end_beat=end_beat,
            start_ms=start_ms,
            end_ms=end_ms,
            fill_start_beat=fill_start_beat,
            fill_start_ms=fill_start_ms,
            source_flags=source_flags,
            source_payload=source_payload,
        ))

    return entries, warnings
