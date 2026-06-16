"""
Tests for importer/dropdex_importer/cue_parser.py
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from dropdex_importer.cue_parser import (
    _COLOR_TABLE,
    CUE_MATCH_TOLERANCE_MS,
    AnlzCueEntry,
    _classify_cue_family,
    _loop_end_ms,
    _parse_pcob,
    _parse_pco2,
    _resolve_pco2_color,
    parse_anlz_cues,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_asset(asset_type: str = "DAT") -> Any:
    asset = MagicMock()
    asset.asset_type = asset_type
    return asset


def _pco2_entry(
    hot_cue: int = 0,
    time: int = 1000,
    type_: int = 1,
    loop_time: int = 0xFFFFFFFF,
    color_id: int = 0,
    color_red: int = 0,
    color_green: int = 0,
    color_blue: int = 0,
    comment: str = "",
    loop_enumerator: int = 1,
    loop_denominator: int = 1,
) -> SimpleNamespace:
    return SimpleNamespace(
        hot_cue=hot_cue,
        time=time,
        type=type_,
        loop_time=loop_time,
        color_id=color_id,
        color_red=color_red,
        color_green=color_green,
        color_blue=color_blue,
        comment=comment,
        loop_enumerator=loop_enumerator,
        loop_denominator=loop_denominator,
    )


def _pcob_entry(hot_cue: int = 0, time: int = 1000, type_str: str = "single", loop_time: int = 0xFFFFFFFF) -> SimpleNamespace:
    return SimpleNamespace(hot_cue=hot_cue, time=time, type=type_str, loop_time=loop_time)


def _pco2_tag(entries: list) -> Any:
    tag = MagicMock()
    tag.content.entries = entries
    return tag


def _pcob_tag(entries: list) -> Any:
    tag = MagicMock()
    tag.content.entries = entries
    return tag


# ── _classify_cue_family ──────────────────────────────────────────────────────

class TestClassifyCueFamily:
    def test_zero_is_memory(self):
        family, slot = _classify_cue_family(0)
        assert family == "memory"
        assert slot is None

    @pytest.mark.parametrize("slot", [1, 2, 3, 4, 5, 6, 7, 8])
    def test_nonzero_is_hot(self, slot):
        family, hot_slot = _classify_cue_family(slot)
        assert family == "hot"
        assert hot_slot == slot


# ── _loop_end_ms ──────────────────────────────────────────────────────────────

class TestLoopEndMs:
    def test_negative_loop_time_returns_none(self):
        entry = SimpleNamespace(loop_time=-1)
        assert _loop_end_ms(entry) is None

    def test_0xffffffff_returns_none(self):
        entry = SimpleNamespace(loop_time=0xFFFFFFFF)
        assert _loop_end_ms(entry) is None

    def test_valid_loop_time_returned(self):
        entry = SimpleNamespace(loop_time=5000)
        assert _loop_end_ms(entry) == pytest.approx(5000.0)

    def test_missing_attribute_returns_none(self):
        entry = SimpleNamespace()
        assert _loop_end_ms(entry) is None


# ── _resolve_pco2_color ───────────────────────────────────────────────────────

class TestResolvePco2Color:
    def test_explicit_rgb_takes_priority(self):
        entry = _pco2_entry(color_red=255, color_green=0, color_blue=0, color_id=2)
        assert _resolve_pco2_color(entry) == "#FF0000"

    def test_falls_back_to_color_table(self):
        entry = _pco2_entry(color_id=2)  # color_id=2 → red
        assert _resolve_pco2_color(entry) == _COLOR_TABLE[2]

    def test_color_id_0_returns_none(self):
        entry = _pco2_entry(color_id=0)
        assert _resolve_pco2_color(entry) is None

    def test_all_rgb_zero_uses_table(self):
        entry = _pco2_entry(color_red=0, color_green=0, color_blue=0, color_id=5)
        assert _resolve_pco2_color(entry) == _COLOR_TABLE[5]

    def test_unknown_color_id_returns_none(self):
        entry = _pco2_entry(color_id=99)
        assert _resolve_pco2_color(entry) is None

    def test_rgb_hex_format(self):
        entry = _pco2_entry(color_red=16, color_green=32, color_blue=48)
        assert _resolve_pco2_color(entry) == "#102030"


# ── PCO2 parsing ──────────────────────────────────────────────────────────────

class TestParsePco2:
    def test_memory_cue_classification(self):
        entry = _pco2_entry(hot_cue=0, time=500)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"))

        assert len(entries) == 1
        assert entries[0].cue_family == "memory"
        assert entries[0].hot_cue_slot is None

    def test_hot_cue_slot_assignment(self):
        entry = _pco2_entry(hot_cue=3, time=1000)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"))

        assert entries[0].cue_family == "hot"
        assert entries[0].hot_cue_slot == 3

    def test_point_type_cue(self):
        entry = _pco2_entry(type_=1)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"))

        assert entries[0].point_type == "cue"

    def test_point_type_loop(self):
        entry = _pco2_entry(type_=2, loop_time=3000)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"))

        assert entries[0].point_type == "loop"
        assert entries[0].end_ms == pytest.approx(3000.0)
        assert entries[0].is_active_loop is True

    def test_start_ms_from_time(self):
        entry = _pco2_entry(time=2345)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"))

        assert entries[0].start_ms == pytest.approx(2345.0)

    def test_comment_extracted(self):
        entry = _pco2_entry(comment="Drop here")
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"))

        assert entries[0].comment == "Drop here"

    def test_source_tag_is_pco2(self):
        tag = _pco2_tag([_pco2_entry()])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"))

        assert entries[0].source_tag == "PCO2"

    def test_source_index(self):
        entries_raw = [_pco2_entry(), _pco2_entry(time=2000)]
        tag = _pco2_tag(entries_raw)
        entries, _ = _parse_pco2(tag, _make_asset("EXT"))

        assert entries[0].source_index == 0
        assert entries[1].source_index == 1

    def test_missing_entries_emits_error(self):
        tag = MagicMock()
        tag.content = SimpleNamespace()
        _, warnings = _parse_pco2(tag, _make_asset("EXT"))

        codes = [w.code for w in warnings]
        assert "CUE_PARSE_ERROR" in codes

    def test_beat_loop_fields(self):
        entry = _pco2_entry(loop_enumerator=3, loop_denominator=4)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"))

        assert entries[0].beat_loop_numerator == 3
        assert entries[0].beat_loop_denominator == 4


# ── PCOB parsing ──────────────────────────────────────────────────────────────

class TestParsePcob:
    def test_basic_cue(self):
        entry = _pcob_entry(hot_cue=0, time=1000, type_str="single")
        tag = _pcob_tag([entry])
        entries, _ = _parse_pcob(tag, _make_asset("DAT"))

        assert len(entries) == 1
        assert entries[0].point_type == "cue"
        assert entries[0].cue_family == "memory"

    def test_loop_type_from_enum_string(self):
        entry = _pcob_entry(type_str="loop", loop_time=4000)
        tag = _pcob_tag([entry])
        entries, _ = _parse_pcob(tag, _make_asset("DAT"))

        assert entries[0].point_type == "loop"

    def test_no_color_in_pcob(self):
        tag = _pcob_tag([_pcob_entry()])
        entries, _ = _parse_pcob(tag, _make_asset("DAT"))

        assert entries[0].color_hex is None
        assert entries[0].color_id is None

    def test_no_comment_in_pcob(self):
        tag = _pcob_tag([_pcob_entry()])
        entries, _ = _parse_pcob(tag, _make_asset("DAT"))

        assert entries[0].comment is None

    def test_source_tag_is_pcob(self):
        tag = _pcob_tag([_pcob_entry()])
        entries, _ = _parse_pcob(tag, _make_asset("DAT"))

        assert entries[0].source_tag == "PCOB"


# ── parse_anlz_cues priority ─────────────────────────────────────────────────

class TestParseAnlzCuesPriority:
    def test_prefers_pco2_from_ext(self):
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pco2_tag = _pco2_tag([_pco2_entry(time=100)])
        pcob_tag = _pcob_tag([_pcob_entry(time=200)])

        def side_effect(asset, code):
            if asset is ext and code == "PCO2":
                return pco2_tag
            if asset is dat and code == "PCOB":
                return pcob_tag
            return None

        with patch("dropdex_importer.cue_parser.get_first_tag", side_effect=side_effect):
            entries, _ = parse_anlz_cues(dat, ext)

        assert len(entries) == 1
        assert entries[0].source_tag == "PCO2"
        assert entries[0].start_ms == pytest.approx(100.0)

    def test_falls_back_to_pcob_from_dat(self):
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pcob_tag = _pcob_tag([_pcob_entry(time=200)])

        def side_effect(asset, code):
            if asset is dat and code == "PCOB":
                return pcob_tag
            return None

        with patch("dropdex_importer.cue_parser.get_first_tag", side_effect=side_effect):
            entries, _ = parse_anlz_cues(dat, ext)

        assert len(entries) == 1
        assert entries[0].source_tag == "PCOB"

    def test_empty_when_no_tags(self):
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")

        with patch("dropdex_importer.cue_parser.get_first_tag", return_value=None):
            entries, _ = parse_anlz_cues(dat, ext)

        assert entries == []

    def test_works_with_no_assets(self):
        entries, warnings = parse_anlz_cues(None, None)
        assert entries == []
        assert warnings == []
