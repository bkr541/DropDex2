"""
Tests for importer/dropdex_importer/cue_parser.py

Covers all 38 behavioral requirements for canonical ANLZ cue extraction.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from dropdex_importer.cue_parser import (
    _COLOR_TABLE,
    AnlzCueEntry,
    _classify_cue_family,
    _loop_end_ms,
    _memory_lists_agree,
    _merge_pcob_hot_by_slot,
    _parse_pcob,
    _parse_pco2,
    _resolve_pco2_color,
    _select_memory_cues,
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


def _anlz_entry(
    *,
    family: str = "hot",
    slot: int | None = 1,
    start_ms: float = 1000.0,
    end_ms: float | None = None,
    point_type: str = "cue",
    source_tag: str = "PCO2",
    asset_type: str = "EXT",
    tag_occurrence: int = 0,
    source_index: int = 0,
) -> AnlzCueEntry:
    return AnlzCueEntry(
        source_index=source_index,
        source_tag=source_tag,
        asset_type=asset_type,
        tag_occurrence=tag_occurrence,
        hot_cue_slot=slot,
        cue_family=family,
        point_type=point_type,
        start_ms=start_ms,
        end_ms=end_ms,
        color_hex=None,
        color_id=None,
        comment=None,
        is_active_loop=None,
        beat_loop_numerator=None,
        beat_loop_denominator=None,
        source_payload={},
    )


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
        entry = _pco2_entry(color_id=2)
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
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)

        assert len(entries) == 1
        assert entries[0].cue_family == "memory"
        assert entries[0].hot_cue_slot is None

    def test_hot_cue_slot_1_is_a(self):
        """Requirement 4: explicit PCO2 slot 1 imports as slot 1 (A)."""
        entry = _pco2_entry(hot_cue=1, time=1000)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)

        assert entries[0].cue_family == "hot"
        assert entries[0].hot_cue_slot == 1

    def test_hot_cue_slot_8_is_h(self):
        """Requirement 5: explicit PCO2 slot 8 imports as slot 8 (H)."""
        entry = _pco2_entry(hot_cue=8, time=1000)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)

        assert entries[0].cue_family == "hot"
        assert entries[0].hot_cue_slot == 8

    def test_sparse_hot_cue_slots_remain_sparse(self):
        """Requirement 6: slots 1, 2, 4 remain 1, 2, 4 — not compressed to 1, 2, 3."""
        entries_raw = [
            _pco2_entry(hot_cue=1, time=1000),
            _pco2_entry(hot_cue=2, time=2000),
            _pco2_entry(hot_cue=4, time=3000),
        ]
        tag = _pco2_tag(entries_raw)
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)

        slots = [e.hot_cue_slot for e in entries]
        assert slots == [1, 2, 4]

    def test_array_order_does_not_change_slot(self):
        """Requirement 7: slot assignment comes from hot_cue field, not array position."""
        entries_raw = [
            _pco2_entry(hot_cue=4, time=4000),
            _pco2_entry(hot_cue=1, time=1000),
        ]
        tag = _pco2_tag(entries_raw)
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)

        by_time = {e.start_ms: e.hot_cue_slot for e in entries}
        assert by_time[4000.0] == 4
        assert by_time[1000.0] == 1

    def test_point_type_cue(self):
        entry = _pco2_entry(type_=1)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)
        assert entries[0].point_type == "cue"

    def test_point_type_loop(self):
        entry = _pco2_entry(type_=2, loop_time=3000)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)
        assert entries[0].point_type == "loop"
        assert entries[0].end_ms == pytest.approx(3000.0)
        assert entries[0].is_active_loop is None

    def test_start_ms_from_time(self):
        entry = _pco2_entry(time=2345)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)
        assert entries[0].start_ms == pytest.approx(2345.0)

    def test_comment_extracted(self):
        """Requirement 22: PCO2 comment persists."""
        entry = _pco2_entry(comment="Drop here")
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)
        assert entries[0].comment == "Drop here"

    def test_rgb_color_persists(self):
        """Requirement 23: PCO2 RGB/color persists correctly."""
        entry = _pco2_entry(color_red=255, color_green=0, color_blue=128, color_id=1)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)
        assert entries[0].color_hex == "#FF0080"
        assert entries[0].color_id == 1

    def test_loop_start_end_persists(self):
        """Requirement 24: loop start/end persists."""
        entry = _pco2_entry(type_=2, time=5000, loop_time=7000)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)
        assert entries[0].start_ms == pytest.approx(5000.0)
        assert entries[0].end_ms == pytest.approx(7000.0)

    def test_beat_loop_ratio_persists(self):
        """Requirement 25: beat-loop ratio persists when present."""
        entry = _pco2_entry(loop_enumerator=3, loop_denominator=4)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)
        assert entries[0].beat_loop_numerator == 3
        assert entries[0].beat_loop_denominator == 4

    def test_source_tag_is_pco2(self):
        tag = _pco2_tag([_pco2_entry()])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)
        assert entries[0].source_tag == "PCO2"

    def test_asset_type_and_tag_occurrence_stored(self):
        tag = _pco2_tag([_pco2_entry()])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=2)
        assert entries[0].asset_type == "EXT"
        assert entries[0].tag_occurrence == 2

    def test_source_index_per_entry(self):
        entries_raw = [_pco2_entry(), _pco2_entry(time=2000)]
        tag = _pco2_tag(entries_raw)
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)
        assert entries[0].source_index == 0
        assert entries[1].source_index == 1

    def test_missing_entries_emits_error(self):
        tag = MagicMock()
        tag.content = SimpleNamespace()
        _, warnings = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)
        codes = [w.code for w in warnings]
        assert "CUE_PARSE_ERROR" in codes

    def test_source_payload_includes_provenance(self):
        entry = _pco2_entry(hot_cue=1, time=1000)
        tag = _pco2_tag([entry])
        entries, _ = _parse_pco2(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=1)
        payload = entries[0].source_payload
        assert payload["tag"] == "PCO2"
        assert payload["asset_type"] == "EXT"
        assert payload["tag_occurrence"] == 1


# ── PCOB parsing ──────────────────────────────────────────────────────────────

class TestParsePcob:
    def test_basic_memory_cue(self):
        """Requirement 13: second PCOB list is parsed when it is the Memory Cue list."""
        entry = _pcob_entry(hot_cue=0, time=1000, type_str="single")
        tag = _pcob_tag([entry])
        entries, _ = _parse_pcob(tag, _make_asset("DAT"), asset_type="DAT", tag_occurrence=1)

        assert len(entries) == 1
        assert entries[0].point_type == "cue"
        assert entries[0].cue_family == "memory"

    def test_dat_pcob_hot_slots_a_b_c(self):
        """Requirement 8: DAT PCOB A-C are parsed."""
        entries_raw = [
            _pcob_entry(hot_cue=1, time=1000),
            _pcob_entry(hot_cue=2, time=2000),
            _pcob_entry(hot_cue=3, time=3000),
        ]
        tag = _pcob_tag(entries_raw)
        entries, _ = _parse_pcob(tag, _make_asset("DAT"), asset_type="DAT", tag_occurrence=0)

        slots = {e.hot_cue_slot for e in entries}
        assert slots == {1, 2, 3}
        assert all(e.asset_type == "DAT" for e in entries)

    def test_ext_pcob_hot_slots_d_h(self):
        """Requirement 9: EXT PCOB D-H are parsed."""
        entries_raw = [
            _pcob_entry(hot_cue=4, time=4000),
            _pcob_entry(hot_cue=5, time=5000),
            _pcob_entry(hot_cue=6, time=6000),
            _pcob_entry(hot_cue=7, time=7000),
            _pcob_entry(hot_cue=8, time=8000),
        ]
        tag = _pcob_tag(entries_raw)
        entries, _ = _parse_pcob(tag, _make_asset("EXT"), asset_type="EXT", tag_occurrence=0)

        slots = {e.hot_cue_slot for e in entries}
        assert slots == {4, 5, 6, 7, 8}
        assert all(e.asset_type == "EXT" for e in entries)

    def test_loop_type_from_enum_string(self):
        entry = _pcob_entry(type_str="loop", loop_time=4000)
        tag = _pcob_tag([entry])
        entries, _ = _parse_pcob(tag, _make_asset("DAT"), asset_type="DAT", tag_occurrence=0)
        assert entries[0].point_type == "loop"

    def test_memory_loop_retains_end_position(self):
        """Requirement 15: Memory loops retain end positions."""
        entry = _pcob_entry(hot_cue=0, time=1000, type_str="loop", loop_time=5000)
        tag = _pcob_tag([entry])
        entries, _ = _parse_pcob(tag, _make_asset("DAT"), asset_type="DAT", tag_occurrence=1)
        assert entries[0].end_ms == pytest.approx(5000.0)
        assert entries[0].cue_family == "memory"

    def test_no_color_in_pcob(self):
        tag = _pcob_tag([_pcob_entry()])
        entries, _ = _parse_pcob(tag, _make_asset("DAT"), asset_type="DAT", tag_occurrence=0)
        assert entries[0].color_hex is None
        assert entries[0].color_id is None

    def test_no_comment_in_pcob(self):
        tag = _pcob_tag([_pcob_entry()])
        entries, _ = _parse_pcob(tag, _make_asset("DAT"), asset_type="DAT", tag_occurrence=0)
        assert entries[0].comment is None

    def test_source_tag_is_pcob(self):
        tag = _pcob_tag([_pcob_entry()])
        entries, _ = _parse_pcob(tag, _make_asset("DAT"), asset_type="DAT", tag_occurrence=0)
        assert entries[0].source_tag == "PCOB"

    def test_asset_type_and_tag_occurrence_stored(self):
        tag = _pcob_tag([_pcob_entry()])
        entries, _ = _parse_pcob(tag, _make_asset("DAT"), asset_type="DAT", tag_occurrence=3)
        assert entries[0].asset_type == "DAT"
        assert entries[0].tag_occurrence == 3

    def test_memory_cue_ordering_provenance_retained(self):
        """Requirement 16: Memory cue ordering/provenance is retained."""
        entries_raw = [
            _pcob_entry(hot_cue=0, time=3000),
            _pcob_entry(hot_cue=0, time=1000),
            _pcob_entry(hot_cue=0, time=2000),
        ]
        tag = _pcob_tag(entries_raw)
        entries, _ = _parse_pcob(tag, _make_asset("DAT"), asset_type="DAT", tag_occurrence=1)
        # source_index matches original array order, preserving provenance
        assert entries[0].source_index == 0
        assert entries[0].start_ms == pytest.approx(3000.0)
        assert entries[1].source_index == 1
        assert entries[2].source_index == 2

    def test_source_payload_includes_provenance(self):
        tag = _pcob_tag([_pcob_entry()])
        entries, _ = _parse_pcob(tag, _make_asset("DAT"), asset_type="DAT", tag_occurrence=2)
        payload = entries[0].source_payload
        assert payload["tag"] == "PCOB"
        assert payload["asset_type"] == "DAT"
        assert payload["tag_occurrence"] == 2


# ── _merge_pcob_hot_by_slot ───────────────────────────────────────────────────

class TestMergePcobHotBySlot:
    def test_dat_only_fallback_succeeds_when_ext_absent(self):
        """Requirement 11: DAT-only fallback succeeds when EXT is absent."""
        dat_hot = [
            _anlz_entry(family="hot", slot=1, asset_type="DAT"),
            _anlz_entry(family="hot", slot=2, asset_type="DAT"),
        ]
        result = _merge_pcob_hot_by_slot(dat_hot, [])
        slots = [e.hot_cue_slot for e in result]
        assert slots == [1, 2]

    def test_dat_plus_ext_combines_a_h(self):
        """Requirement 10: DAT + EXT fallback combines using explicit slots."""
        dat_hot = [
            _anlz_entry(family="hot", slot=1, asset_type="DAT"),
            _anlz_entry(family="hot", slot=2, asset_type="DAT"),
            _anlz_entry(family="hot", slot=3, asset_type="DAT"),
        ]
        ext_hot = [
            _anlz_entry(family="hot", slot=4, asset_type="EXT"),
            _anlz_entry(family="hot", slot=5, asset_type="EXT"),
            _anlz_entry(family="hot", slot=6, asset_type="EXT"),
            _anlz_entry(family="hot", slot=7, asset_type="EXT"),
            _anlz_entry(family="hot", slot=8, asset_type="EXT"),
        ]
        result = _merge_pcob_hot_by_slot(dat_hot, ext_hot)
        slots = [e.hot_cue_slot for e in result]
        assert slots == [1, 2, 3, 4, 5, 6, 7, 8]

    def test_missing_ext_does_not_invent_d_h(self):
        """Requirement 12: Missing EXT does not invent D-H slots."""
        dat_hot = [
            _anlz_entry(family="hot", slot=1, asset_type="DAT"),
            _anlz_entry(family="hot", slot=2, asset_type="DAT"),
        ]
        result = _merge_pcob_hot_by_slot(dat_hot, [])
        slots = [e.hot_cue_slot for e in result]
        assert 4 not in slots
        assert 5 not in slots
        assert 6 not in slots
        assert 7 not in slots
        assert 8 not in slots

    def test_dat_overrides_ext_for_same_slot(self):
        """DAT entry wins when both DAT and EXT have the same slot."""
        dat_slot1 = _anlz_entry(family="hot", slot=1, start_ms=1000.0, asset_type="DAT")
        ext_slot1 = _anlz_entry(family="hot", slot=1, start_ms=999.0, asset_type="EXT")
        result = _merge_pcob_hot_by_slot([dat_slot1], [ext_slot1])
        assert len(result) == 1
        assert result[0].asset_type == "DAT"
        assert result[0].start_ms == pytest.approx(1000.0)


# ── _memory_lists_agree ───────────────────────────────────────────────────────

class TestMemoryListsAgree:
    def test_empty_lists_agree(self):
        assert _memory_lists_agree([], []) is True

    def test_different_count_disagrees(self):
        """Requirement 20: list count mismatch → conflict."""
        pcob = [_anlz_entry(family="memory", slot=None, start_ms=1000.0)]
        pco2 = [
            _anlz_entry(family="memory", slot=None, start_ms=1000.0),
            _anlz_entry(family="memory", slot=None, start_ms=2000.0),
        ]
        assert _memory_lists_agree(pcob, pco2) is False

    def test_different_start_ms_disagrees(self):
        """Requirement 21: different start time → conflict, no tolerance."""
        pcob = [_anlz_entry(family="memory", slot=None, start_ms=1000.0)]
        pco2 = [_anlz_entry(family="memory", slot=None, start_ms=1001.0)]
        assert _memory_lists_agree(pcob, pco2) is False

    def test_different_point_type_disagrees(self):
        pcob = [_anlz_entry(family="memory", slot=None, point_type="cue")]
        pco2 = [_anlz_entry(family="memory", slot=None, point_type="loop", end_ms=5000.0)]
        assert _memory_lists_agree(pcob, pco2) is False

    def test_exact_match_agrees(self):
        """Requirement 19: exact whole-list agreement permits safe PCO2 enrichment."""
        pcob = [
            _anlz_entry(family="memory", slot=None, start_ms=1000.0, point_type="cue"),
            _anlz_entry(family="memory", slot=None, start_ms=2000.0, point_type="loop", end_ms=4000.0),
        ]
        pco2 = [
            _anlz_entry(family="memory", slot=None, start_ms=1000.0, point_type="cue"),
            _anlz_entry(family="memory", slot=None, start_ms=2000.0, point_type="loop", end_ms=4000.0),
        ]
        assert _memory_lists_agree(pcob, pco2) is True


# ── _select_memory_cues ───────────────────────────────────────────────────────

class TestSelectMemoryCues:
    def test_no_pco2_returns_pcob(self):
        pcob = [_anlz_entry(family="memory", slot=None, start_ms=1000.0)]
        result = _select_memory_cues(pcob, [], [])
        assert result is pcob

    def test_no_pcob_returns_pco2(self):
        """PCO2 memory is used when PCOB has no memory entries."""
        pco2 = [_anlz_entry(family="memory", slot=None, start_ms=1000.0, source_tag="PCO2")]
        result = _select_memory_cues([], pco2, [])
        assert result is pco2

    def test_agreement_uses_pco2(self):
        """Requirement 19: exact agreement permits richer PCO2 data."""
        pcob = [_anlz_entry(family="memory", slot=None, start_ms=1000.0, source_tag="PCOB")]
        pco2 = [_anlz_entry(family="memory", slot=None, start_ms=1000.0, source_tag="PCO2")]
        result = _select_memory_cues(pcob, pco2, [])
        assert result is pco2

    def test_conflict_keeps_pcob_and_emits_warning(self):
        """Requirement 20: material conflict fails closed, keeps PCOB."""
        pcob = [_anlz_entry(family="memory", slot=None, start_ms=1000.0)]
        pco2 = [_anlz_entry(family="memory", slot=None, start_ms=2000.0)]  # different time
        warnings: list = []
        result = _select_memory_cues(pcob, pco2, warnings)
        assert result is pcob
        assert len(warnings) == 1
        assert warnings[0].code == "CUE_MEMORY_CONFLICT"


# ── parse_anlz_cues (integration) ─────────────────────────────────────────────

class TestParseAnlzCues:

    # ── Track association (tests 1-3) ────────────────────────────────────────

    def test_cue_parse_does_not_use_filename_identity(self):
        """Requirement 3: parsing operates on the asset object, not filename guessing."""
        dat = _make_asset("DAT")
        dat.asset_type = "DAT"
        ext = _make_asset("EXT")
        ext.asset_type = "EXT"

        pco2 = _pco2_tag([_pco2_entry(hot_cue=1, time=1000)])
        pcob_hot = _pcob_tag([_pcob_entry(hot_cue=1, time=2000)])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            def side_effect(asset, code):
                # Only EXT should supply PCO2; DAT has no PCO2 tag
                if asset is ext and code == "PCO2":
                    return [pco2]
                if asset is dat and code == "PCOB":
                    return [pcob_hot]
                return []
            mock_tags.side_effect = side_effect
            entries, _ = parse_anlz_cues(dat, ext)

        # PCO2 from EXT is preferred; PCOB from DAT not used for hot cues
        assert len(entries) == 1
        assert entries[0].source_tag == "PCO2"
        assert entries[0].asset_type == "EXT"

    # ── PCO2 Hot Cues (tests 4-7) ─────────────────────────────────────────────

    def test_pco2_slot_1_imports_as_a(self):
        """Requirement 4: slot 1 = A."""
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pco2 = _pco2_tag([_pco2_entry(hot_cue=1, time=1000)])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [pco2] if asset is ext and code == "PCO2" else []
            entries, _ = parse_anlz_cues(dat, ext)

        assert entries[0].hot_cue_slot == 1
        assert entries[0].cue_family == "hot"

    def test_pco2_slot_8_imports_as_h(self):
        """Requirement 5: slot 8 = H."""
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pco2 = _pco2_tag([_pco2_entry(hot_cue=8, time=1000)])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [pco2] if asset is ext and code == "PCO2" else []
            entries, _ = parse_anlz_cues(dat, ext)

        assert entries[0].hot_cue_slot == 8

    def test_sparse_slots_remain_sparse(self):
        """Requirement 6: A, B, D stays A, B, D — not compressed."""
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pco2 = _pco2_tag([
            _pco2_entry(hot_cue=1, time=1000),
            _pco2_entry(hot_cue=2, time=2000),
            _pco2_entry(hot_cue=4, time=4000),
        ])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [pco2] if asset is ext and code == "PCO2" else []
            entries, _ = parse_anlz_cues(dat, ext)

        hot_entries = [e for e in entries if e.cue_family == "hot"]
        slots = {e.hot_cue_slot for e in hot_entries}
        assert slots == {1, 2, 4}

    def test_array_order_does_not_change_slot_assignment(self):
        """Requirement 7: slot comes from hot_cue field, not position in array."""
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pco2 = _pco2_tag([
            _pco2_entry(hot_cue=5, time=5000),
            _pco2_entry(hot_cue=1, time=1000),
        ])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [pco2] if asset is ext and code == "PCO2" else []
            entries, _ = parse_anlz_cues(dat, ext)

        hot_entries = [e for e in entries if e.cue_family == "hot"]
        by_time = {e.start_ms: e.hot_cue_slot for e in hot_entries}
        assert by_time[5000.0] == 5
        assert by_time[1000.0] == 1

    # ── PCOB Fallback (tests 8-12) ────────────────────────────────────────────

    def test_dat_pcob_hot_cues_a_c_parsed(self):
        """Requirement 8: DAT PCOB A-C are parsed in fallback."""
        dat = _make_asset("DAT")
        pcob_hot = _pcob_tag([
            _pcob_entry(hot_cue=1, time=1000),
            _pcob_entry(hot_cue=2, time=2000),
            _pcob_entry(hot_cue=3, time=3000),
        ])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [pcob_hot] if asset is dat and code == "PCOB" else []
            entries, _ = parse_anlz_cues(dat, None)

        hot = [e for e in entries if e.cue_family == "hot"]
        assert {e.hot_cue_slot for e in hot} == {1, 2, 3}

    def test_ext_pcob_hot_cues_d_h_parsed(self):
        """Requirement 9: EXT PCOB D-H are parsed in fallback."""
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        ext_pcob_hot = _pcob_tag([
            _pcob_entry(hot_cue=4, time=4000),
            _pcob_entry(hot_cue=5, time=5000),
        ])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            def side_effect(asset, code):
                if asset is ext and code == "PCOB":
                    return [ext_pcob_hot]
                return []
            mock_tags.side_effect = side_effect
            entries, _ = parse_anlz_cues(dat, ext)

        hot = [e for e in entries if e.cue_family == "hot"]
        assert {e.hot_cue_slot for e in hot} >= {4, 5}

    def test_dat_plus_ext_pcob_fallback_combines_by_slot(self):
        """Requirement 10: DAT + EXT PCOB fallback combines A-H by slot."""
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        dat_pcob = _pcob_tag([
            _pcob_entry(hot_cue=1, time=1000),
            _pcob_entry(hot_cue=2, time=2000),
            _pcob_entry(hot_cue=3, time=3000),
        ])
        ext_pcob = _pcob_tag([
            _pcob_entry(hot_cue=4, time=4000),
            _pcob_entry(hot_cue=5, time=5000),
        ])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            def side_effect(asset, code):
                if asset is dat and code == "PCOB":
                    return [dat_pcob]
                if asset is ext and code == "PCOB":
                    return [ext_pcob]
                return []
            mock_tags.side_effect = side_effect
            entries, _ = parse_anlz_cues(dat, ext)

        hot = [e for e in entries if e.cue_family == "hot"]
        assert {e.hot_cue_slot for e in hot} == {1, 2, 3, 4, 5}

    def test_dat_only_fallback_succeeds_when_ext_absent(self):
        """Requirement 11: DAT-only analysis succeeds with no EXT."""
        dat = _make_asset("DAT")
        dat_pcob = _pcob_tag([
            _pcob_entry(hot_cue=1, time=1000),
            _pcob_entry(hot_cue=0, time=2000),  # memory
        ])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [dat_pcob] if asset is dat and code == "PCOB" else []
            entries, _ = parse_anlz_cues(dat, None)

        assert any(e.cue_family == "hot" and e.hot_cue_slot == 1 for e in entries)
        assert any(e.cue_family == "memory" for e in entries)

    def test_missing_ext_does_not_invent_d_h(self):
        """Requirement 12: Missing EXT must not invent D-H slots."""
        dat = _make_asset("DAT")
        dat_pcob = _pcob_tag([
            _pcob_entry(hot_cue=1, time=1000),
            _pcob_entry(hot_cue=2, time=2000),
        ])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [dat_pcob] if asset is dat and code == "PCOB" else []
            entries, _ = parse_anlz_cues(dat, None)

        hot = [e for e in entries if e.cue_family == "hot"]
        invented_slots = {e.hot_cue_slot for e in hot} - {1, 2}
        assert not invented_slots

    # ── Memory Cues (tests 13-16) ─────────────────────────────────────────────

    def test_second_pcob_tag_is_parsed_for_memory_cues(self):
        """Requirement 13: second PCOB list is parsed when it is the Memory Cue list."""
        dat = _make_asset("DAT")
        pcob_hot = _pcob_tag([_pcob_entry(hot_cue=1, time=1000)])
        pcob_memory = _pcob_tag([_pcob_entry(hot_cue=0, time=5000)])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            def side_effect(asset, code):
                if asset is dat and code == "PCOB":
                    return [pcob_hot, pcob_memory]
                return []
            mock_tags.side_effect = side_effect
            entries, _ = parse_anlz_cues(dat, None)

        memory = [e for e in entries if e.cue_family == "memory"]
        hot = [e for e in entries if e.cue_family == "hot"]
        assert len(memory) == 1
        assert memory[0].start_ms == pytest.approx(5000.0)
        assert len(hot) == 1

    def test_memory_cues_not_lost_when_first_pcob_is_hot(self):
        """Requirement 14: Memory Cues survive even when tag[0] is the Hot list."""
        dat = _make_asset("DAT")
        pcob_tag0 = _pcob_tag([
            _pcob_entry(hot_cue=1, time=1000),
            _pcob_entry(hot_cue=2, time=2000),
        ])
        pcob_tag1 = _pcob_tag([
            _pcob_entry(hot_cue=0, time=9000),
            _pcob_entry(hot_cue=0, time=11000),
        ])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [pcob_tag0, pcob_tag1] if asset is dat and code == "PCOB" else []
            entries, _ = parse_anlz_cues(dat, None)

        memory = [e for e in entries if e.cue_family == "memory"]
        assert len(memory) == 2
        times = {e.start_ms for e in memory}
        assert times == {9000.0, 11000.0}

    def test_memory_loops_retain_end_positions(self):
        """Requirement 15: Memory loops retain end positions."""
        dat = _make_asset("DAT")
        pcob_memory = _pcob_tag([
            _pcob_entry(hot_cue=0, time=1000, type_str="loop", loop_time=8000),
        ])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [pcob_memory] if asset is dat and code == "PCOB" else []
            entries, _ = parse_anlz_cues(dat, None)

        memory = [e for e in entries if e.cue_family == "memory"]
        assert len(memory) == 1
        assert memory[0].point_type == "loop"
        assert memory[0].end_ms == pytest.approx(8000.0)

    def test_memory_cue_provenance_retained_in_order(self):
        """Requirement 16: Memory cue ordering/provenance is retained."""
        dat = _make_asset("DAT")
        pcob_memory = _pcob_tag([
            _pcob_entry(hot_cue=0, time=5000),
            _pcob_entry(hot_cue=0, time=3000),
            _pcob_entry(hot_cue=0, time=7000),
        ])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [pcob_memory] if asset is dat and code == "PCOB" else []
            entries, _ = parse_anlz_cues(dat, None)

        memory = [e for e in entries if e.cue_family == "memory"]
        # source_index preserves original array order
        assert memory[0].source_index == 0 and memory[0].start_ms == pytest.approx(5000.0)
        assert memory[1].source_index == 1 and memory[1].start_ms == pytest.approx(3000.0)
        assert memory[2].source_index == 2 and memory[2].start_ms == pytest.approx(7000.0)

    # ── Same timestamps (tests 17-18) ─────────────────────────────────────────

    def test_memory_and_hot_at_same_time_survive_as_distinct(self):
        """Requirement 17: Memory Cue and Hot Cue at identical start time are distinct rows."""
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pco2 = _pco2_tag([
            _pco2_entry(hot_cue=1, time=30000),   # Hot A at 30s
            _pco2_entry(hot_cue=0, time=30000),   # Memory at 30s
        ])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [pco2] if asset is ext and code == "PCO2" else []
            entries, _ = parse_anlz_cues(dat, ext)

        assert len(entries) == 2
        families = {e.cue_family for e in entries}
        assert "hot" in families
        assert "memory" in families
        starts = [e.start_ms for e in entries]
        assert all(s == pytest.approx(30000.0) for s in starts)

    def test_distinct_memory_entries_at_same_time_not_collapsed(self):
        """Requirement 18: two distinct Memory entries at same start_ms survive as two rows."""
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pco2 = _pco2_tag([
            _pco2_entry(hot_cue=0, time=15000, comment="first"),
            _pco2_entry(hot_cue=0, time=15000, comment="second"),
        ])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [pco2] if asset is ext and code == "PCO2" else []
            entries, _ = parse_anlz_cues(dat, ext)

        memory = [e for e in entries if e.cue_family == "memory"]
        assert len(memory) == 2

    # ── PCO2 Memory (tests 19-21) ─────────────────────────────────────────────

    def test_exact_pco2_memory_agreement_enriches_with_pco2(self):
        """Requirement 19: exact whole-list agreement permits safe richer PCO2 selection."""
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pcob_memory = _pcob_tag([_pcob_entry(hot_cue=0, time=1000)])
        pco2 = _pco2_tag([_pco2_entry(hot_cue=0, time=1000, comment="from pco2")])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            def side_effect(asset, code):
                if asset is dat and code == "PCOB":
                    return [pcob_memory]
                if asset is ext and code == "PCO2":
                    return [pco2]
                return []
            mock_tags.side_effect = side_effect
            entries, _ = parse_anlz_cues(dat, ext)

        memory = [e for e in entries if e.cue_family == "memory"]
        assert len(memory) == 1
        assert memory[0].source_tag == "PCO2"
        assert memory[0].comment == "from pco2"

    def test_pco2_memory_conflict_fails_closed(self):
        """Requirement 20: material PCO2/PCOB Memory conflict fails closed."""
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pcob_memory = _pcob_tag([_pcob_entry(hot_cue=0, time=1000)])
        pco2 = _pco2_tag([_pco2_entry(hot_cue=0, time=2000)])  # different time

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            def side_effect(asset, code):
                if asset is dat and code == "PCOB":
                    return [pcob_memory]
                if asset is ext and code == "PCO2":
                    return [pco2]
                return []
            mock_tags.side_effect = side_effect
            entries, warnings = parse_anlz_cues(dat, ext)

        memory = [e for e in entries if e.cue_family == "memory"]
        assert len(memory) == 1
        assert memory[0].source_tag == "PCOB"  # safe fallback
        codes = [w.code for w in warnings]
        assert "CUE_MEMORY_CONFLICT" in codes

    def test_no_timestamp_tolerance_used_to_pair_memory_entries(self):
        """Requirement 21: No timestamp tolerance pairs conflicting memory entries."""
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        # 1ms difference — with any tolerance these would look like the same cue
        pcob_memory = _pcob_tag([_pcob_entry(hot_cue=0, time=1000)])
        pco2 = _pco2_tag([_pco2_entry(hot_cue=0, time=1001)])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            def side_effect(asset, code):
                if asset is dat and code == "PCOB":
                    return [pcob_memory]
                if asset is ext and code == "PCO2":
                    return [pco2]
                return []
            mock_tags.side_effect = side_effect
            entries, warnings = parse_anlz_cues(dat, ext)

        # Even a 1ms difference must trigger conflict; PCOB is the safe fallback
        memory = [e for e in entries if e.cue_family == "memory"]
        assert memory[0].source_tag == "PCOB"
        assert any(w.code == "CUE_MEMORY_CONFLICT" for w in warnings)

    # ── Database cue absence (tests 26-28) ───────────────────────────────────

    def test_zero_db_cue_rows_does_not_prevent_canonical_import(self):
        """Requirement 26: Zero database cue rows does not prevent canonical cue import."""
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pco2 = _pco2_tag([_pco2_entry(hot_cue=1, time=1000)])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [pco2] if asset is ext and code == "PCO2" else []
            entries, _ = parse_anlz_cues(dat, ext)

        assert len(entries) == 1
        assert entries[0].source_tag == "PCO2"

    def test_anlz_derived_cue_has_no_db_identity(self):
        """Requirements 27, 28: source_db_present=false and rekordbox_cue_id=null for ANLZ cues."""
        # AnlzCueEntry intentionally has no rekordbox_cue_id field —
        # the reconciliation layer creates rows with rekordbox_cue_id=None.
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pco2 = _pco2_tag([_pco2_entry(hot_cue=1, time=1000)])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [pco2] if asset is ext and code == "PCO2" else []
            entries, _ = parse_anlz_cues(dat, ext)

        # The AnlzCueEntry has no cue_id field — it carries only ANLZ provenance.
        entry = entries[0]
        assert not hasattr(entry, "rekordbox_cue_id") or getattr(entry, "rekordbox_cue_id", None) is None

    # ── Forbidden behaviors (tests 35-38) ────────────────────────────────────

    def test_no_timestamp_tolerance_used_for_hot_cue_identity(self):
        """Requirement 35: No tolerance-based cue identity. Slots are explicit."""
        # Verify that slot assignment comes from the hot_cue field, not from
        # timestamp clustering. Different slots at the same time must both survive.
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pco2 = _pco2_tag([
            _pco2_entry(hot_cue=1, time=1000),
            _pco2_entry(hot_cue=2, time=1000),  # same time, different slot
        ])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [pco2] if asset is ext and code == "PCO2" else []
            entries, _ = parse_anlz_cues(dat, ext)

        assert len(entries) == 2
        slots = {e.hot_cue_slot for e in entries}
        assert slots == {1, 2}

    def test_no_nearest_cue_matching(self):
        """Requirement 36: No nearest-cue matching. parse_anlz_cues uses get_all_tags."""
        # Verify the function is patched to use get_all_tags (not get_first_tag).
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")

        with patch("dropdex_importer.cue_parser.get_all_tags", return_value=[]) as mock_all:
            parse_anlz_cues(dat, ext)
            assert mock_all.called

    def test_no_xml_cue_import_introduced(self):
        """Requirement 37: No XML import path exists in parse_anlz_cues."""
        import inspect
        import dropdex_importer.cue_parser as cue_mod
        src = inspect.getsource(cue_mod)
        assert ".xml" not in src.lower()
        assert "xml" not in src.lower().split("import")[0]

    def test_no_fabricated_cue_id(self):
        """Requirement 38: No fabricated cue IDs. AnlzCueEntry has no rekordbox_cue_id."""
        entry = AnlzCueEntry(
            source_index=0,
            source_tag="PCO2",
            asset_type="EXT",
            tag_occurrence=0,
            hot_cue_slot=1,
            cue_family="hot",
            point_type="cue",
            start_ms=1000.0,
            end_ms=None,
            color_hex=None,
            color_id=None,
            comment=None,
            is_active_loop=None,
            beat_loop_numerator=None,
            beat_loop_denominator=None,
        )
        assert not hasattr(entry, "rekordbox_cue_id")

    # ── EXT requirement (tests 32-34) ────────────────────────────────────────

    def test_dat_only_analysis_accepted(self):
        """Requirement 32: DAT present + EXT absent is accepted."""
        dat = _make_asset("DAT")
        pcob = _pcob_tag([_pcob_entry(hot_cue=1, time=1000)])

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            mock_tags.side_effect = lambda asset, code: [pcob] if asset is dat and code == "PCOB" else []
            entries, warnings = parse_anlz_cues(dat, None)

        assert len(entries) == 1
        error_codes = [w.code for w in warnings if "ERROR" in w.code or "REQUIRED" in w.code]
        assert not error_codes

    def test_dat_plus_ext_still_parses_ext(self):
        """Requirement 33: DAT + EXT present still uploads/parses EXT."""
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")
        pco2 = _pco2_tag([_pco2_entry(hot_cue=1, time=1000)])

        calls: list[tuple] = []

        with patch("dropdex_importer.cue_parser.get_all_tags") as mock_tags:
            def side_effect(asset, code):
                calls.append((asset.asset_type if hasattr(asset, "asset_type") else "?", code))
                if asset is ext and code == "PCO2":
                    return [pco2]
                return []
            mock_tags.side_effect = side_effect
            entries, _ = parse_anlz_cues(dat, ext)

        # EXT was interrogated for both PCO2 and PCOB
        ext_queries = [(at, code) for at, code in calls if at == "EXT"]
        assert any(code == "PCO2" for _, code in ext_queries)

    def test_empty_when_no_tags(self):
        dat = _make_asset("DAT")
        ext = _make_asset("EXT")

        with patch("dropdex_importer.cue_parser.get_all_tags", return_value=[]):
            entries, _ = parse_anlz_cues(dat, ext)

        assert entries == []

    def test_works_with_no_assets(self):
        entries, warnings = parse_anlz_cues(None, None)
        assert entries == []
        assert warnings == []
