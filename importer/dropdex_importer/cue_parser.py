"""
Cue point extraction from ANLZ PCOB and PCO2 tags.

Hot Cue source priority:
  1. All PCO2 tags from EXT — explicit slot, richer metadata (preferred)
  2. Fallback: PCOB Hot Cue entries from DAT + EXT combined by explicit slot

Memory Cue source:
  Base: ALL PCOB tags from DAT (hot_cue == 0 entries)
  Enrichment: PCO2 Memory entries from EXT replace PCOB when the whole list
              agrees exactly on count, start_ms, point_type, and end_ms.
              On any conflict → PCOB entries are kept and a warning is emitted.

Design rules
------------
- Use get_all_tags() — never get_first_tag() — so every PCOB/PCO2 tag is read.
- DAT files carry two PCOB tags: tag[0] = Hot Cue list, tag[1] = Memory Cue list.
- hot_cue == 0  → memory cue (cue_family='memory', hot_cue_slot=None)
- hot_cue 1..8  → hot cue  (cue_family='hot',    hot_cue_slot=1..8)
- Timestamp is cue content, not cue identity.  Two cues at the same start_ms
  are distinct objects and must not be collapsed.
- rekordbox_cue_id remains null for all ANLZ-derived cues (no fabrication).
- Color resolution: explicit PCO2 RGB → color_id table → null.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .analysis_models import AnalysisParseWarning, ParsedAnalysisAsset
from .anlz_parser import get_all_tags

logger = logging.getLogger(__name__)

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
    persistence without further parsing.
    """
    source_index: int               # 0-based entry index within source tag
    source_tag: str                 # "PCO2" | "PCOB"
    asset_type: str                 # "DAT" | "EXT" | "unknown"
    tag_occurrence: int             # 0-based tag-instance index within the file
    hot_cue_slot: Optional[int]     # None for memory cues, 1–8 for hot cue slots
    cue_family: str                 # "hot" | "memory"
    point_type: str                 # "cue" | "loop"
    start_ms: float                 # milliseconds
    end_ms: Optional[float]         # loop end ms; None for cue points
    color_hex: Optional[str]        # e.g. "#FF0000"; None when no color
    color_id: Optional[int]         # Rekordbox color table index (PCO2 only)
    comment: Optional[str]          # PCO2 only
    # ANLZ PCOB/PCO2 proves loop presence/extent, not local DjmdCue.ActiveLoop.
    is_active_loop: Optional[bool]
    beat_loop_numerator: Optional[int]
    beat_loop_denominator: Optional[int]
    source_payload: Dict[str, Any] = field(default_factory=dict)


def parse_anlz_cues(
    dat_asset: Optional[ParsedAnalysisAsset],
    ext_asset: Optional[ParsedAnalysisAsset],
) -> Tuple[List[AnlzCueEntry], List[AnalysisParseWarning]]:
    """
    Extract all cue entries from ANLZ data with correct hot/memory separation.

    Hot Cue source priority:
      1. All PCO2 tags from EXT (preferred — explicit slot, richer metadata).
      2. Fallback: PCOB Hot Cue entries from DAT + EXT combined by explicit slot.

    Memory Cue source:
      All PCOB tags from DAT → entries with hot_cue == 0.
      PCO2 Memory from EXT replaces PCOB when the whole list agrees exactly.

    Returns (entries, warnings).
    """
    warnings: List[AnalysisParseWarning] = []

    # ── Parse all PCO2 tags from EXT ─────────────────────────────────────────
    pco2_entries: List[AnlzCueEntry] = []
    if ext_asset is not None:
        for tag_occ, tag in enumerate(get_all_tags(ext_asset, "PCO2")):
            entries, w = _parse_pco2(tag, ext_asset, asset_type="EXT", tag_occurrence=tag_occ)
            pco2_entries.extend(entries)
            warnings.extend(w)

    pco2_hot = [e for e in pco2_entries if e.cue_family == "hot"]
    pco2_memory = [e for e in pco2_entries if e.cue_family == "memory"]

    # ── Parse all PCOB tags from DAT ─────────────────────────────────────────
    dat_pcob_all: List[AnlzCueEntry] = []
    if dat_asset is not None:
        for tag_occ, tag in enumerate(get_all_tags(dat_asset, "PCOB")):
            entries, w = _parse_pcob(tag, dat_asset, asset_type="DAT", tag_occurrence=tag_occ)
            dat_pcob_all.extend(entries)
            warnings.extend(w)

    # ── Parse all PCOB tags from EXT (for hot-cue fallback slots) ────────────
    ext_pcob_all: List[AnlzCueEntry] = []
    if ext_asset is not None:
        for tag_occ, tag in enumerate(get_all_tags(ext_asset, "PCOB")):
            entries, w = _parse_pcob(tag, ext_asset, asset_type="EXT", tag_occurrence=tag_occ)
            ext_pcob_all.extend(entries)
            warnings.extend(w)

    # ── Select canonical hot cues ─────────────────────────────────────────────
    dat_hot = [e for e in dat_pcob_all if e.cue_family == "hot"]
    ext_hot = [e for e in ext_pcob_all if e.cue_family == "hot"]
    pcob_hot_combined = _merge_pcob_hot_by_slot(dat_hot, ext_hot)

    if pco2_hot:
        canonical_hot, hot_conflict = _validate_and_merge_pco2_hot(
            pco2_hot, pcob_hot_combined, warnings
        )
        if hot_conflict:
            canonical_hot = []
    else:
        canonical_hot = pcob_hot_combined
        hot_conflict = False

    # ── Select canonical memory cues ──────────────────────────────────────────
    pcob_memory = [e for e in dat_pcob_all if e.cue_family == "memory"]
    canonical_memory = _select_memory_cues(pcob_memory, pco2_memory, warnings)

    return canonical_hot + canonical_memory, warnings


