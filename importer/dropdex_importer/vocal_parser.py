"""Read-only parser for Rekordbox .2EX PVDI vocal-confidence analysis.

PVDI is optional enrichment.  This module deliberately does not depend on
pyrekordbox's tag registry because the DropDex-pinned pyrekordbox revision does
not expose PVDI.  It reads only the bounded PVDI tag body and returns a compact,
DropDex-owned representation suitable for persistence and Auto Cue input.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import mmap
import struct
from pathlib import Path
from typing import List, Optional

from .analysis_models import AnalysisParseWarning

DROPDEX_PVDI_PARSER_VERSION = "1.0.0"
PVDI_TAG_CODE = b"PVDI"
PVDI_HEADER_LENGTH = 24
PVDI_FRAME_DURATION_MS = 1024 / 22050 * 1000
PVDI_STRONG_THRESHOLD = 3
PVDI_POSITIVE_THRESHOLD = 0
PVDI_MAX_CONFIDENCE = 4
_ANLZ_SIGNATURE = b"PMAI"
_MIN_ANLZ_HEADER_LENGTH = 12
_MIN_TAG_HEADER_LENGTH = 12


@dataclass(frozen=True)
class VocalRegion:
    """One strong-onset vocal-confidence region derived from PVDI frames."""

    start_frame: int
    end_frame_exclusive: int
    start_ms: float
    end_ms: float
    duration_ms: float
    peak_confidence: int

    def as_dict(self) -> dict:
        return {
            "start_frame": self.start_frame,
            "end_frame_exclusive": self.end_frame_exclusive,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "duration_ms": self.duration_ms,
            "peak_confidence": self.peak_confidence,
        }


@dataclass
class VocalAnalysisResult:
    """Canonical PVDI evidence for one .2EX asset."""

    source_tag: str = "PVDI"
    source_header_length: Optional[int] = None
    source_u1: Optional[int] = None
    source_u2: Optional[int] = None
    frame_duration_ms: float = PVDI_FRAME_DURATION_MS
    frame_count: int = 0
    regions: List[VocalRegion] = field(default_factory=list)
    integrity_status: str = "invalid"  # valid | invalid | unsupported
    complete: bool = False
    warnings: List[AnalysisParseWarning] = field(default_factory=list)

    def warning_dicts(self) -> list[dict]:
        return [warning.as_dict() for warning in self.warnings]


def _warning(code: str, message: str, detail: Optional[str] = None) -> AnalysisParseWarning:
    return AnalysisParseWarning(
        code=code,
        asset_type="2EX",
        message=message,
        detail=detail,
    )


def _invalid(code: str, message: str, detail: Optional[str] = None) -> VocalAnalysisResult:
    return VocalAnalysisResult(
        integrity_status="invalid",
        complete=False,
        warnings=[_warning(code, message, detail)],
    )


def _regions_from_confidence(confidence: bytes) -> List[VocalRegion]:
    """Build DJCues-compatible strong-onset regions without retaining raw frames."""
    regions: List[VocalRegion] = []
    i = 0
    count = len(confidence)
    while i < count:
        if confidence[i] < PVDI_STRONG_THRESHOLD:
            i += 1
            continue
        start = i
        peak = confidence[i]
        i += 1
        while i < count and confidence[i] > PVDI_POSITIVE_THRESHOLD:
            peak = max(peak, confidence[i])
            i += 1
        end = i
        start_ms = start * PVDI_FRAME_DURATION_MS
        end_ms = end * PVDI_FRAME_DURATION_MS
        regions.append(VocalRegion(
            start_frame=start,
            end_frame_exclusive=end,
            start_ms=start_ms,
            end_ms=end_ms,
            duration_ms=end_ms - start_ms,
            peak_confidence=int(peak),
        ))
    return regions


def parse_pvdi_bytes(data: bytes | mmap.mmap) -> Optional[VocalAnalysisResult]:
    """Parse the first supported PVDI tag from an ANLZ container.

    ``None`` means a well-formed container was scanned completely and no PVDI
    tag exists.  Malformed/truncated containers return an invalid result so the
    caller can persist diagnostics while safely falling back.
    """
    if len(data) < _MIN_ANLZ_HEADER_LENGTH:
        return _invalid(
            "PVDI_CONTAINER_TRUNCATED",
            "The .2EX ANLZ container header is truncated.",
            f"readable_bytes={len(data)}",
        )
    if data[:4] != _ANLZ_SIGNATURE:
        return _invalid(
            "PVDI_CONTAINER_SIGNATURE",
            "The .2EX file does not begin with the PMAI ANLZ signature.",
            repr(data[:4]),
        )

    try:
        container_header_length = struct.unpack_from(">I", data, 4)[0]
        declared_file_length = struct.unpack_from(">I", data, 8)[0]
    except struct.error as exc:
        return _invalid("PVDI_CONTAINER_TRUNCATED", "The .2EX ANLZ header is truncated.", str(exc))

    if (
        container_header_length < _MIN_ANLZ_HEADER_LENGTH
        or container_header_length > len(data)
        or declared_file_length < container_header_length
    ):
        return _invalid(
            "PVDI_CONTAINER_LENGTH_INVALID",
            "The .2EX ANLZ container declares invalid header/file lengths.",
            f"header={container_header_length}, declared={declared_file_length}, readable={len(data)}",
        )

    container_complete = declared_file_length <= len(data)
    scan_end = min(declared_file_length, len(data))
    position = container_header_length
    found: Optional[VocalAnalysisResult] = None
    trailing_warnings: List[AnalysisParseWarning] = []

    while position < scan_end:
        if position + _MIN_TAG_HEADER_LENGTH > scan_end:
            return _invalid(
                "PVDI_TAG_HEADER_TRUNCATED",
                "The .2EX file ends inside an ANLZ tag header.",
                f"offset={position}, readable_end={scan_end}",
            )
        try:
            code = data[position : position + 4]
            tag_header_length = struct.unpack_from(">I", data, position + 4)[0]
            tag_length = struct.unpack_from(">I", data, position + 8)[0]
        except struct.error as exc:
            return _invalid("PVDI_TAG_HEADER_TRUNCATED", "An ANLZ tag header is truncated.", str(exc))

        if tag_header_length < _MIN_TAG_HEADER_LENGTH or tag_length < tag_header_length:
            return _invalid(
                "PVDI_TAG_LENGTH_INVALID",
                "An ANLZ tag declares invalid header/body lengths.",
                f"offset={position}, header={tag_header_length}, tag={tag_length}",
            )
        tag_end = position + tag_length
        if tag_end > scan_end:
            status = _invalid(
                "PVDI_TAG_TRUNCATED" if code == PVDI_TAG_CODE else "PVDI_CONTAINER_TRUNCATED",
                "The .2EX file ends before the declared ANLZ tag body is complete.",
                f"tag={code!r}, offset={position}, declared_end={tag_end}, readable_end={scan_end}",
            )
            if code == PVDI_TAG_CODE:
                status.source_header_length = tag_header_length
            return status

        if code == PVDI_TAG_CODE:
            if found is not None:
                trailing_warnings.append(_warning(
                    "PVDI_DUPLICATE_TAG",
                    "Multiple PVDI tags were found; the first supported tag is authoritative.",
                    f"duplicate_offset={position}",
                ))
                position = tag_end
                continue

            if tag_header_length != PVDI_HEADER_LENGTH:
                return VocalAnalysisResult(
                    source_header_length=tag_header_length,
                    integrity_status="unsupported",
                    complete=False,
                    warnings=[_warning(
                        "PVDI_UNSUPPORTED_HEADER",
                        "This PVDI tag header variant is not supported.",
                        f"header_length={tag_header_length}, supported={PVDI_HEADER_LENGTH}",
                    )],
                )

            try:
                source_u1, source_u2, confidence_length = struct.unpack_from(">III", data, position + 12)
            except struct.error as exc:
                return _invalid("PVDI_HEADER_TRUNCATED", "The PVDI-specific header is truncated.", str(exc))

            payload_length = tag_length - tag_header_length
            if confidence_length > payload_length:
                result = _invalid(
                    "PVDI_CONFIDENCE_TRUNCATED",
                    "PVDI confidence length exceeds the bounded tag payload.",
                    f"declared_confidence={confidence_length}, payload={payload_length}",
                )
                result.source_header_length = tag_header_length
                result.source_u1 = source_u1
                result.source_u2 = source_u2
                result.frame_count = confidence_length
                return result
            if confidence_length != payload_length:
                return VocalAnalysisResult(
                    source_header_length=tag_header_length,
                    source_u1=source_u1,
                    source_u2=source_u2,
                    frame_count=confidence_length,
                    integrity_status="unsupported",
                    complete=False,
                    warnings=[_warning(
                        "PVDI_UNSUPPORTED_PAYLOAD_LAYOUT",
                        "PVDI contains bytes outside the declared confidence vector.",
                        f"declared_confidence={confidence_length}, payload={payload_length}",
                    )],
                )

            payload_start = position + tag_header_length
            confidence = data[payload_start : payload_start + confidence_length]
            invalid_values = sorted({int(value) for value in confidence if value > PVDI_MAX_CONFIDENCE})
            if invalid_values:
                result = _invalid(
                    "PVDI_CONFIDENCE_RANGE",
                    "PVDI contains confidence values outside the supported 0-4 range.",
                    f"values={invalid_values[:8]}",
                )
                result.source_header_length = tag_header_length
                result.source_u1 = source_u1
                result.source_u2 = source_u2
                result.frame_count = confidence_length
                return result

            found = VocalAnalysisResult(
                source_header_length=tag_header_length,
                source_u1=source_u1,
                source_u2=source_u2,
                frame_count=confidence_length,
                regions=_regions_from_confidence(confidence),
                integrity_status="valid",
                complete=True,
            )

        position = tag_end

    if not container_complete:
        if found is not None:
            found.integrity_status = "invalid"
            found.complete = False
            found.warnings.append(_warning(
                "PVDI_CONTAINER_TRUNCATED",
                "The PVDI tag was readable, but the enclosing .2EX file is truncated.",
                f"declared={declared_file_length}, readable={len(data)}",
            ))
            return found
        return _invalid(
            "PVDI_CONTAINER_TRUNCATED",
            "The .2EX file is shorter than its declared ANLZ container length.",
            f"declared={declared_file_length}, readable={len(data)}",
        )

    if found is not None:
        found.warnings.extend(trailing_warnings)
    return found


def parse_pvdi_file(path: str | Path) -> Optional[VocalAnalysisResult]:
    """Read and parse one .2EX file without modifying it or copying the whole asset."""
    file_path = Path(path)
    try:
        with file_path.open("rb") as handle:
            if file_path.stat().st_size == 0:
                return parse_pvdi_bytes(b"")
            with mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as data:
                return parse_pvdi_bytes(data)
    except (OSError, ValueError) as exc:
        return _invalid("PVDI_READ_ERROR", "The optional .2EX file could not be read.", str(exc))
