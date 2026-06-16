"""
Cue point extraction from ANLZ PCOB and PCO2 tags.

Preference order:
  PCO2 from EXT — carries color, comment, beat loop ratios (preferred)
  PCOB from DAT — basic timing, type, hot-cue slot (fallback)
  PCOB from EXT — checked last if neither PCO2 nor DAT PCOB is available

Reconciliation rules
--------------------
- PCO2 and PCOB represent the same cue in different formats.
  Do NOT treat the same cue from both tags as two separate cues.
- Match DB cue to ANLZ by hot_cue_slot (for hot cues) AND start timing (±10 ms).
- Memory cues match by timing only (they have no fixed slot).
- Do not match by array index alone.
- Color resolution: explicit PCO2 RGB → color_id table → null.
- Do not derive colors from cue slot letters.
- hot_cue == 0  → memory cue (cue_family='memory', hot_cue_slot=None)
- hot_cue 1..8  → hot cue  (cue_family='hot',    hot_cue_slot=1..8)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .analysis_models import AnalysisParseWarning, ParsedAnalysisAsset
from .anlz_parser import get_first_tag

logger = logging.getLogger(__name__)

# Maximum ms difference for matching an ANLZ cue to an existing DB cue row.
CUE_MATCH_TOLERANCE_MS = 10.0

# Rekordbox color_id → CSS hex color string.
# ID 0 = no color; IDs 1–8 are the fixed cue colors in the Rekordbox UI.
_COLOR_TABLE: Dict[int, Optional[str]] = {
    0: None,
    1: "#FF007F",   # pink
    2: "#FF0000",   # red
    3: "#FF8000",   # orange
    4: "#FFFF00",   # yellow
    5: "#00FF00",   # green
    6: "#00FFFF",   # aqua
    7: "#0000FF",   # blue
    8: "#8000FF",   # purple
}


@dataclass
class AnlzCueEntry:
    """
    One cue point extracted from ANLZ PCOB or PCO2 data.

    This model is intentionally flat so it can be used directly for
    DB reconciliation without further parsing.
    """
    source_index: int               # 0-based index in source tag entry list
    source_tag: str                 # "PCO2" | "PCOB"
    hot_cue_slot: Optional[int]     # None for memory cues, 1–8 for hot cue slots
    cue_family: str                 # "hot" | "memory"
    point_type: str                 # "cue" | "loop"
    start_ms: float                 # milliseconds
    end_ms: Optional[float]         # loop end ms; None for cue points
    color_hex: Optional[str]        # e.g. "#FF0000"; None when no color
    color_id: Optional[int]         # Rekordbox color table index (PCO2 only)
    comment: Optional[str]          # PCO2 only
    is_active_loop: bool
    beat_loop_numerator: Optional[int]
    beat_loop_denominator: Optional[int]
    source_payload: Dict[str, Any] = field(default_factory=dict)


def parse_anlz_cues(
    dat_asset: Optional[ParsedAnalysisAsset],
    ext_asset: Optional[ParsedAnalysisAsset],
) -> Tuple[List[AnlzCueEntry], List[AnalysisParseWarning]]:
    """
    Extract cue entries from ANLZ data, preferring PCO2 (EXT) over PCOB.

    Returns (entries, warnings).
    """
    warnings: List[AnalysisParseWarning] = []

    if ext_asset is not None:
        tag = get_first_tag(ext_asset, "PCO2")
        if tag is not None:
            entries, w = _parse_pco2(tag, ext_asset)
            warnings.extend(w)
            return entries, warnings

    if dat_asset is not None:
        tag = get_first_tag(dat_asset, "PCOB")
        if tag is not None:
            entries, w = _parse_pcob(tag, dat_asset)
            warnings.extend(w)
            return entries, warnings

    # Last resort: PCOB from EXT
    if ext_asset is not None:
        tag = get_first_tag(ext_asset, "PCOB")
        if tag is not None:
            entries, w = _parse_pcob(tag, ext_asset)
            warnings.extend(w)
            return entries, warnings

    return [], warnings


def _classify_cue_family(hot_cue: int) -> Tuple[str, Optional[int]]:
    """Return (cue_family, hot_cue_slot) from the hot_cue field value."""
    if hot_cue == 0:
        return "memory", None
    return "hot", int(hot_cue)


def _resolve_pco2_color(entry: Any) -> Optional[str]:
    """
    Resolve color from a PCO2 AnlzCuePoint2 entry.

    Order: explicit RGB (any channel non-zero) → color_id table → None.
    """
    try:
        r = int(entry.color_red)
        g = int(entry.color_green)
        b = int(entry.color_blue)
        if r != 0 or g != 0 or b != 0:
            return f"#{r:02X}{g:02X}{b:02X}"
    except AttributeError:
        pass

    try:
        color_id = int(entry.color_id)
        return _COLOR_TABLE.get(color_id)
    except (AttributeError, TypeError):
        pass

    return None


def _loop_end_ms(entry: Any) -> Optional[float]:
    """Return loop end ms, or None when the field signals 'not a loop'.

    Rekordbox uses 4294967295 (0xFFFFFFFF, -1 as uint32) to signal no loop.
    """
    try:
        v = int(entry.loop_time)
        if v < 0 or v == 0xFFFFFFFF:
            return None
        return float(v)
    except (AttributeError, TypeError):
        return None


def _parse_pco2(
    tag: Any, asset: ParsedAnalysisAsset
) -> Tuple[List[AnlzCueEntry], List[AnalysisParseWarning]]:
    """Parse a PCO2 tag into AnlzCueEntry objects."""
    warnings: List[AnalysisParseWarning] = []

    try:
        entries_raw = tag.content.entries
    except AttributeError as exc:
        warnings.append(AnalysisParseWarning(
            code="CUE_PARSE_ERROR",
            asset_type=asset.asset_type,
            message=f"PCO2 tag missing content.entries: {exc}",
        ))
        return [], warnings

    entries: List[AnlzCueEntry] = []
    for src_idx, raw in enumerate(entries_raw):
        try:
            hot_cue = int(raw.hot_cue)
            start_ms = float(raw.time)
            point_type_raw = int(raw.type)
        except Exception as exc:
            warnings.append(AnalysisParseWarning(
                code="CUE_PARSE_ERROR",
                asset_type=asset.asset_type,
                message=f"PCO2 entry {src_idx} could not be read: {exc}",
            ))
            continue

        cue_family, slot = _classify_cue_family(hot_cue)
        point_type = "loop" if point_type_raw == 2 else "cue"
        end_ms = _loop_end_ms(raw) if point_type == "loop" else None

        color_hex = _resolve_pco2_color(raw)
        try:
            color_id: Optional[int] = int(raw.color_id)
        except AttributeError:
            color_id = None

        try:
            comment_raw = raw.comment
            comment: Optional[str] = str(comment_raw).strip("\x00") if comment_raw else None
        except AttributeError:
            comment = None

        try:
            loop_num: Optional[int] = int(raw.loop_enumerator)
            loop_den: Optional[int] = int(raw.loop_denominator)
        except (AttributeError, TypeError):
            loop_num = loop_den = None

        source_payload: Dict[str, Any] = {
            "tag": "PCO2",
            "src_idx": src_idx,
            "hot_cue": hot_cue,
            "type": point_type_raw,
            "color_id": color_id,
        }
        try:
            source_payload["time"] = int(raw.time)
            source_payload["loop_time"] = int(raw.loop_time)
        except AttributeError:
            pass

        entries.append(AnlzCueEntry(
            source_index=src_idx,
            source_tag="PCO2",
            hot_cue_slot=slot,
            cue_family=cue_family,
            point_type=point_type,
            start_ms=start_ms,
            end_ms=end_ms,
            color_hex=color_hex,
            color_id=color_id,
            comment=comment,
            is_active_loop=point_type == "loop" and end_ms is not None,
            beat_loop_numerator=loop_num,
            beat_loop_denominator=loop_den,
            source_payload=source_payload,
        ))

    return entries, warnings


def _parse_pcob(
    tag: Any, asset: ParsedAnalysisAsset
) -> Tuple[List[AnlzCueEntry], List[AnalysisParseWarning]]:
    """Parse a PCOB tag into AnlzCueEntry objects."""
    warnings: List[AnalysisParseWarning] = []

    try:
        entries_raw = tag.content.entries
    except AttributeError as exc:
        warnings.append(AnalysisParseWarning(
            code="CUE_PARSE_ERROR",
            asset_type=asset.asset_type,
            message=f"PCOB tag missing content.entries: {exc}",
        ))
        return [], warnings

    entries: List[AnlzCueEntry] = []
    for src_idx, raw in enumerate(entries_raw):
        try:
            hot_cue = int(raw.hot_cue)
            start_ms = float(raw.time)
        except Exception as exc:
            warnings.append(AnalysisParseWarning(
                code="CUE_PARSE_ERROR",
                asset_type=asset.asset_type,
                message=f"PCOB entry {src_idx} could not be read: {exc}",
            ))
            continue

        cue_family, slot = _classify_cue_family(hot_cue)

        # PCOB entry.type is a pyrekordbox enum; convert via string
        try:
            type_str = str(raw.type).lower()
            point_type = "loop" if "loop" in type_str else "cue"
        except AttributeError:
            point_type = "cue"

        end_ms = _loop_end_ms(raw) if point_type == "loop" else None

        source_payload: Dict[str, Any] = {
            "tag": "PCOB",
            "src_idx": src_idx,
            "hot_cue": hot_cue,
        }
        try:
            source_payload["type"] = str(raw.type)
            source_payload["time"] = int(raw.time)
            source_payload["loop_time"] = int(raw.loop_time)
        except AttributeError:
            pass

        entries.append(AnlzCueEntry(
            source_index=src_idx,
            source_tag="PCOB",
            hot_cue_slot=slot,
            cue_family=cue_family,
            point_type=point_type,
            start_ms=start_ms,
            end_ms=end_ms,
            color_hex=None,
            color_id=None,
            comment=None,
            is_active_loop=point_type == "loop" and end_ms is not None,
            beat_loop_numerator=None,
            beat_loop_denominator=None,
            source_payload=source_payload,
        ))

    return entries, warnings
