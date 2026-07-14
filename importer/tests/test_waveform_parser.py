"""
Tests for importer/dropdex_importer/waveform_parser.py
"""

from __future__ import annotations

import gzip
import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from dropdex_importer.waveform_parser import (
    _clamp_u8,
    _extract_pwav_style,
    _extract_pwv3,
    _extract_pwv4,
    _extract_pwv5,
    extract_waveforms,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_asset(asset_type: str = "DAT") -> Any:
    asset = MagicMock()
    asset.asset_type = asset_type
    return asset


def _pwv4_tag(n: int, raw_bytes: bytes) -> Any:
    tag = MagicMock()
    tag.content.len_entries = n
    tag.content.entries = raw_bytes
    return tag


def _pwav_tag(entries: list[int]) -> Any:
    tag = MagicMock()
    tag.content.entries = entries
    return tag


def _pwv5_tag(entries: list[int]) -> Any:
    tag = MagicMock()
    tag.content.len_entries = len(entries)
    tag.content.entries = entries
    return tag


def _pwv3_tag(entries: list[int]) -> Any:
    tag = MagicMock()
    tag.content.entries = entries
    return tag


# ── PWV4 decoding ─────────────────────────────────────────────────────────────

class TestPwv4Extraction:
    def test_column_count(self):
        # 2 columns = 12 bytes
        data = bytes([0, 127, 60, 30, 80, 100] * 2)
        tag = _pwv4_tag(2, data)
        result, _ = _extract_pwv4(tag, _make_asset("EXT"))

        assert result is not None
        assert result.column_count == 2
        assert result.format == "PWV4"

    def test_height_is_d5(self):
        # d5 = 50 (index 5)
        data = bytes([0, 127, 0, 0, 0, 50])
        tag = _pwv4_tag(1, data)
        result, _ = _extract_pwv4(tag, _make_asset("EXT"))

        assert result is not None
        assert result.columns[0]["h"] == 50

    def test_color_scaled_by_luminance(self):
        # d1=127 (full scale), d3=100, d4=80, d5=60
        data = bytes([0, 127, 0, 100, 80, 60])
        tag = _pwv4_tag(1, data)
        result, _ = _extract_pwv4(tag, _make_asset("EXT"))

        assert result is not None
        col = result.columns[0]
        assert col["r"] == 100  # 100 * (127/127) = 100
        assert col["g"] == 80
        assert col["b"] == 60

    def test_luminance_zero_gives_black(self):
        # d1=0 (zero scale): all color values → 0
        data = bytes([0, 0, 0, 127, 127, 127])
        tag = _pwv4_tag(1, data)
        result, _ = _extract_pwv4(tag, _make_asset("EXT"))

        assert result is not None
        col = result.columns[0]
        assert col["r"] == 0
        assert col["g"] == 0
        assert col["b"] == 0

    def test_color_channels_masked_0x7f(self):
        # d3 = 0xFF; with mask 0x7F → 127
        data = bytes([0, 127, 0, 0xFF, 0, 0])
        tag = _pwv4_tag(1, data)
        result, _ = _extract_pwv4(tag, _make_asset("EXT"))

        assert result is not None
        # 127 * (127/127) = 127
        assert result.columns[0]["r"] == 127

    def test_clamping_prevents_overflow(self):
        # d1=255, d5=127: 127 * (255/127) ≈ 254; still within [0,255]
        data = bytes([0, 255, 0, 127, 127, 127])
        tag = _pwv4_tag(1, data)
        result, _ = _extract_pwv4(tag, _make_asset("EXT"))

        assert result is not None
        assert 0 <= result.columns[0]["r"] <= 255

    def test_truncated_data_emits_warning(self):
        # Claim 3 columns but only 1 column of bytes
        data = bytes([0, 127, 0, 100, 80, 60])
        tag = _pwv4_tag(3, data)
        _, warnings = _extract_pwv4(tag, _make_asset("EXT"))

        codes = [w.code for w in warnings]
        assert "WAVEFORM_TRUNCATED" in codes

    def test_missing_fields_emits_error(self):
        tag = MagicMock()
        del tag.content
        tag.content = SimpleNamespace()
        _, warnings = _extract_pwv4(tag, _make_asset("EXT"))

        codes = [w.code for w in warnings]
        assert "WAVEFORM_PARSE_ERROR" in codes

    def test_column_dict_keys_for_color(self):
        data = bytes([0, 127, 0, 50, 60, 70])
        tag = _pwv4_tag(1, data)
        result, _ = _extract_pwv4(tag, _make_asset("EXT"))

        assert result is not None
        assert set(result.columns[0].keys()) == {"h", "r", "g", "b"}


# ── PWAV / PWV2 decoding ──────────────────────────────────────────────────────

class TestPwavExtraction:
    def test_height_from_low_5_bits(self):
        # byte = 0b00010101 = 21; height = bits [4:0] = 0b10101 = 21
        tag = _pwav_tag([0b00010101])
        result, _ = _extract_pwav_style(tag, _make_asset("DAT"), "PWAV")

        assert result is not None
        assert result.columns[0]["h"] == 21

    def test_intensity_from_high_3_bits(self):
        # byte = 0b11100000 = 224; intensity = bits [7:5] = 0b111 = 7
        tag = _pwav_tag([0b11100000])
        result, _ = _extract_pwav_style(tag, _make_asset("DAT"), "PWAV")

        assert result is not None
        assert result.columns[0]["i"] == 7

    def test_column_count(self):
        tag = _pwav_tag([0, 1, 2, 3, 4])
        result, _ = _extract_pwav_style(tag, _make_asset("DAT"), "PWAV")

        assert result is not None
        assert result.column_count == 5

    def test_format_tag_preserved(self):
        tag = _pwav_tag([0])
        result, _ = _extract_pwav_style(tag, _make_asset("DAT"), "PWV2")

        assert result is not None
        assert result.format == "PWV2"

    def test_column_dict_keys_for_mono(self):
        tag = _pwav_tag([0b01010111])
        result, _ = _extract_pwav_style(tag, _make_asset("DAT"), "PWAV")

        assert result is not None
        assert set(result.columns[0].keys()) == {"h", "i"}

    def test_missing_entries_emits_error(self):
        tag = MagicMock()
        tag.content = SimpleNamespace()
        _, warnings = _extract_pwav_style(tag, _make_asset("DAT"), "PWAV")

        codes = [w.code for w in warnings]
        assert "WAVEFORM_PARSE_ERROR" in codes


# ── PWV5 decoding ─────────────────────────────────────────────────────────────

class TestPwv5Extraction:
    def _val(self, r: int, g: int, b: int, h: int) -> int:
        # Pack 3-bit RGB channels and a 5-bit raw height into one 16-bit value.
        return (r << 13) | (g << 10) | (b << 7) | (h << 2)

    def _columns(self, result) -> list:
        payload = json.loads(gzip.decompress(result.compressed_bytes))
        return payload["columns"]

    def test_height_preserved_as_raw_5_bit_value(self):
        val = self._val(0, 0, 0, 31)
        tag = _pwv5_tag([val])
        result, _ = _extract_pwv5(tag, _make_asset("EXT"))

        assert result is not None
        assert self._columns(result)[0]["h"] == 31

    def test_height_zero(self):
        val = self._val(0, 0, 0, 0)
        tag = _pwv5_tag([val])
        result, _ = _extract_pwv5(tag, _make_asset("EXT"))

        assert result is not None
        assert self._columns(result)[0]["h"] == 0

    def test_column_count(self):
        vals = [self._val(0, 0, 0, 0)] * 5
        tag = _pwv5_tag(vals)
        result, _ = _extract_pwv5(tag, _make_asset("EXT"))

        assert result is not None
        assert result.column_count == 5

    def test_format_is_pwv5(self):
        tag = _pwv5_tag([0])
        result, _ = _extract_pwv5(tag, _make_asset("EXT"))

        assert result is not None
        assert result.format == "PWV5"

    def test_compressed_bytes_is_valid_gzip(self):
        tag = _pwv5_tag([0, 1, 2])
        result, _ = _extract_pwv5(tag, _make_asset("EXT"))

        assert result is not None
        decompressed = gzip.decompress(result.compressed_bytes)
        payload = json.loads(decompressed)
        assert payload["format"] == "PWV5"
        assert payload["version"] == 2
        assert len(payload["columns"]) == 3

    def test_column_dict_keys(self):
        tag = _pwv5_tag([0])
        result, _ = _extract_pwv5(tag, _make_asset("EXT"))

        assert result is not None
        cols = self._columns(result)
        assert set(cols[0].keys()) == {"h", "r", "g", "b"}


    def test_rgb_channels_expand_to_full_byte_range(self):
        tag = _pwv5_tag([self._val(7, 7, 7, 1)])
        result, _ = _extract_pwv5(tag, _make_asset("EXT"))

        assert result is not None
        col = self._columns(result)[0]
        assert col["r"] == 255
        assert col["g"] == 255
        assert col["b"] == 255

    def test_declared_count_mismatch_warns_and_clamps(self):
        tag = _pwv5_tag([0, 0, 0])
        tag.content.len_entries = 2
        result, warnings = _extract_pwv5(tag, _make_asset("EXT"))

        assert result is not None
        assert result.column_count == 2
        assert "WAVEFORM_COUNT_MISMATCH" in [warning.code for warning in warnings]

    def test_missing_fields_emits_error(self):
        tag = MagicMock()
        tag.content = SimpleNamespace()
        _, warnings = _extract_pwv5(tag, _make_asset("EXT"))

        codes = [w.code for w in warnings]
        assert "WAVEFORM_PARSE_ERROR" in codes


# ── PWV3 decoding ─────────────────────────────────────────────────────────────

class TestPwv3Extraction:
    def _columns(self, result) -> list:
        return json.loads(gzip.decompress(result.compressed_bytes))["columns"]

    def test_basic_decoding(self):
        # byte = 0b10110101 = 0xB5; height = 0x15 = 21, intensity = 0b101 = 5
        tag = _pwv3_tag([0b10110101])
        result, _ = _extract_pwv3(tag, _make_asset("EXT"))

        assert result is not None
        cols = self._columns(result)
        assert cols[0]["h"] == 0b10101  # 21
        assert cols[0]["i"] == 0b101    # 5

    def test_format_is_pwv3(self):
        tag = _pwv3_tag([0])
        result, _ = _extract_pwv3(tag, _make_asset("EXT"))

        assert result is not None
        assert result.format == "PWV3"

    def test_gzip_payload(self):
        tag = _pwv3_tag([10, 20, 30])
        result, _ = _extract_pwv3(tag, _make_asset("EXT"))

        assert result is not None
        decompressed = gzip.decompress(result.compressed_bytes)
        payload = json.loads(decompressed)
        assert payload["format"] == "PWV3"
        assert len(payload["columns"]) == 3


# ── Priority order ────────────────────────────────────────────────────────────

class TestWaveformPriority:
    def test_pwv4_preferred_over_pwav(self):
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")

        pwv4_tag = _pwv4_tag(1, bytes([0, 127, 0, 50, 60, 70]))
        pwav_tag = _pwav_tag([0b01010111])

        def side_effect(asset, code):
            if asset is ext and code == "PWV4":
                return pwv4_tag
            if asset is dat and code == "PWAV":
                return pwav_tag
            return None

        with patch("dropdex_importer.waveform_parser.get_first_tag", side_effect=side_effect):
            bundle = extract_waveforms(dat, ext)

        assert bundle.preview is not None
        assert bundle.preview.format == "PWV4"

    def test_falls_back_to_pwav_when_no_pwv4(self):
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pwav_tag = _pwav_tag([0b01010111])

        def side_effect(asset, code):
            if asset is dat and code == "PWAV":
                return pwav_tag
            return None

        with patch("dropdex_importer.waveform_parser.get_first_tag", side_effect=side_effect):
            bundle = extract_waveforms(dat, ext)

        assert bundle.preview is not None
        assert bundle.preview.format == "PWAV"

    def test_pwv5_preferred_over_pwv3(self):
        ext = _make_asset("EXT")
        pwv5_tag = _pwv5_tag([0])
        pwv3_tag = _pwv3_tag([0])

        def side_effect(asset, code):
            if asset is ext and code == "PWV5":
                return pwv5_tag
            if asset is ext and code == "PWV3":
                return pwv3_tag
            return None

        with patch("dropdex_importer.waveform_parser.get_first_tag", side_effect=side_effect):
            bundle = extract_waveforms(None, ext)

        assert bundle.detail is not None
        assert bundle.detail.format == "PWV5"

    def test_no_tags_returns_empty_bundle(self):
        with patch("dropdex_importer.waveform_parser.get_first_tag", return_value=None):
            bundle = extract_waveforms(_make_asset(), _make_asset())

        assert bundle.preview is None
        assert bundle.detail is None

    def test_clamp_u8_boundary(self):
        assert _clamp_u8(-1.0) == 0
        assert _clamp_u8(256.0) == 255
        assert _clamp_u8(127.5) == 128
        assert _clamp_u8(0.0) == 0