# ── Internal helpers ──────────────────────────────────────────────────────────


def _classify_cue_family(hot_cue: int) -> Tuple[str, Optional[int]]:
    """Return (cue_family, hot_cue_slot) from the hot_cue field value."""
    if hot_cue == 0:
        return "memory", None
    return "hot", int(hot_cue)


def _merge_pcob_hot_by_slot(
    dat_hot: List[AnlzCueEntry],
    ext_hot: List[AnlzCueEntry],
) -> List[AnlzCueEntry]:
    """
    Combine DAT and EXT PCOB hot cue entries by explicit slot.

    When the same slot appears in both sources, DAT takes precedence.
    EXT contributes any slots that DAT does not have (e.g. D-H when DAT only has A-C).
    """
    by_slot: Dict[int, AnlzCueEntry] = {}
    for entry in ext_hot:
        if entry.hot_cue_slot is not None:
            by_slot[entry.hot_cue_slot] = entry
    for entry in dat_hot:
        if entry.hot_cue_slot is not None:
            by_slot[entry.hot_cue_slot] = entry
    return sorted(by_slot.values(), key=lambda e: e.hot_cue_slot or 0)


def _validate_and_merge_pco2_hot(
    pco2_hot: List[AnlzCueEntry],
    pcob_hot_combined: List[AnlzCueEntry],
    warnings: List[AnalysisParseWarning],
) -> Tuple[List[AnlzCueEntry], bool]:
    """
    Validate PCO2 Hot Cue entries against PCOB evidence and produce the canonical list.

    Rules:
    - For slots present in BOTH PCO2 and PCOB: compare start_ms, point_type, end_ms exactly
      (no tolerance). If any common slot disagrees: emit CUE_HOT_PCO2_CONFLICT warning,
      return ([], True).
    - For slots that agree on common entries: PCO2 entries are used (richer metadata).
      PCOB-only slots (e.g. D-H absent from PCO2) are appended from PCOB.
    - If no PCOB evidence: PCO2 is canonical as-is (no validation possible).

    Returns (canonical_hot_entries, had_conflict).
    """
    if not pcob_hot_combined:
        return pco2_hot, False

    pco2_by_slot: Dict[int, AnlzCueEntry] = {
        e.hot_cue_slot: e for e in pco2_hot if e.hot_cue_slot is not None
    }
    pcob_by_slot: Dict[int, AnlzCueEntry] = {
        e.hot_cue_slot: e for e in pcob_hot_combined if e.hot_cue_slot is not None
    }

    common_slots = set(pco2_by_slot) & set(pcob_by_slot)
    for slot in sorted(common_slots):
        p2 = pco2_by_slot[slot]
        pb = pcob_by_slot[slot]
        if p2.start_ms != pb.start_ms or p2.point_type != pb.point_type or p2.end_ms != pb.end_ms:
            warnings.append(AnalysisParseWarning(
                code="CUE_HOT_PCO2_CONFLICT",
                asset_type="EXT",
                message=(
                    f"PCO2 Hot Cue slot {slot} conflicts with PCOB on position/type "
                    f"(PCO2 start={p2.start_ms} type={p2.point_type}, "
                    f"PCOB start={pb.start_ms} type={pb.point_type}); "
                    "failing Hot Cue family closed."
                ),
            ))
            return [], True

    # Common slots agree — use PCO2 entries; add any PCOB-only slots
    result = list(pco2_hot)
    for slot, pcob_entry in pcob_by_slot.items():
        if slot not in pco2_by_slot:
            result.append(pcob_entry)
    return sorted(result, key=lambda e: e.hot_cue_slot or 0), False


