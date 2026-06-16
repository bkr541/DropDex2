"""
Beat grid extraction from PQTZ (DAT) and PQT2 (EXT) tags.

PQTZ is the preferred source: each entry carries source timing (ms), local BPM,
and beat-in-bar.  PQT2 is a compact representation that stores only 2 reference
anchor ticks and per-beat beat-in-bar values; timing is computed from anchors
rather than stored per-beat — a warning is always emitted when PQT2 is used.

Rules
-----
- Prefer PQTZ from DAT.  Fall back to PQT2 from EXT.
- Do not regenerate timing from average BPM.
- Preserve source beat-in-bar, sequence index, and ms exactly.
- Derive isDownbeat from beat_in_bar == 1; do not infer from timing gaps.
- Validate: beats out-of-range [1,4] or non-positive BPM emit a warning.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .analysis_models import AnalysisParseWarning, ParsedAnalysisAsset
from .anlz_parser import get_first_tag

logger = logging.getLogger(__name__)

# BPM difference that triggers is_variable_tempo=True
_BPM_VARIABLE_THRESHOLD = 1.0


@dataclass
class BeatEntry:
    """One beat in the normalized beat grid."""
    seq: int            # 1-based sequence number
    src_idx: int        # 0-based index in source array
    beat_in_bar: int    # 1–4 (source beat-in-bar marker)
    bar: int            # 1-based bar number; 0 for beats before first downbeat
    ms: float           # position in milliseconds
    bpm: float          # local BPM at this beat
    is_downbeat: bool   # True when beat_in_bar == 1

    def as_dict(self) -> Dict[str, Any]:
        return {
            "seq": self.seq,
            "srcIdx": self.src_idx,
            "beatInBar": self.beat_in_bar,
            "bar": self.bar,
            "ms": self.ms,
            "bpm": self.bpm,
            "isDownbeat": self.is_downbeat,
        }


@dataclass
class BeatGridResult:
    """Result of beat grid extraction for one track."""
    beats: List[BeatEntry]
    beat_count: int
    downbeat_count: int
    bar_count: int
    first_beat_ms: Optional[float]
    first_downbeat_ms: Optional[float]
    minimum_bpm: Optional[float]
    maximum_bpm: Optional[float]
    is_variable_tempo: bool
    source_tag: str             # "PQTZ" | "PQT2"
    warnings: List[AnalysisParseWarning] = field(default_factory=list)


def extract_beat_grid(
    dat_asset: Optional[ParsedAnalysisAsset],
    ext_asset: Optional[ParsedAnalysisAsset],
) -> Optional[BeatGridResult]:
    """
    Extract a beat grid from a track's ANLZ files.

    Tries PQTZ (DAT) first, then PQT2 (EXT) as fallback.
    Returns None when no beat grid tag is available.
    """
    if dat_asset is not None:
        tag = get_first_tag(dat_asset, "PQTZ")
        if tag is not None:
            return _from_pqtz(tag, dat_asset)

    if ext_asset is not None:
        tag = get_first_tag(ext_asset, "PQT2")
        if tag is not None:
            return _from_pqt2(tag, ext_asset)

    return None


def _build_summary(
    beats: List[BeatEntry],
    source_tag: str,
    warnings: List[AnalysisParseWarning],
) -> BeatGridResult:
    downbeats = [b for b in beats if b.is_downbeat]
    valid_bpms = [b.bpm for b in beats if b.bpm > 0]
    min_bpm = min(valid_bpms) if valid_bpms else None
    max_bpm = max(valid_bpms) if valid_bpms else None
    is_variable = (
        (max_bpm - min_bpm) > _BPM_VARIABLE_THRESHOLD
        if min_bpm is not None and max_bpm is not None
        else False
    )
    return BeatGridResult(
        beats=beats,
        beat_count=len(beats),
        downbeat_count=len(downbeats),
        bar_count=max((b.bar for b in beats), default=0),
        first_beat_ms=beats[0].ms if beats else None,
        first_downbeat_ms=downbeats[0].ms if downbeats else None,
        minimum_bpm=min_bpm,
        maximum_bpm=max_bpm,
        is_variable_tempo=is_variable,
        source_tag=source_tag,
        warnings=warnings,
    )


def _from_pqtz(tag: Any, asset: ParsedAnalysisAsset) -> BeatGridResult:
    """Extract beat grid from PQTZ tag.  All timing is source-stored per beat."""
    warnings: List[AnalysisParseWarning] = []
    beats: List[BeatEntry] = []
    bar = 0

    try:
        entries = tag.content.entries
    except AttributeError:
        warnings.append(AnalysisParseWarning(
            code="BEAT_PARSE_ERROR",
            asset_type=asset.asset_type,
            message="PQTZ tag is missing content.entries",
        ))
        return _build_summary([], "PQTZ", warnings)

    for src_idx, entry in enumerate(entries):
        try:
            beat_in_bar = int(entry.beat)
            bpm_raw = int(entry.tempo)
            ms = float(entry.time)
        except Exception as exc:
            warnings.append(AnalysisParseWarning(
                code="BEAT_PARSE_ERROR",
                asset_type=asset.asset_type,
                message=f"Beat entry {src_idx} could not be read: {exc}",
            ))
            continue

        bpm = bpm_raw / 100.0

        if not 1 <= beat_in_bar <= 4:
            warnings.append(AnalysisParseWarning(
                code="BEAT_INVALID",
                asset_type=asset.asset_type,
                message=f"Beat {src_idx}: beat_in_bar={beat_in_bar} is not in [1,4]; clamped",
            ))
            beat_in_bar = max(1, min(4, beat_in_bar))

        if bpm <= 0:
            warnings.append(AnalysisParseWarning(
                code="BEAT_INVALID_BPM",
                asset_type=asset.asset_type,
                message=f"Beat {src_idx}: BPM={bpm:.2f} is not positive",
            ))

        is_downbeat = beat_in_bar == 1
        if is_downbeat:
            bar += 1

        beats.append(BeatEntry(
            seq=src_idx + 1,
            src_idx=src_idx,
            beat_in_bar=beat_in_bar,
            bar=bar,
            ms=ms,
            bpm=bpm,
            is_downbeat=is_downbeat,
        ))

    return _build_summary(beats, "PQTZ", warnings)


def _from_pqt2(tag: Any, asset: ParsedAnalysisAsset) -> BeatGridResult:
    """
    Extract beat grid from PQT2 tag.

    PQT2 stores 2 reference anchor beats and per-beat beat-in-bar values;
    ms timing is computed from the reference BPM, not stored per-beat.
    A warning is always emitted to record the computed-timing nature.
    """
    warnings: List[AnalysisParseWarning] = [
        AnalysisParseWarning(
            code="BEAT_COMPUTED_TIMING",
            asset_type=asset.asset_type,
            message=(
                "PQT2 beat timing is computed from 2 reference anchors, "
                "not per-beat source data.  Timing is approximate for "
                "variable-tempo tracks."
            ),
        )
    ]

    try:
        ref_beats = tag.content.bpm
        entries = tag.content.entries
    except AttributeError as exc:
        warnings.append(AnalysisParseWarning(
            code="BEAT_PARSE_ERROR",
            asset_type=asset.asset_type,
            message=f"PQT2 tag is missing required fields: {exc}",
        ))
        return _build_summary([], "PQT2", warnings)

    if not ref_beats:
        warnings.append(AnalysisParseWarning(
            code="PQT2_NO_REFERENCE",
            asset_type=asset.asset_type,
            message="PQT2 tag has no reference anchor beats; cannot derive timing",
        ))
        return _build_summary([], "PQT2", warnings)

    try:
        ref0 = ref_beats[0]
        bpm = float(ref0.tempo) / 100.0
        start_ms = float(ref0.time)
    except Exception as exc:
        warnings.append(AnalysisParseWarning(
            code="PQT2_INVALID_REFERENCE",
            asset_type=asset.asset_type,
            message=f"PQT2 reference anchor could not be read: {exc}",
        ))
        return _build_summary([], "PQT2", warnings)

    if bpm <= 0:
        warnings.append(AnalysisParseWarning(
            code="PQT2_INVALID_BPM",
            asset_type=asset.asset_type,
            message=f"PQT2 reference BPM={bpm:.2f} is not positive; cannot compute timing",
        ))
        return _build_summary([], "PQT2", warnings)

    ms_per_beat = 60000.0 / bpm
    beats: List[BeatEntry] = []
    bar = 0

    for src_idx, entry in enumerate(entries):
        try:
            beat_in_bar = int(entry.beat)
        except Exception as exc:
            warnings.append(AnalysisParseWarning(
                code="BEAT_PARSE_ERROR",
                asset_type=asset.asset_type,
                message=f"PQT2 entry {src_idx} could not be read: {exc}",
            ))
            continue

        if not 1 <= beat_in_bar <= 4:
            warnings.append(AnalysisParseWarning(
                code="BEAT_INVALID",
                asset_type=asset.asset_type,
                message=f"PQT2 beat {src_idx}: beat_in_bar={beat_in_bar} not in [1,4]; clamped",
            ))
            beat_in_bar = max(1, min(4, beat_in_bar))

        is_downbeat = beat_in_bar == 1
        if is_downbeat:
            bar += 1

        ms = start_ms + src_idx * ms_per_beat
        beats.append(BeatEntry(
            seq=src_idx + 1,
            src_idx=src_idx,
            beat_in_bar=beat_in_bar,
            bar=bar,
            ms=ms,
            bpm=bpm,
            is_downbeat=is_downbeat,
        ))

    return _build_summary(beats, "PQT2", warnings)
