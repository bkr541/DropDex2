"""Stage 2 canonical DB + ANLZ cue reconciliation regression coverage.

Tests the ANLZ-first canonical architecture: timestamp proximity is NOT used for
cue identity. Only slot-based re-matching of previously-merged hot cue rows
(source_anlz_present=True) is supported.
"""

from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
from typing import Any

from app.analysis_fast_pipeline import (
    CueReconciliationIntegrityError,
    ParsedTrack,
    _reconcile_cues_bulk,
)
from app.analysis_feature_writer import reconcile_and_write_cues
from dropdex_importer.cue_parser import AnlzCueEntry
from dropdex_importer.cue_reconciliation import (
    CueReconciliationPersistenceError,
    apply_cue_reconciliation_plan,
    build_cue_reconciliation_plan,
)
from dropdex_importer.reparse import _reconcile_cues


def anlz(
    *,
    family: str = "hot",
    slot: int | None = 1,
    start_ms: float = 1000.0,
    end_ms: float | None = None,
    point_type: str = "cue",
    active_loop: bool | None = None,
    color_id: int | None = None,
    color_hex: str | None = None,
    comment: str | None = None,
    loop_num: int | None = None,
    loop_den: int | None = None,
    source_tag: str = "PCO2",
    source_index: int = 0,
    asset_type: str = "EXT",
    tag_occurrence: int = 0,
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
        color_hex=color_hex,
        color_id=color_id,
        comment=comment,
        is_active_loop=active_loop,
        beat_loop_numerator=loop_num,
        beat_loop_denominator=loop_den,
        source_payload={
            "tag": source_tag,
            "asset_type": asset_type,
            "tag_occurrence": tag_occurrence,
            "src_idx": source_index,
            "hot_cue": 0 if family == "memory" else slot,
        },
    )


def db_cue(
    *,
    cue_id: str = "db-1",
    family: str = "memory",
    start_ms: float = 1000.0,
    end_ms: float | None = None,
    point_type: str = "cue",
    color_table_index: int | None = None,
    comment: str | None = "db-comment",
    source_anlz_present: bool = False,
    slot: int | None = None,
    active_loop: bool | None = None,
) -> dict[str, Any]:
    return {
        "id": cue_id,
        "import_id": "imp-1",
        "track_id": "track-1",
        "rekordbox_cue_id": f"rb-{cue_id}",
        "dedupe_key": f"db:{cue_id}",
        "cue_family": family,
        "cue_family_authority": "anlz" if source_anlz_present else "provisional",
        "hot_cue_slot": slot,
        "point_type": point_type,
        "source_kind": "4" if point_type == "loop" else "0",
        "start_usec": int(start_ms * 1000),
        "end_usec": int(end_ms * 1000) if end_ms is not None else None,
        "start_ms": start_ms,
        "end_ms": end_ms,
        "color_table_index": color_table_index,
        "color_hex": None,
        "color_name": "DB Color" if color_table_index else None,
        "comment": comment,
        "is_active_loop": (point_type == "loop") if active_loop is None else active_loop,
        "beat_loop_numerator": None,
        "beat_loop_denominator": None,
        "source_db_present": True,
        "source_anlz_present": source_anlz_present,
        "source_conflict": False,
        "source_payload": {
            "cue_id": f"rb-{cue_id}",
            "provisional_cue_family": family,
            "point_type": point_type,
            "start_ms": start_ms,
            "end_ms": end_ms,
        },
    }


def apply_plan(existing: list[dict[str, Any]], entries: list[AnlzCueEntry]) -> list[dict[str, Any]]:
    sb = FakeCueSb(existing)
    plan = build_cue_reconciliation_plan(
        sb.rows,
        entries,
        import_id="imp-1",
        track_id="track-1",
        tolerance_ms=0.0,
    )
    sb.apply_plan(plan)
    return sb.rows


