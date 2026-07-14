"""
Waveform extraction from PWV4/PWAV/PWV2 (preview) and PWV5/PWV3 (detail) tags.

Preview waveform source priority (stored as JSONB columns array):
  1. PWV4 from EXT — color preview (preferred)
  2. PWAV from DAT — monochrome preview
  3. PWV2 from DAT — tiny monochrome preview (last resort)

Detail waveform source priority (serialized to Storage):
  1. PWV5 from EXT — color detail (preferred)
  2. PWV3 from EXT — monochrome detail

Rules
-----
- Preserve source column count exactly.  Do not upscale or pad columns.
- Clamp and validate color channels; do not recolor to a DropDex palette.
- Preserve Rekordbox-derived source values (values computed by pyrekordbox get()).
- 2EX PWV6/PWV7/PWVC tags are intentionally not decoded here.
"""

from __future__ import annotations

import gzip
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .analysis_models import AnalysisParseWarning, ParsedAnalysisAsset
from .anlz_parser import get_first_tag

logger = logging.getLogger(__name__)


@dataclass
class PreviewWaveformResult:
    """Preview waveform stored as JSONB (rekordbox_track_waveforms.preview_columns)."""
    format: str         # "PWV4" | "PWAV" | "PWV2"
    column_count: int
    # Each element: {"h": int, "r": int, "g": int, "b": int} for PWV4
    #               {"h": int, "i": int}                     for PWAV/PWV2
    columns: List[Dict[str, Any]]
    source_tag: str
    warnings: List[AnalysisParseWarning] = field(default_factory=list)


@dataclass
class DetailWaveformResult:
    """Detail waveform serialized to gzip-compressed JSON for Supabase Storage."""
    format: str         # "PWV5" | "PWV3"
    column_count: int
    compressed_bytes: bytes
    source_tag: str
    warnings: List[AnalysisParseWarning] = field(default_factory=list)


@dataclass
class WaveformBundle:
    """Result of waveform extraction for one track."""
    preview: Optional[PreviewWaveformResult]
    detail: Optional[DetailWaveformResult]
    warnings: List[AnalysisParseWarning] = field(default_factory=list)


def extract_waveforms(
    dat_asset: Optional[ParsedAnalysisAsset],
    ext_asset: Optional[ParsedAnalysisAsset],
) -> WaveformBundle:
    """
    Extract preview and detail waveforms from a track's ANLZ files.

    Preview: PWV4 (EXT) > PWAV (DAT) > PWV2 (DAT).
    Detail:  PWV5 (EXT) > PWV3 (EXT).
    """
    all_warnings: List[AnalysisParseWarning] = []
    preview: Optional[PreviewWaveformResult] = None
    detail: Optional[DetailWaveformResult] = None

    # ── Preview ───────────────────────────────────────────────────────────────
    if ext_asset is not None:
        tag = get_first_tag(ext_asset, "PWV4")
        if tag is not None:
            preview, warns = _extract_pwv4(tag, ext_asset)
            all_warnings.extend(warns)

    if preview is None and dat_asset is not None:
        for code in ("PWAV", "PWV2"):
            tag = get_first_tag(dat_asset, code)
            if tag is not None:
                preview, warns = _extract_pwav_style(tag, dat_asset, code)
                all_warnings.extend(warns)
                if preview is not None:
                    break

    # ── Detail ────────────────────────────────────────────────────────────────
    if ext_asset is not None:
        tag = get_first_tag(ext_asset, "PWV5")
        if tag is not None:
            detail, warns = _extract_pwv5(tag, ext_asset)
            all_warnings.extend(warns)

    if detail is None and ext_asset is not None:
        tag = get_first_tag(ext_asset, "PWV3")
        if tag is not None:
            detail, warns = _extract_pwv3(tag, ext_asset)
            all_warnings.extend(warns)

    return WaveformBundle(preview=preview, detail=detail, warnings=all_warnings)


def _clamp_u8(v: float) -> int:
    return int(max(0.0, min(255.0, round(v))))


def _extract_pwv4(
    tag: Any, asset: ParsedAnalysisAsset
) -> Tuple[Optional[PreviewWaveformResult], List[AnalysisParseWarning]]:
    """
    Decode PWV4 color preview waveform (6 bytes per column).

    d0 = unknown
    d1 = luminance factor (0-255)
    d2 = blue-inverse   (& 0x7F, 0-127)
    d3 = red channel    (& 0x7F, 0-127)
    d4 = green channel  (& 0x7F, 0-127)
    d5 = blue+height    (& 0x7F, 0-127)

    Front color: [d3, d4, d5] * (d1 / 127); front height: d5.
    """
    warnings: List[AnalysisParseWarning] = []
    try:
        n = int(tag.content.len_entries)
        data: bytes = tag.content.entries
    except AttributeError as exc:
        warnings.append(AnalysisParseWarning(
            code="WAVEFORM_PARSE_ERROR",
            asset_type=asset.asset_type,
            message=f"PWV4 tag missing required fields: {exc}",
        ))
        return None, warnings

    if len(data) < n * 6:
        warnings.append(AnalysisParseWarning(
            code="WAVEFORM_TRUNCATED",
            asset_type=asset.asset_type,
            message=f"PWV4 data is {len(data)} bytes; expected {n * 6}",
        ))
        n = len(data) // 6

    columns: List[Dict[str, Any]] = []
    for x in range(n):
        d1 = data[x * 6 + 1]
        d3 = data[x * 6 + 3] & 0x7F
        d4 = data[x * 6 + 4] & 0x7F
        d5 = data[x * 6 + 5] & 0x7F
        scale = d1 / 127.0
        columns.append({
            "h": int(d5),
            "r": _clamp_u8(d3 * scale),
            "g": _clamp_u8(d4 * scale),
            "b": _clamp_u8(d5 * scale),
        })

    result = PreviewWaveformResult(
        format="PWV4",
        column_count=len(columns),
        columns=columns,
        source_tag="PWV4",
        warnings=warnings,
    )
    return result, warnings


