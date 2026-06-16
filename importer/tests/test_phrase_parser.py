"""
Tests for importer/dropdex_importer/phrase_parser.py
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from dropdex_importer.beatgrid_parser import BeatEntry, BeatGridResult
from dropdex_importer.phrase_parser import (
    _KIND_LABELS_HIGH_ENERGY,
    _KIND_LABELS_MID_LOW,
    _MOOD_LABELS,
    _map_kind_label,
    extract_phrases,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_asset(asset_type: str = "EXT") -> Any:
    asset = MagicMock()
    asset.asset_type = asset_type
    return asset


def _pssi_entry(beat: int, kind: int, fill: int = 0, beat_fill: int = 0,
                k1: int = 0, k2: int = 0, k3: int = 0, b: int = 0,
                beat_2: int = 0, beat_3: int = 0, beat_4: int = 0) -> SimpleNamespace:
    return SimpleNamespace(
        beat=beat, kind=kind, fill=fill, beat_fill=beat_fill,
        k1=k1, k2=k2, k3=k3, b=b,
        beat_2=beat_2, beat_3=beat_3, beat_4=beat_4,
    )


def _pssi_tag(entries: list, mood: int = 1, bank: int = 0, end_beat: int = 128) -> Any:
    tag = MagicMock()
    tag.content.entries = entries
    tag.content.mood = mood
    tag.content.bank = bank
    tag.content.end_beat = end_beat
    return tag


def _simple_beat_grid(n_beats: int = 32, bpm: float = 128.0) -> BeatGridResult:
    ms_per_beat = 60000.0 / bpm
    beats = [
        BeatEntry(
            seq=i + 1,
            src_idx=i,
            beat_in_bar=((i % 4) + 1),
            bar=(i // 4) + 1,
            ms=i * ms_per_beat,
            bpm=bpm,
            is_downbeat=(i % 4 == 0),
        )
        for i in range(n_beats)
    ]
    return BeatGridResult(
        beats=beats,
        beat_count=n_beats,
        downbeat_count=n_beats // 4,
        bar_count=n_beats // 4,
        first_beat_ms=0.0,
        first_downbeat_ms=0.0,
        minimum_bpm=bpm,
        maximum_bpm=bpm,
        is_variable_tempo=False,
        source_tag="PQTZ",
    )


# ── _map_kind_label ───────────────────────────────────────────────────────────

class TestMapKindLabel:
    def test_high_energy_intro(self):
        assert _map_kind_label(1, 1) == "intro"

    def test_high_energy_outro(self):
        assert _map_kind_label(1, 7) == "outro"

    def test_mid_energy_chorus(self):
        assert _map_kind_label(2, 3) == "chorus"

    def test_low_energy_bridge(self):
        assert _map_kind_label(3, 5) == "bridge"

    def test_unknown_mood_returns_none(self):
        assert _map_kind_label(99, 1) is None

    def test_unknown_kind_returns_none(self):
        assert _map_kind_label(1, 99) is None

    def test_all_high_energy_kinds_mapped(self):
        for kind, label in _KIND_LABELS_HIGH_ENERGY.items():
            assert _map_kind_label(1, kind) == label

    def test_all_mid_energy_kinds_mapped(self):
        for kind, label in _KIND_LABELS_MID_LOW.items():
            assert _map_kind_label(2, kind) == label
            assert _map_kind_label(3, kind) == label


# ── extract_phrases ───────────────────────────────────────────────────────────

class TestExtractPhrases:
    def test_returns_empty_for_none_asset(self):
        entries, warnings = extract_phrases(None)
        assert entries == []
        assert warnings == []

    def test_returns_empty_when_no_pssi_tag(self):
        ext = _make_asset("EXT")
        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=None):
            entries, _ = extract_phrases(ext)
        assert entries == []

    def test_basic_phrase_count(self):
        ext = _make_asset("EXT")
        raw = [_pssi_entry(1, 1), _pssi_entry(33, 4), _pssi_entry(65, 7)]
        tag = _pssi_tag(raw, mood=1, end_beat=97)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, _ = extract_phrases(ext)

        assert len(entries) == 3

    def test_phrase_index_is_0_based(self):
        ext = _make_asset("EXT")
        raw = [_pssi_entry(1, 1), _pssi_entry(33, 4)]
        tag = _pssi_tag(raw)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, _ = extract_phrases(ext)

        assert entries[0].phrase_index == 0
        assert entries[1].phrase_index == 1

    def test_start_beat_from_entry(self):
        ext = _make_asset("EXT")
        raw = [_pssi_entry(17, 2)]
        tag = _pssi_tag(raw)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, _ = extract_phrases(ext)

        assert entries[0].start_beat == 17

    def test_end_beat_is_next_start_beat(self):
        ext = _make_asset("EXT")
        raw = [_pssi_entry(1, 1), _pssi_entry(33, 4), _pssi_entry(65, 7)]
        tag = _pssi_tag(raw, end_beat=97)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, _ = extract_phrases(ext)

        assert entries[0].end_beat == 33   # next phrase's start
        assert entries[1].end_beat == 65
        assert entries[2].end_beat == 97   # tag.end_beat

    def test_normalized_label_high_energy(self):
        ext = _make_asset("EXT")
        raw = [_pssi_entry(1, 4)]  # kind=4 → "chorus" in high energy
        tag = _pssi_tag(raw, mood=1)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, _ = extract_phrases(ext)

        assert entries[0].normalized_label == "chorus"

    def test_normalized_label_mid_energy(self):
        ext = _make_asset("EXT")
        raw = [_pssi_entry(1, 3)]  # kind=3 → "chorus" in mid energy
        tag = _pssi_tag(raw, mood=2)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, _ = extract_phrases(ext)

        assert entries[0].normalized_label == "chorus"

    def test_unknown_kind_gives_none_label_and_warning(self):
        ext = _make_asset("EXT")
        raw = [_pssi_entry(1, 99)]  # kind 99 is not mapped
        tag = _pssi_tag(raw, mood=1)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, warnings = extract_phrases(ext)

        assert entries[0].normalized_label is None
        codes = [w.code for w in warnings]
        assert "PHRASE_UNKNOWN_KIND" in codes

    def test_unknown_mood_gives_warning(self):
        ext = _make_asset("EXT")
        raw = [_pssi_entry(1, 1)]
        tag = _pssi_tag(raw, mood=99)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            _, warnings = extract_phrases(ext)

        codes = [w.code for w in warnings]
        assert "PHRASE_UNKNOWN_MOOD" in codes

    def test_source_mood_stored_as_string(self):
        ext = _make_asset("EXT")
        raw = [_pssi_entry(1, 1)]
        tag = _pssi_tag(raw, mood=2)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, _ = extract_phrases(ext)

        assert entries[0].source_mood == "2"

    def test_source_kind_stored_as_string(self):
        ext = _make_asset("EXT")
        raw = [_pssi_entry(1, 7)]
        tag = _pssi_tag(raw, mood=1)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, _ = extract_phrases(ext)

        assert entries[0].source_kind == "7"

    def test_ms_derived_from_beat_grid(self):
        ext = _make_asset("EXT")
        grid = _simple_beat_grid(n_beats=64, bpm=120.0)
        raw = [_pssi_entry(1, 1), _pssi_entry(33, 4)]
        tag = _pssi_tag(raw, end_beat=65)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, _ = extract_phrases(ext, beat_grid=grid)

        ms_per_beat = 60000.0 / 120.0
        assert entries[0].start_ms == pytest.approx(0.0)        # beat seq=1 → index 0
        assert entries[1].start_ms == pytest.approx(32 * ms_per_beat)  # beat seq=33

    def test_ms_none_when_no_beat_grid(self):
        ext = _make_asset("EXT")
        raw = [_pssi_entry(1, 1)]
        tag = _pssi_tag(raw)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, _ = extract_phrases(ext, beat_grid=None)

        assert entries[0].start_ms is None
        assert entries[0].end_ms is None

    def test_fill_metadata(self):
        ext = _make_asset("EXT")
        raw = [_pssi_entry(1, 1, fill=1, beat_fill=29)]
        tag = _pssi_tag(raw)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, _ = extract_phrases(ext)

        assert entries[0].fill_start_beat == 29
        assert entries[0].source_flags["fill"] is True
        assert entries[0].source_flags["beat_fill"] == 29

    def test_no_fill(self):
        ext = _make_asset("EXT")
        raw = [_pssi_entry(1, 1, fill=0)]
        tag = _pssi_tag(raw)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, _ = extract_phrases(ext)

        assert entries[0].fill_start_beat is None
        assert entries[0].source_flags["fill"] is False

    def test_source_payload_contains_raw_fields(self):
        ext = _make_asset("EXT")
        raw = [_pssi_entry(beat=5, kind=3, beat_2=10, beat_3=20, beat_4=25)]
        tag = _pssi_tag(raw, mood=2, bank=1)

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, _ = extract_phrases(ext)

        sp = entries[0].source_payload
        assert sp["mood"] == 2
        assert sp["bank"] == 1
        assert sp["kind"] == 3
        assert sp["beat"] == 5
        assert sp["beat_2"] == 10

    def test_parse_error_on_missing_content(self):
        ext = _make_asset("EXT")
        tag = MagicMock()
        tag.content = SimpleNamespace()  # no mood, bank, etc.

        with patch("dropdex_importer.phrase_parser.get_first_tag", return_value=tag):
            entries, warnings = extract_phrases(ext)

        codes = [w.code for w in warnings]
        assert "PHRASE_PARSE_ERROR" in codes
        assert entries == []