def _memory_lists_agree(
    pcob: List[AnlzCueEntry],
    pco2: List[AnlzCueEntry],
) -> bool:
    """
    Return True when PCO2 and PCOB memory lists agree on the whole-list level.

    Agreement requires: same count, same start_ms, same point_type, same end_ms
    for every pair when both lists are sorted by start_ms.
    No per-entry tolerance — exact positional match only.
    """
    if len(pcob) != len(pco2):
        return False
    for p_pcob, p_pco2 in zip(
        sorted(pcob, key=lambda e: e.start_ms),
        sorted(pco2, key=lambda e: e.start_ms),
    ):
        if p_pcob.start_ms != p_pco2.start_ms:
            return False
        if p_pcob.point_type != p_pco2.point_type:
            return False
        if p_pcob.end_ms != p_pco2.end_ms:
            return False
    return True


def _select_memory_cues(
    pcob_memory: List[AnlzCueEntry],
    pco2_memory: List[AnlzCueEntry],
    warnings: List[AnalysisParseWarning],
) -> List[AnlzCueEntry]:
    """
    Return the canonical memory cue list.

    Base source: PCOB memory entries from DAT.
    If PCO2 memory is non-empty and the whole-list agrees exactly with PCOB,
    use PCO2 entries for richer metadata (comment, color).
    On any conflict: emit a warning and keep PCOB.
    """
    if not pco2_memory:
        return pcob_memory
    if not pcob_memory:
        # No PCOB memory baseline; PCO2 memory is the only source — use it.
        return pco2_memory
    if not _memory_lists_agree(pcob_memory, pco2_memory):
        warnings.append(AnalysisParseWarning(
            code="CUE_MEMORY_CONFLICT",
            asset_type="EXT",
            message=(
                "PCO2 and PCOB Memory Cue lists differ; "
                "using PCOB entries as safe fallback."
            ),
        ))
        return pcob_memory
    return pco2_memory


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
    tag: Any,
    asset: ParsedAnalysisAsset,
    *,
    asset_type: str = "unknown",
    tag_occurrence: int = 0,
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
            "asset_type": asset_type,
            "tag_occurrence": tag_occurrence,
            "src_idx": src_idx,
            "hot_cue": hot_cue,
            "cue_family": cue_family,
            "type": point_type_raw,
            "color_id": color_id,
        }
        try:
            source_payload["time"] = int(raw.time)
            source_payload["loop_time"] = int(raw.loop_time)
        except AttributeError:
            pass
        try:
            source_payload["color_red"] = int(raw.color_red)
            source_payload["color_green"] = int(raw.color_green)
            source_payload["color_blue"] = int(raw.color_blue)
        except AttributeError:
            pass
        if comment:
            source_payload["comment"] = comment
        if loop_num is not None:
            source_payload["loop_enumerator"] = loop_num
        if loop_den is not None:
            source_payload["loop_denominator"] = loop_den

        entries.append(AnlzCueEntry(
            source_index=src_idx,
            source_tag="PCO2",
            asset_type=asset_type,
            tag_occurrence=tag_occurrence,
            hot_cue_slot=slot,
            cue_family=cue_family,
            point_type=point_type,
            start_ms=start_ms,
            end_ms=end_ms,
            color_hex=color_hex,
            color_id=color_id,
            comment=comment,
            is_active_loop=None,
            beat_loop_numerator=loop_num,
            beat_loop_denominator=loop_den,
            source_payload=source_payload,
        ))

    return entries, warnings


def _parse_pcob(
    tag: Any,
    asset: ParsedAnalysisAsset,
    *,
    asset_type: str = "unknown",
    tag_occurrence: int = 0,
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
            "asset_type": asset_type,
            "tag_occurrence": tag_occurrence,
            "src_idx": src_idx,
            "hot_cue": hot_cue,
            "cue_family": cue_family,
        }
        try:
            source_payload["type"] = str(raw.type)
            source_payload["time"] = int(raw.time)
            source_payload["loop_time"] = int(raw.loop_time)
        except AttributeError:
            pass
        try:
            source_payload["status"] = int(raw.status)
        except AttributeError:
            pass
        try:
            source_payload["order"] = int(raw.order)
        except AttributeError:
            pass

        entries.append(AnlzCueEntry(
            source_index=src_idx,
            source_tag="PCOB",
            asset_type=asset_type,
            tag_occurrence=tag_occurrence,
            hot_cue_slot=slot,
            cue_family=cue_family,
            point_type=point_type,
            start_ms=start_ms,
            end_ms=end_ms,
            color_hex=None,
            color_id=None,
            comment=None,
            is_active_loop=None,
            beat_loop_numerator=None,
            beat_loop_denominator=None,
            source_payload=source_payload,
        ))

    return entries, warnings