class FakeCueSb:
    """Small in-memory Supabase surface used by all three production entry paths."""

    def __init__(self, rows: list[dict[str, Any]], *, fail_operations: set[str] | None = None):
        self.rows = deepcopy(rows)
        self.upsert_batches = 0
        self._next_id = 1
        self.fail_operations = set(fail_operations or set())

    def table(self, name: str):
        assert name == "rekordbox_cues"
        return FakeCueQuery(self)

    def apply_plan(self, plan) -> None:
        if plan.upsert_rows:
            FakeCueQuery(self).upsert(list(plan.upsert_rows), on_conflict="track_id,dedupe_key").execute()
        if plan.delete_ids:
            FakeCueQuery(self).delete().in_("id", list(plan.delete_ids)).execute()


class FakeCueQuery:
    def __init__(self, sb: FakeCueSb):
        self.sb = sb
        self.operation = "select"
        self.payload: Any = None
        self.filters: list[tuple[str, str, Any]] = []

    def select(self, *_args, **_kwargs):
        self.operation = "select"
        return self

    def eq(self, field: str, value: Any):
        self.filters.append(("eq", field, value))
        return self

    def in_(self, field: str, values: list[Any]):
        self.filters.append(("in", field, list(values)))
        return self

    def upsert(self, payload: Any, **_kwargs):
        self.operation = "upsert"
        self.payload = payload
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def _matches(self, row: dict[str, Any]) -> bool:
        for kind, field, value in self.filters:
            if kind == "eq" and row.get(field) != value:
                return False
            if kind == "in" and row.get(field) not in value:
                return False
        return True

    def execute(self):
        if self.operation in self.sb.fail_operations:
            raise RuntimeError(f"forced {self.operation} failure")
        if self.operation == "select":
            return SimpleNamespace(data=[deepcopy(row) for row in self.sb.rows if self._matches(row)])
        if self.operation == "delete":
            self.sb.rows = [row for row in self.sb.rows if not self._matches(row)]
            return SimpleNamespace(data=[])
        if self.operation == "upsert":
            self.sb.upsert_batches += 1
            payload = self.payload if isinstance(self.payload, list) else [self.payload]
            for incoming in deepcopy(payload):
                match = next(
                    (
                        row
                        for row in self.sb.rows
                        if row.get("track_id") == incoming.get("track_id")
                        and row.get("dedupe_key") == incoming.get("dedupe_key")
                    ),
                    None,
                )
                if match is None:
                    incoming.setdefault("id", f"generated-{self.sb._next_id}")
                    self.sb._next_id += 1
                    self.sb.rows.append(incoming)
                else:
                    match.update(incoming)
            return SimpleNamespace(data=[])
        raise AssertionError(f"unexpected operation {self.operation}")


