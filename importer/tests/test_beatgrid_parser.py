"""
Tests for importer/dropdex_importer/beatgrid_parser.py
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from dropdex_importer.beatgrid_parser import (
    BeatEntry,
    BeatGridResult,
    _BPM_VARIABLE_THRESHOLD,
    _build_summary,
    _from_pqt2,
    _from_pqtz,
    extract_beat_grid,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _make_asset(asset_type: str = "DAT", *, has_file: bool = True) -> Any:
    asset = MagicMock()
    asset.asset_type = asset_type
    if not has_file:
        asset._anlz_file = None
    return asset


def _make_pqtz_tag(entries: list[tuple[int, int, int]]) -> Any:
    """Create a mock PQTZ tag.  entries = [(beat_in_bar, tempo_x100, time_ms), ...]"""
    raw_entries = []
    for beat, tempo, time in entries:
        e = SimpleNamespace(beat=beat, tempo=tempo, time=time)
        raw_entries.append(e)
    tag = MagicMock()
    tag.content.entries = raw_entries
    return tag


def _make_pqt2_tag(
    ref_tempo: int, ref_time: int, entries: list[int]
) -> Any:
    """Create a mock PQT2 tag.  entries = [beat_in_bar, ...]"""
    ref = SimpleNamespace(beat=1, tempo=ref_tempo, time=ref_time)
    raw_entries = [SimpleNamespace(beat=b, unkown=0) for b in entries]
    tag = MagicMock()
    tag.content.bpm = [ref, ref]
    tag.content.entries = raw_entries
    return tag


# ── PQTZ extraction ───────────────────────────────────────────────────────────

class TestPqtzExtraction:
    def _asset(self):
        return _make_asset("DAT")

    def test_basic_4beat_bar(self):
        entries = [(1, 12800, 0), (2, 12800, 469), (3, 12800, 938), (4, 12800, 1406)]
        tag = _make_pqtz_tag(entries)
        result = _from_pqtz(tag, self._asset())

        assert result.beat_count == 4
        assert result.downbeat_count == 1
        assert result.bar_count == 1
        assert result.source_tag == "PQTZ"
        assert result.beats[0].is_downbeat is True
        assert result.beats[1].is_downbeat is False
        assert result.beats[0].bar == 1
        assert result.beats[1].bar == 1

    def test_seq_numbers_are_1_based(self):
        entries = [(1, 12800, 0), (2, 12800, 469)]
        tag = _make_pqtz_tag(entries)
        result = _from_pqtz(tag, self._asset())

        assert result.beats[0].seq == 1
        assert result.beats[1].seq == 2

    def test_src_idx_is_0_based(self):
        entries = [(1, 12800, 0), (2, 12800, 469)]
        tag = _make_pqtz_tag(entries)
        result = _from_pqtz(tag, self._asset())

        assert result.beats[0].src_idx == 0
        assert result.beats[1].src_idx == 1

    def test_bpm_computed_from_tempo_field(self):
        tag = _make_pqtz_tag([(1, 12800, 0)])
        result = _from_pqtz(tag, self._asset())

        assert result.beats[0].bpm == pytest.approx(128.0)

    def test_ms_preserved_exactly(self):
        tag = _make_pqtz_tag([(1, 12800, 1234)])
        result = _from_pqtz(tag, self._asset())

        assert result.beats[0].ms == 1234.0

    def test_bar_increments_on_downbeat(self):
        entries = [
            (1, 12800, 0), (2, 12800, 469), (3, 12800, 938), (4, 12800, 1406),
            (1, 12800, 1875), (2, 12800, 2344),
        ]
        tag = _make_pqtz_tag(entries)
        result = _from_pqtz(tag, self._asset())

        assert result.beats[0].bar == 1
        assert result.beats[3].bar == 1
        assert result.beats[4].bar == 2
        assert result.beats[5].bar == 2
        assert result.bar_count == 2

    def test_pre_downbeat_beats_get_bar_0(self):
        entries = [(2, 12800, 0), (3, 12800, 469), (1, 12800, 938)]
        tag = _make_pqtz_tag(entries)
        result = _from_pqtz(tag, self._asset())

        assert result.beats[0].bar == 0
        assert result.beats[1].bar == 0
        assert result.beats[2].bar == 1

    def test_downbeat_count(self):
        entries = [
            (1, 12800, 0), (2, 12800, 469), (3, 12800, 938), (4, 12800, 1406),
            (1, 12800, 1875), (2, 12800, 2344), (3, 12800, 2813), (4, 12800, 3281),
        ]
        tag = _make_pqtz_tag(entries)
        result = _from_pqtz(tag, self._asset())

        assert result.downbeat_count == 2
        assert result.bar_count == 2

    def test_first_beat_ms(self):
        entries = [(1, 12800, 500), (2, 12800, 969)]
        tag = _make_pqtz_tag(entries)
        result = _from_pqtz(tag, self._asset())

        assert result.first_beat_ms == 500.0

    def test_first_downbeat_ms_skips_pre_downbeats(self):
        entries = [(2, 12800, 0), (1, 12800, 469)]
        tag = _make_pqtz_tag(entries)
        result = _from_pqtz(tag, self._asset())

        assert result.first_downbeat_ms == 469.0
        assert result.first_beat_ms == 0.0

    def test_bpm_range_and_variable_tempo(self):
        # BPMs differ by > 1.0
        entries = [(1, 12800, 0), (1, 13000, 469)]
        tag = _make_pqtz_tag(entries)
        result = _from_pqtz(tag, self._asset())

        assert result.minimum_bpm == pytest.approx(128.0)
        assert result.maximum_bpm == pytest.approx(130.0)
        assert result.is_variable_tempo is True

    def test_constant_tempo_not_variable(self):
        entries = [(1, 12800, 0), (2, 12800, 469), (3, 12800, 938)]
        tag = _make_pqtz_tag(entries)
        result = _from_pqtz(tag, self._asset())

        assert result.is_variable_tempo is False

    def test_invalid_beat_in_bar_clamped_with_warning(self):
        entries = [(0, 12800, 0), (5, 12800, 469)]
        tag = _make_pqtz_tag(entries)
        result = _from_pqtz(tag, self._asset())

        codes = [w.code for w in result.warnings]
        assert "BEAT_INVALID" in codes
        # Clamped values remain in [1,4]
        assert all(1 <= b.beat_in_bar <= 4 for b in result.beats)

    def test_nonpositive_bpm_emits_warning(self):
        tag = _make_pqtz_tag([(1, 0, 0)])
        result = _from_pqtz(tag, self._asset())

        codes = [w.code for w in result.warnings]
        assert "BEAT_INVALID_BPM" in codes

    def test_missing_entries_returns_empty(self):
        tag = MagicMock()
        del tag.content.entries
        tag.content = SimpleNamespace()  # no .entries attribute
        result = _from_pqtz(tag, self._asset())

        assert result.beat_count == 0
        assert any(w.code == "BEAT_PARSE_ERROR" for w in result.warnings)

    def test_empty_entries(self):
        tag = _make_pqtz_tag([])
        result = _from_pqtz(tag, self._asset())

        assert result.beat_count == 0
        assert result.beat_count == 0
        assert result.first_beat_ms is None
        assert result.first_downbeat_ms is None
        assert result.minimum_bpm is None
        assert result.maximum_bpm is None

    def test_as_dict_keys(self):
        tag = _make_pqtz_tag([(1, 12800, 0)])
        result = _from_pqtz(tag, self._asset())

        d = result.beats[0].as_dict()
        assert set(d.keys()) == {"seq", "srcIdx", "beatInBar", "bar", "ms", "bpm", "isDownbeat"}


# ── PQT2 extraction ───────────────────────────────────────────────────────────

class TestPqt2Extraction:
    def _asset(self):
        return _make_asset("EXT")

    def test_computed_timing_warning_always_emitted(self):
        tag = _make_pqt2_tag(12800, 0, [1, 2, 3, 4])
        result = _from_pqt2(tag, self._asset())

        codes = [w.code for w in result.warnings]
        assert "BEAT_COMPUTED_TIMING" in codes

    def test_source_tag_is_pqt2(self):
        tag = _make_pqt2_tag(12800, 0, [1, 2, 3, 4])
        result = _from_pqt2(tag, self._asset())

        assert result.source_tag == "PQT2"

    def test_beat_count_from_entries(self):
        tag = _make_pqt2_tag(12800, 0, [1, 2, 3, 4, 1, 2, 3, 4])
        result = _from_pqt2(tag, self._asset())

        assert result.beat_count == 8

    def test_timing_computed_from_reference_bpm(self):
        bpm = 120.0
        start_ms = 100.0
        tag = _make_pqt2_tag(int(bpm * 100), int(start_ms), [1, 2])
        result = _from_pqt2(tag, self._asset())

        ms_per_beat = 60000.0 / bpm
        assert result.beats[0].ms == pytest.approx(start_ms)
        assert result.beats[1].ms == pytest.approx(start_ms + ms_per_beat)

    def test_downbeat_derived_from_beat_in_bar(self):
        tag = _make_pqt2_tag(12800, 0, [1, 2, 3, 4])
        result = _from_pqt2(tag, self._asset())

        assert result.beats[0].is_downbeat is True
        assert result.beats[1].is_downbeat is False

    def test_no_reference_emits_warning(self):
        tag = MagicMock()
        tag.content.bpm = []
        tag.content.entries = []
        result = _from_pqt2(tag, self._asset())

        codes = [w.code for w in result.warnings]
        assert "PQT2_NO_REFERENCE" in codes
        assert result.beat_count == 0

    def test_zero_bpm_emits_warning(self):
        tag = _make_pqt2_tag(0, 0, [1, 2])
        result = _from_pqt2(tag, self._asset())

        codes = [w.code for w in result.warnings]
        assert "PQT2_INVALID_BPM" in codes
        assert result.beat_count == 0


# ── extract_beat_grid preference ─────────────────────────────────────────────

class TestExtractBeatGridPreference:
    def test_prefers_pqtz_over_pqt2(self):
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pqtz_tag = _make_pqtz_tag([(1, 12800, 0)])
        pqt2_tag = _make_pqt2_tag(12800, 0, [1, 2, 3])

        with (
            patch("dropdex_importer.beatgrid_parser.get_first_tag") as mock_get,
        ):
            def side_effect(asset, code):
                if asset is dat and code == "PQTZ":
                    return pqtz_tag
                if asset is ext and code == "PQT2":
                    return pqt2_tag
                return None

            mock_get.side_effect = side_effect
            result = extract_beat_grid(dat, ext)

        assert result is not None
        assert result.source_tag == "PQTZ"

    def test_falls_back_to_pqt2_when_no_pqtz(self):
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pqt2_tag = _make_pqt2_tag(12800, 0, [1, 2, 3])

        with patch("dropdex_importer.beatgrid_parser.get_first_tag") as mock_get:
            def side_effect(asset, code):
                if asset is ext and code == "PQT2":
                    return pqt2_tag
                return None

            mock_get.side_effect = side_effect
            result = extract_beat_grid(dat, ext)

        assert result is not None
        assert result.source_tag == "PQT2"

    def test_returns_none_when_no_tags(self):
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")

        with patch("dropdex_importer.beatgrid_parser.get_first_tag", return_value=None):
            result = extract_beat_grid(dat, ext)

        assert result is None

    def test_returns_none_when_both_assets_none(self):
        result = extract_beat_grid(None, None)
        assert result is None

    def test_works_with_only_dat(self):
        dat = _make_asset("DAT")
        tag = _make_pqtz_tag([(1, 12800, 0)])

        with patch("dropdex_importer.beatgrid_parser.get_first_tag") as mock_get:
            mock_get.side_effect = lambda a, c: tag if a is dat and c == "PQTZ" else None
            result = extract_beat_grid(dat, None)

        assert result is not None
        assert result.source_tag == "PQTZ"
