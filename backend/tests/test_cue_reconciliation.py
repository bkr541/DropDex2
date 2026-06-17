"""
Tests for cue reconciliation logic in analysis_feature_writer.

Specifically covers _find_db_match hot-cue slot matching when the DB row
has hot_cue_slot=None (library import didn't store the slot letter).

To run:
    cd backend
    pytest tests/test_cue_reconciliation.py -v
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock

import pytest

from app.analysis_feature_writer import _find_db_match, reconcile_and_write_cues

# Tolerance used by the real cue_parser; we replicate it here for tests.
CUE_MATCH_TOLERANCE_MS = 3.0


# ── Minimal AnlzCueEntry stub ─────────────────────────────────────────────────

def _anlz_entry(
    *,
    cue_family: str = "hot",
    hot_cue_slot: Optional[int] = 0,
    start_ms: float = 1000.0,
    color_hex: Optional[str] = None,
    color_id: Optional[int] = None,
    comment: Optional[str] = None,
    beat_loop_numerator: Optional[int] = None,
    beat_loop_denominator: Optional[int] = None,
    point_type: str = "cue",
    end_ms: Optional[float] = None,
    is_active_loop: bool = False,
    source_tag: str = "DAT",
    source_index: int = 0,
    source_payload: Dict[str, Any] = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        cue_family=cue_family,
        hot_cue_slot=hot_cue_slot,
        start_ms=start_ms,
        color_hex=color_hex,
        color_id=color_id,
        comment=comment,
        beat_loop_numerator=beat_loop_numerator,
        beat_loop_denominator=beat_loop_denominator,
        point_type=point_type,
        end_ms=end_ms,
        is_active_loop=is_active_loop,
        source_tag=source_tag,
        source_index=source_index,
        source_payload=source_payload or {},
    )


def _db_cue(
    *,
    id: str = "db-cue-uuid-001",
    cue_family: str = "hot",
    hot_cue_slot: Optional[int] = None,
    start_ms: float = 1000.0,
) -> Dict[str, Any]:
    return {
        "id": id,
        "cue_family": cue_family,
        "hot_cue_slot": hot_cue_slot,
        "start_ms": start_ms,
    }


# ── _find_db_match unit tests ─────────────────────────────────────────────────

class TestFindDbMatchNullSlot:
    def test_null_slot_db_cue_matches_anlz_hot_cue(self):
        """
        DB hot cue with hot_cue_slot=None should match an ANLZ hot cue with
        hot_cue_slot=0 (A), because the ANLZ enriches the DB entry.
        """
        anlz = _anlz_entry(cue_family="hot", hot_cue_slot=0, start_ms=1000.0)
        existing = [_db_cue(cue_family="hot", hot_cue_slot=None, start_ms=1000.0)]

        match = _find_db_match(anlz, existing, set(), CUE_MATCH_TOLERANCE_MS)

        assert match is not None, "DB cue with slot=None should match ANLZ cue with slot=0"
        assert match["id"] == "db-cue-uuid-001"

    def test_known_slot_mismatch_does_not_match(self):
        """
        DB hot cue with hot_cue_slot=0 must NOT match ANLZ with hot_cue_slot=1
        — these are different letter slots (A vs B).
        """
        anlz = _anlz_entry(cue_family="hot", hot_cue_slot=1, start_ms=1000.0)
        existing = [_db_cue(cue_family="hot", hot_cue_slot=0, start_ms=1000.0)]

        match = _find_db_match(anlz, existing, set(), CUE_MATCH_TOLERANCE_MS)

        assert match is None, "Different known slots must not match"

    def test_same_known_slot_matches(self):
        """
        DB hot cue with hot_cue_slot=1 should match ANLZ with hot_cue_slot=1
        when timing is within tolerance.
        """
        anlz = _anlz_entry(cue_family="hot", hot_cue_slot=1, start_ms=1000.0)
        existing = [_db_cue(cue_family="hot", hot_cue_slot=1, start_ms=1001.0)]

        match = _find_db_match(anlz, existing, set(), CUE_MATCH_TOLERANCE_MS)

        assert match is not None, "Same known slots within tolerance must match"
        assert match["id"] == "db-cue-uuid-001"

    def test_null_slot_outside_tolerance_does_not_match(self):
        """Even when DB slot is None, timing must be within tolerance."""
        anlz = _anlz_entry(cue_family="hot", hot_cue_slot=0, start_ms=1000.0)
        existing = [_db_cue(cue_family="hot", hot_cue_slot=None, start_ms=2000.0)]

        match = _find_db_match(anlz, existing, set(), CUE_MATCH_TOLERANCE_MS)

        assert match is None, "Timing mismatch must prevent a match even when slot is None"

    def test_already_matched_id_skipped(self):
        """A DB cue already in already_matched set must be skipped."""
        anlz = _anlz_entry(cue_family="hot", hot_cue_slot=None, start_ms=1000.0)
        existing = [_db_cue(id="db-cue-uuid-001", cue_family="hot", hot_cue_slot=None, start_ms=1000.0)]

        match = _find_db_match(anlz, existing, {"db-cue-uuid-001"}, CUE_MATCH_TOLERANCE_MS)

        assert match is None, "Already-matched DB cue must not be returned again"

    def test_memory_cue_matches_by_timing_only(self):
        """Memory cues (cue_family=memory) match on timing, not slot."""
        anlz = _anlz_entry(cue_family="memory", hot_cue_slot=None, start_ms=5000.0)
        existing = [_db_cue(cue_family="memory", hot_cue_slot=None, start_ms=5001.5)]

        match = _find_db_match(anlz, existing, set(), CUE_MATCH_TOLERANCE_MS)

        assert match is not None


# ── reconcile_and_write_cues integration tests ────────────────────────────────

class _FakeSbCues:
    """Minimal fake Supabase client that records cue table operations."""

    def __init__(self, existing_cues: List[Dict[str, Any]]):
        self._cues = existing_cues
        self.updates: List[Dict[str, Any]] = []   # (id, update_dict) tuples
        self.inserts: List[Dict[str, Any]] = []

    def table(self, name: str) -> "_FakeCueProxy":
        return _FakeCueProxy(self, name)


class _FakeCueProxy:
    def __init__(self, sb: _FakeSbCues, table_name: str):
        self._sb = sb
        self._table = table_name
        self._op: Optional[str] = None
        self._data: Any = None
        self._filter_col: Optional[str] = None
        self._filter_val: Any = None

    def select(self, *a, **k):
        return self

    def eq(self, col, val):
        self._filter_col = col
        self._filter_val = val
        return self

    def update(self, data, **k):
        self._op = "update"
        self._data = data
        return self

    def insert(self, data, **k):
        self._op = "insert"
        self._data = data
        return self

    def execute(self):
        if self._op == "update":
            self._sb.updates.append({"filter_val": self._filter_val, "data": self._data})
            return SimpleNamespace(data=[])
        if self._op == "insert":
            self._sb.inserts.append(self._data)
            return SimpleNamespace(data=[])
        # select
        return SimpleNamespace(data=self._sb._cues)


class TestReconcileAndWriteCues:
    def test_null_slot_db_cue_updated_with_anlz_slot(self):
        """
        When the DB cue has hot_cue_slot=None and ANLZ has slot=0,
        reconcile_and_write_cues should UPDATE the row (not insert a duplicate)
        and the update payload must include hot_cue_slot=0.
        """
        existing = [_db_cue(id="cue-001", cue_family="hot", hot_cue_slot=None, start_ms=1000.0)]
        anlz_entries = [_anlz_entry(cue_family="hot", hot_cue_slot=0, start_ms=1000.0)]

        sb = _FakeSbCues(existing_cues=existing)
        result = reconcile_and_write_cues(
            sb, import_id="imp-001", track_id="trk-001",
            anlz_entries=anlz_entries, warnings=[],
        )

        assert result is True
        # Must have updated, not inserted
        assert len(sb.updates) == 1, "Expected one update, got: " + str(sb.updates)
        assert len(sb.inserts) == 0, "Expected no new inserts (no duplicate), got: " + str(sb.inserts)
        # Slot must be enriched in the update
        update_data = sb.updates[0]["data"]
        assert update_data.get("hot_cue_slot") == 0, f"Expected slot=0 in update, got: {update_data}"
        assert update_data.get("source_anlz_present") is True

    def test_known_slot_mismatch_inserts_new_row(self):
        """
        When DB has slot=0 and ANLZ has slot=1, no match occurs.
        ANLZ entry must be inserted as a new row (source_db_present=False).
        """
        existing = [_db_cue(id="cue-002", cue_family="hot", hot_cue_slot=0, start_ms=1000.0)]
        anlz_entries = [_anlz_entry(cue_family="hot", hot_cue_slot=1, start_ms=1000.0)]

        sb = _FakeSbCues(existing_cues=existing)
        result = reconcile_and_write_cues(
            sb, import_id="imp-001", track_id="trk-001",
            anlz_entries=anlz_entries, warnings=[],
        )

        assert result is True
        assert len(sb.updates) == 0, "Mismatched slots must not update existing row"
        assert len(sb.inserts) == 1, "Unmatched ANLZ entry must be inserted"
        inserted = sb.inserts[0]
        assert inserted["source_db_present"] is False
        assert inserted["source_anlz_present"] is True
        assert inserted["hot_cue_slot"] == 1

    def test_same_known_slot_matches_and_updates(self):
        """
        When DB slot=1 and ANLZ slot=1, they match.
        The existing row is updated with source_anlz_present=True.
        """
        existing = [_db_cue(id="cue-003", cue_family="hot", hot_cue_slot=1, start_ms=2000.0)]
        anlz_entries = [_anlz_entry(cue_family="hot", hot_cue_slot=1, start_ms=2000.5)]

        sb = _FakeSbCues(existing_cues=existing)
        result = reconcile_and_write_cues(
            sb, import_id="imp-001", track_id="trk-001",
            anlz_entries=anlz_entries, warnings=[],
        )

        assert result is True
        assert len(sb.updates) == 1
        assert len(sb.inserts) == 0
        update_data = sb.updates[0]["data"]
        assert update_data.get("source_anlz_present") is True
        assert update_data.get("hot_cue_slot") == 1