def projection(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    fields = (
        "dedupe_key",
        "rekordbox_cue_id",
        "cue_family",
        "cue_family_authority",
        "hot_cue_slot",
        "point_type",
        "start_ms",
        "end_ms",
        "color_table_index",
        "color_hex",
        "comment",
        "is_active_loop",
        "beat_loop_numerator",
        "beat_loop_denominator",
        "source_db_present",
        "source_anlz_present",
        "source_conflict",
    )
    return sorted(
        [{field: row.get(field) for field in fields} for row in rows],
        key=lambda row: str(row["dedupe_key"]),
    )


class TestCanonicalAuthority:
    def test_anlz_entry_creates_anlz_row_when_no_db_match(self):
        """With no DB rows, ANLZ entry creates a new anlz: row."""
        rows = apply_plan([], [anlz(family="hot", slot=1, start_ms=1000.0)])
        assert len(rows) == 1
        row = rows[0]
        assert row["dedupe_key"].startswith("anlz:")
        assert row["cue_family"] == "hot"
        assert row["cue_family_authority"] == "anlz"
        assert row["hot_cue_slot"] == 1
        assert row["source_db_present"] is False
        assert row["source_anlz_present"] is True
        assert row["source_conflict"] is False
        assert row["rekordbox_cue_id"] is None

    def test_db_row_without_anlz_stays_db_only_when_no_slot_match(self):
        """DB row with source_anlz_present=False is not merged with any ANLZ entry."""
        rows = apply_plan(
            [db_cue(family="memory", comment="DB-only")],
            [anlz(family="hot", slot=1)],
        )
        # DB row stays unchanged; ANLZ entry creates its own new row.
        assert len(rows) == 2
        db_rows = [r for r in rows if r.get("source_db_present")]
        anlz_rows = [r for r in rows if not r.get("source_db_present")]
        assert len(db_rows) == 1
        assert len(anlz_rows) == 1
        assert db_rows[0]["comment"] == "DB-only"
        assert anlz_rows[0]["cue_family"] == "hot"

    def test_slot_based_rematch_merges_previously_merged_hot_row(self):
        """Previously ANLZ-merged hot cue row (source_anlz_present=True) re-merges via slot."""
        rows = apply_plan(
            [db_cue(family="hot", slot=1, source_anlz_present=True)],
            [anlz(family="hot", slot=1, start_ms=1000.0)],
        )
        assert len(rows) == 1
        row = rows[0]
        assert row["cue_family"] == "hot"
        assert row["hot_cue_slot"] == 1
        assert row["cue_family_authority"] == "anlz"
        assert row["source_db_present"] is True
        assert row["source_anlz_present"] is True
        assert row["source_conflict"] is False

    def test_anlz_only_loop_keeps_active_loop_unknown(self):
        """ANLZ-only loop cue does not fabricate an active_loop value."""
        rows = apply_plan([], [anlz(family="hot", slot=2, point_type="loop", end_ms=3000)])
        assert len(rows) == 1
        assert rows[0]["source_db_present"] is False
        assert rows[0]["is_active_loop"] is None

    def test_slot_based_merge_preserves_db_active_loop(self):
        """When slot-based merge fires, the DB is_active_loop value is preserved."""
        rows = apply_plan(
            [db_cue(family="hot", slot=1, point_type="loop", end_ms=3000, active_loop=True, source_anlz_present=True)],
            [anlz(family="hot", slot=1, point_type="loop", end_ms=3000, active_loop=None)],
        )
        assert rows[0]["point_type"] == "loop"
        assert rows[0]["is_active_loop"] is True

    def test_slot_based_merge_writes_anlz_color_hex(self):
        """Merged row gets color_hex from the ANLZ entry."""
        rows = apply_plan(
            [db_cue(family="hot", slot=1, color_table_index=3, source_anlz_present=True)],
            [anlz(family="hot", slot=1, color_id=6, color_hex="#0000FF")],
        )
        assert rows[0]["color_table_index"] == 3   # DB-owned; not overwritten
        assert rows[0]["color_hex"] == "#0000FF"   # ANLZ color_hex written

    def test_anlz_only_row_has_null_rekordbox_cue_id(self):
        """ANLZ-derived rows never have a fabricated rekordbox_cue_id."""
        rows = apply_plan([], [anlz(family="memory", slot=None, start_ms=2000.0)])
        assert rows[0]["rekordbox_cue_id"] is None

    def test_anlz_loop_fields_written_to_new_row(self):
        """Loop start/end and beat-loop ratio are persisted in ANLZ-only row."""
        rows = apply_plan(
            [],
            [anlz(family="hot", slot=1, point_type="loop", end_ms=4000.0, loop_num=8, loop_den=1)],
        )
        row = rows[0]
        assert row["point_type"] == "loop"
        assert row["end_ms"] == 4000.0
        assert row["beat_loop_numerator"] == 8
        assert row["beat_loop_denominator"] == 1

    def test_anlz_comment_written_to_new_row(self):
        rows = apply_plan([], [anlz(comment="intro", family="memory", slot=None)])
        assert rows[0]["comment"] == "intro"

    def test_stale_parser_row_deleted_on_rematch(self):
        """Old anlz:-keyed row that matches no current ANLZ entry is deleted."""
        stale = {
            "id": "stale-1",
            "import_id": "imp-1",
            "track_id": "track-1",
            "dedupe_key": "anlz:imp-1:EXT:PCO2:0:99",
            "cue_family": "hot",
            "cue_family_authority": "anlz",
            "hot_cue_slot": 5,
            "point_type": "cue",
            "start_ms": 9999.0,
            "end_ms": None,
            "source_db_present": False,
            "source_anlz_present": True,
            "source_conflict": False,
            "rekordbox_cue_id": None,
            "source_payload": {},
        }
        rows = apply_plan([stale], [anlz(family="hot", slot=1, start_ms=1000.0)])
        # Stale row deleted; new ANLZ row created for slot 1.
        assert len(rows) == 1
        assert rows[0]["dedupe_key"] != "anlz:imp-1:EXT:PCO2:0:99"

    def test_memory_cue_anlz_row_created_independently(self):
        """Memory cue ANLZ entries always create their own anlz: rows."""
        rows = apply_plan(
            [],
            [
                anlz(family="hot", slot=1, start_ms=1000.0, source_index=0),
                anlz(family="memory", slot=None, start_ms=1000.0, source_index=1),
            ],
        )
        assert len(rows) == 2
        families = {r["cue_family"] for r in rows}
        assert families == {"hot", "memory"}

    def test_slot_mismatch_does_not_merge_different_slots(self):
        """Slot-based match: DB slot=1 does not absorb ANLZ slot=2.

        The DB row (previously merged, slot=1) is restored to provisional state
        when slot=1 is no longer provided by the current ANLZ run.
        The ANLZ slot=2 creates its own new row.
        """
        rows = apply_plan(
            [db_cue(family="hot", slot=1, source_anlz_present=True)],
            [anlz(family="hot", slot=2)],
        )
        assert len(rows) == 2
        # ANLZ slot=2 row exists
        anlz_rows = [r for r in rows if r.get("dedupe_key", "").startswith("anlz:")]
        assert len(anlz_rows) == 1
        assert anlz_rows[0]["hot_cue_slot"] == 2
        # DB row was restored; not merged with slot=2
        db_rows = [r for r in rows if r.get("source_db_present")]
        assert not any(r.get("hot_cue_slot") == 2 for r in db_rows)


class TestDeterminismAndConflicts:
    def test_anlz_only_idempotent_across_two_runs(self):
        """Re-running with same ANLZ entries on existing anlz: rows is idempotent."""
        entry = anlz(family="hot", slot=1, start_ms=1000.0)
        first = apply_plan([], [entry])
        second = apply_plan(first, [entry])
        assert projection(second) == projection(first)
        assert len(second) == 1

    def test_input_order_does_not_change_anlz_output(self):
        """Same ANLZ entries in different order produce identical projection."""
        entries = [
            anlz(family="hot", slot=1, start_ms=1000.0, source_index=0),
            anlz(family="memory", slot=None, start_ms=2000.0, source_index=1),
        ]
        forward = apply_plan([], entries)
        reversed_inputs = apply_plan([], list(reversed(entries)))
        assert projection(forward) == projection(reversed_inputs)

    def test_two_different_anlz_entries_produce_two_rows(self):
        """Two ANLZ entries with different source_index produce two distinct rows."""
        rows = apply_plan(
            [],
            [
                anlz(family="hot", slot=1, start_ms=1000.0, source_index=0),
                anlz(family="hot", slot=2, start_ms=2000.0, source_index=1),
            ],
        )
        assert len(rows) == 2
        keys = {r["dedupe_key"] for r in rows}
        assert len(keys) == 2  # distinct dedupe keys

    def test_same_anlz_entry_idempotent_on_parser_row(self):
        """Running with the same entry against an existing anlz: row re-merges (idempotent)."""
        entry = anlz(family="hot", slot=1, start_ms=1000.0, comment="label")
        first = apply_plan([], [entry])
        assert first[0]["comment"] == "label"
        second = apply_plan(first, [entry])
        assert len(second) == 1
        assert second[0]["comment"] == "label"


class TestProductionPathParity:
    def test_initial_fast_and_reparse_produce_equivalent_rows(self):
        entries = [
            anlz(
                family="hot",
                slot=1,
                start_ms=1000,
                point_type="loop",
                end_ms=2000,
                active_loop=None,
                color_id=0,
                loop_num=4,
                loop_den=1,
            )
        ]

        normal = FakeCueSb([])
        result = reconcile_and_write_cues(normal, "imp-1", "track-1", entries, [])
        assert result.complete is True
        assert result.state == "complete"

        fast = FakeCueSb([])
        _reconcile_cues_bulk(
            fast,
            "imp-1",
            [
                ParsedTrack(
                    track={"id": "track-1"},
                    assets=[],
                    parse_status="completed",
                    cue_entries=entries,
                )
            ],
        )

        reparse = FakeCueSb([])
        _reconcile_cues(reparse, "imp-1", "track-1", entries, 0.0)

        assert projection(normal.rows) == projection(fast.rows) == projection(reparse.rows)
        # The fast route keeps the existing bulk write shape: one preload + one batch upsert.
        assert fast.upsert_batches == 1


class TestCuePersistenceIntegrity:
    def test_partial_delete_failure_is_structured_and_never_complete(self):
        stale = {
            "id": "stale",
            "import_id": "imp-1",
            "track_id": "track-1",
            "dedupe_key": "anlz:stale",
            "cue_family": "hot",
            "cue_family_authority": "anlz",
            "hot_cue_slot": 5,
            "point_type": "cue",
            "start_ms": 2000.0,
            "end_ms": None,
            "source_db_present": False,
            "source_anlz_present": True,
            "source_conflict": False,
            "rekordbox_cue_id": None,
            "source_payload": {},
        }
        existing = [
            db_cue(cue_id="keep", start_ms=1000),
            stale,
        ]
        plan = build_cue_reconciliation_plan(
            existing,
            [anlz(start_ms=1000)],
            import_id="imp-1",
            track_id="track-1",
            tolerance_ms=0.0,
        )
        assert plan.upsert_rows
        assert plan.delete_ids == ("stale",)

        sb = FakeCueSb(existing, fail_operations={"delete"})
        try:
            apply_cue_reconciliation_plan(sb, plan)
            raise AssertionError("expected CueReconciliationPersistenceError")
        except CueReconciliationPersistenceError as exc:
            assert exc.result.state == "partial"
            assert exc.result.complete is False
            assert exc.result.applied_upserts == len(plan.upsert_rows)
            assert exc.result.applied_deletes == 0

    def test_feature_writer_reports_partial_persistence_as_failed_result(self):
        stale = {
            "id": "stale",
            "import_id": "imp-1",
            "track_id": "track-1",
            "dedupe_key": "anlz:stale",
            "cue_family": "hot",
            "cue_family_authority": "anlz",
            "hot_cue_slot": 5,
            "point_type": "cue",
            "start_ms": 2000.0,
            "end_ms": None,
            "source_db_present": False,
            "source_anlz_present": True,
            "source_conflict": False,
            "rekordbox_cue_id": None,
            "source_payload": {},
        }
        existing = [
            db_cue(cue_id="keep", start_ms=1000),
            stale,
        ]
        sb = FakeCueSb(existing, fail_operations={"delete"})

        result = reconcile_and_write_cues(
            sb,
            "imp-1",
            "track-1",
            [anlz(start_ms=1000)],
            [],
        )

        assert result.complete is False
        assert result.state == "partial"
        assert result.applied_upserts > 0
        assert result.applied_deletes == 0

    def test_fast_path_preload_failure_propagates_instead_of_skipping_cues(self):
        sb = FakeCueSb([], fail_operations={"select"})
        parsed = ParsedTrack(
            track={"id": "track-1"},
            assets=[],
            parse_status="completed",
            cue_entries=[],
        )

        try:
            _reconcile_cues_bulk(sb, "imp-1", [parsed])
            raise AssertionError("expected preload failure to propagate")
        except CueReconciliationIntegrityError as exc:
            assert "baseline preload failed" in str(exc)
