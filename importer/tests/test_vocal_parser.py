from __future__ import annotations

import hashlib
import struct

import pytest

from dropdex_importer.vocal_parser import (
    PVDI_FRAME_DURATION_MS,
    PVDI_HEADER_LENGTH,
    parse_pvdi_bytes,
    parse_pvdi_file,
)


def _container(*tags: bytes, declared_extra: int = 0) -> bytes:
    body = b"".join(tags)
    readable_length = 28 + len(body)
    return (
        b"PMAI"
        + struct.pack(">I", 28)
        + struct.pack(">I", readable_length + declared_extra)
        + b"\x00" * 16
        + body
    )


def _generic_tag(code: bytes, payload: bytes = b"") -> bytes:
    return code + struct.pack(">II", 12, 12 + len(payload)) + payload


def _pvdi(
    confidence: bytes,
    *,
    u1: int = 0x400,
    u2: int = 0x56220001,
    confidence_length: int | None = None,
) -> bytes:
    declared = len(confidence) if confidence_length is None else confidence_length
    return struct.pack(">4sIIIII", b"PVDI", 24, 24 + len(confidence), u1, u2, declared) + confidence


def test_valid_pvdi_preserves_header_provenance_and_compact_regions():
    confidence = bytes([0] * 10 + [3, 2, 1] + [1] * 44 + [0, 0])
    result = parse_pvdi_bytes(_container(_generic_tag(b"PWV7", b"abc"), _pvdi(confidence)))

    assert result is not None
    assert result.integrity_status == "valid"
    assert result.complete is True
    assert result.source_header_length == PVDI_HEADER_LENGTH
    assert result.source_u1 == 0x400
    assert result.source_u2 == 0x56220001
    assert result.frame_count == len(confidence)
    assert len(result.regions) == 1
    region = result.regions[0]
    assert region.start_frame == 10
    assert region.end_frame_exclusive == 57
    assert region.peak_confidence == 3
    assert region.start_ms == pytest.approx(10 * PVDI_FRAME_DURATION_MS)
    assert region.duration_ms == pytest.approx(47 * PVDI_FRAME_DURATION_MS)
    # Raw confidence is intentionally not retained in the canonical result.
    assert not hasattr(result, "confidence")


def test_threshold_then_positive_decay_closes_on_first_zero():
    result = parse_pvdi_bytes(_container(_pvdi(bytes([1, 2, 3, 2, 1, 0, 4, 1, 0]))))
    assert result is not None
    assert [(r.start_frame, r.end_frame_exclusive) for r in result.regions] == [(2, 5), (6, 8)]


def test_absent_pvdi_returns_none_after_complete_scan():
    assert parse_pvdi_bytes(_container(_generic_tag(b"PWV6", b"abc"))) is None


def test_declared_confidence_cannot_escape_bounded_tag_payload():
    result = parse_pvdi_bytes(_container(_pvdi(bytes([3, 2, 1]), confidence_length=100)))
    assert result is not None
    assert result.integrity_status == "invalid"
    assert result.complete is False
    assert result.warnings[0].code == "PVDI_CONFIDENCE_TRUNCATED"


def test_unsupported_header_variant_falls_back_without_guessing_offsets():
    unsupported = struct.pack(">4sII", b"PVDI", 28, 28) + b"\x00" * 16
    result = parse_pvdi_bytes(_container(unsupported))
    assert result is not None
    assert result.integrity_status == "unsupported"
    assert result.complete is False
    assert result.warnings[0].code == "PVDI_UNSUPPORTED_HEADER"


def test_truncated_container_invalidates_even_a_readable_pvdi_tag():
    result = parse_pvdi_bytes(_container(_pvdi(bytes([3, 1, 0])), declared_extra=20))
    assert result is not None
    assert result.integrity_status == "invalid"
    assert result.complete is False
    assert any(w.code == "PVDI_CONTAINER_TRUNCATED" for w in result.warnings)


def test_out_of_range_confidence_is_diagnostic_not_vocal_evidence():
    result = parse_pvdi_bytes(_container(_pvdi(bytes([0, 3, 5, 0]))))
    assert result is not None
    assert result.integrity_status == "invalid"
    assert result.regions == []
    assert result.warnings[0].code == "PVDI_CONFIDENCE_RANGE"


def test_variable_length_payload_is_supported_and_parser_is_read_only(tmp_path):
    confidence = bytes(([0, 1, 2, 3, 4] * 747) + [0])  # 3736 frames, not a fixed-size fixture
    source = _container(_pvdi(confidence))
    path = tmp_path / "ANLZ0000.2EX"
    path.write_bytes(source)
    before_hash = hashlib.sha256(path.read_bytes()).hexdigest()

    result = parse_pvdi_file(path)

    assert result is not None
    assert result.integrity_status == "valid"
    assert result.frame_count == len(confidence)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before_hash