def _extract_pwav_style(
    tag: Any, asset: ParsedAnalysisAsset, tag_code: str
) -> Tuple[Optional[PreviewWaveformResult], List[AnalysisParseWarning]]:
    """
    Decode PWAV or PWV2 monochrome preview waveform (1 byte per column).

    bits [4:0] = height    (0-31)
    bits [7:5] = intensity (0-7)
    """
    warnings: List[AnalysisParseWarning] = []
    try:
        entries = tag.content.entries
    except AttributeError as exc:
        warnings.append(AnalysisParseWarning(
            code="WAVEFORM_PARSE_ERROR",
            asset_type=asset.asset_type,
            message=f"{tag_code} tag missing content.entries: {exc}",
        ))
        return None, warnings

    columns: List[Dict[str, Any]] = []
    for byte_val in entries:
        bv = int(byte_val)
        columns.append({
            "h": bv & 0x1F,
            "i": bv >> 5,
        })

    result = PreviewWaveformResult(
        format=tag_code,
        column_count=len(columns),
        columns=columns,
        source_tag=tag_code,
        warnings=warnings,
    )
    return result, warnings


def _extract_pwv5(
    tag: Any, asset: ParsedAnalysisAsset
) -> Tuple[Optional[DetailWaveformResult], List[AnalysisParseWarning]]:
    """
    Decode PWV5 color detail waveform (1 Int16ub per column).

    bits [15:13] red    — 3-bit channel, expanded to [0,255]
    bits [12:10] green  — 3-bit channel, expanded to [0,255]
    bits  [9: 7] blue   — 3-bit channel, expanded to [0,255]
    bits  [6: 2] height — raw [0,31], normalized exactly once by the renderer
    """
    warnings: List[AnalysisParseWarning] = []
    try:
        declared_count = int(tag.content.len_entries)
        entries = list(tag.content.entries)
    except AttributeError as exc:
        warnings.append(AnalysisParseWarning(
            code="WAVEFORM_PARSE_ERROR",
            asset_type=asset.asset_type,
            message=f"PWV5 tag missing required fields: {exc}",
        ))
        return None, warnings

    actual_count = len(entries)
    if actual_count != declared_count:
        warnings.append(AnalysisParseWarning(
            code="WAVEFORM_COUNT_MISMATCH",
            asset_type=asset.asset_type,
            message=(
                f"PWV5 declared {declared_count} entries but contained {actual_count}; "
                f"using {min(declared_count, actual_count)}"
            ),
        ))
    entries = entries[:max(0, min(declared_count, actual_count))]

    columns: List[Dict[str, Any]] = []
    for val in entries:
        v = int(val)
        r3 = (v & 0xE000) >> 13
        g3 = (v & 0x1C00) >> 10
        b3 = (v & 0x0380) >> 7
        h_raw = (v & 0x007C) >> 2
        columns.append({
            "h": h_raw,
            "r": _clamp_u8(r3 * 255.0 / 7.0),
            "g": _clamp_u8(g3 * 255.0 / 7.0),
            "b": _clamp_u8(b3 * 255.0 / 7.0),
        })

    payload = {
        "version": 2,
        "format": "PWV5",
        "column_count": len(columns),
        "columns": columns,
    }
    compressed = gzip.compress(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    result = DetailWaveformResult(
        format="PWV5",
        column_count=len(columns),
        compressed_bytes=compressed,
        source_tag="PWV5",
        warnings=warnings,
    )
    return result, warnings


def _extract_pwv3(
    tag: Any, asset: ParsedAnalysisAsset
) -> Tuple[Optional[DetailWaveformResult], List[AnalysisParseWarning]]:
    """
    Decode PWV3 monochrome detail waveform (1 byte per column).

    Same byte layout as PWAV/PWV2: bits[4:0]=height, bits[7:5]=intensity.
    """
    warnings: List[AnalysisParseWarning] = []
    try:
        entries = tag.content.entries
    except AttributeError as exc:
        warnings.append(AnalysisParseWarning(
            code="WAVEFORM_PARSE_ERROR",
            asset_type=asset.asset_type,
            message=f"PWV3 tag missing content.entries: {exc}",
        ))
        return None, warnings

    columns: List[Dict[str, Any]] = []
    for byte_val in entries:
        bv = int(byte_val)
        columns.append({
            "h": bv & 0x1F,
            "i": bv >> 5,
        })

    payload = {
        "version": 1,
        "format": "PWV3",
        "column_count": len(columns),
        "columns": columns,
    }
    compressed = gzip.compress(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    result = DetailWaveformResult(
        format="PWV3",
        column_count=len(columns),
        compressed_bytes=compressed,
        source_tag="PWV3",
        warnings=warnings,
    )
    return result, warnings
