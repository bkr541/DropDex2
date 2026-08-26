"""Stage 2 canonical DB + ANLZ cue reconciliation regression coverage."""

from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
from typing import Any

from app.analysis_fast_pipeline import ParsedTrack, _reconcile_cues_bulk
from app.analysis_feature_writer import reconcile_and_write_cues
from dropdex_importer.cue_parser import AnlzCueEntry, CUE_MATCH_TOLERANCE_MS
from dropdex_importer.cue_reconciliation import build_cue_reconciliation_plan
from dropdex_importer.reparse import _reconcile_cues


def anlz(
    *,
    family: str = "hot",
    slot: int | None = 1,
    start_ms: float = 1000.0,
    end_ms: float | None = None,
    point_type: str = "cue",
    active_loop: bool = False,
    color_id: int | None = None,
    color_hex: str | None = None,
    comment: str | None = None,
    loop_num: int | None = None,
    loop_den: int | None = None,
    source_tag: str = "PCO2",
    source_index: int = 0,
) -> AnlzCueEntry:
    return AnlzCueEntry(
        source_index=source_index,
        source_tag=source_tag,
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
        "is_active_loop": point_type == "loop",
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
        tolerance_ms=CUE_MATCH_TOLERANCE_MS,
    )
    sb.apply_plan(plan)
    return sb.rows


class FakeCueSb:
    """Small in-memory Supabase surface used by all three production entry paths."""

    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)
        self.upsert_batches = 0
        self._next_id = 1

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
    def test_provisional_memory_merges_into_authoritative_hot_a(self):
        rows = apply_plan(
            [db_cue(family="memory", color_table_index=0)],
            [anlz(family="hot", slot=1)],
        )
        assert len(rows) == 1
        row = rows[0]
        assert row["dedupe_key"] == "db:db-1"
        assert row["cue_family"] == "hot"
        assert row["cue_family_authority"] == "anlz"
        assert row["hot_cue_slot"] == 1
        assert row["source_db_present"] is True
        assert row["source_anlz_present"] is True
        assert row["source_conflict"] is False

    def test_provisional_hot_merges_into_authoritative_memory(self):
        rows = apply_plan(
            [db_cue(family="hot", color_table_index=3)],
            [anlz(family="memory", slot=None)],
        )
        assert len(rows) == 1
        assert rows[0]["cue_family"] == "memory"
        assert rows[0]["hot_cue_slot"] is None
        assert rows[0]["cue_family_authority"] == "anlz"

    def test_hot_h_with_zero_color_index_remains_hot(self):
        rows = apply_plan(
            [db_cue(family="memory", color_table_index=0)],
            [anlz(family="hot", slot=8, color_id=0)],
        )
        assert rows[0]["cue_family"] == "hot"
        assert rows[0]["hot_cue_slot"] == 8
        assert rows[0]["color_table_index"] == 0

    def test_anlz_owns_loop_type_timing_extent_and_active_loop(self):
        rows = apply_plan(
            [db_cue(family="memory", start_ms=1002, point_type="cue")],
            [
                anlz(
                    family="memory",
                    slot=None,
                    start_ms=1000,
                    end_ms=3000,
                    point_type="loop",
                    active_loop=True,
                    loop_num=8,
                    loop_den=1,
                )
            ],
        )
        row = rows[0]
        assert row["point_type"] == "loop"
        assert row["start_ms"] == 1000
        assert row["end_ms"] == 3000
        assert row["is_active_loop"] is True
        assert row["beat_loop_numerator"] == 8
        assert row["beat_loop_denominator"] == 1
        # Raw DB timing remains preserved as DB-only evidence.
        assert row["start_usec"] == 1_002_000

    def test_db_only_fields_survive_authoritative_merge(self):
        rows = apply_plan(
            [db_cue(comment="DB-only label")],
            [anlz(comment=None)],
        )
        assert rows[0]["rekordbox_cue_id"] == "rb-db-1"
        assert rows[0]["comment"] == "DB-only label"


class TestDeterminismAndConflicts:
    def test_reconciliation_is_idempotent_without_duplicates(self):
        first = apply_plan([db_cue()], [anlz(family="hot", slot=1)])
        second = apply_plan(first, [anlz(family="hot", slot=1)])
        assert projection(second) == projection(first)
        assert len(second) == 1

    def test_two_distinct_nearby_cues_remain_distinct(self):
        first = db_cue(cue_id="one", start_ms=1000)
        second = db_cue(cue_id="two", start_ms=1008)
        rows = apply_plan(
            [first, second],
            [
                anlz(family="hot", slot=1, start_ms=1000, source_index=0),
                anlz(family="memory", slot=None, start_ms=1008, source_index=1),
            ],
        )
        assert len(rows) == 2
        by_key = {row["dedupe_key"]: row for row in rows}
        assert by_key["db:one"]["start_ms"] == 1000
        assert by_key["db:two"]["start_ms"] == 1008
        assert {row["cue_family"] for row in rows} == {"hot", "memory"}

    def test_equal_timing_ambiguity_becomes_explicit_conflict(self):
        rows = apply_plan(
            [db_cue(cue_id="one", start_ms=1000), db_cue(cue_id="two", start_ms=1000)],
            [anlz(family="hot", slot=1, start_ms=1000)],
        )
        assert len(rows) == 3
        assert all(row["source_conflict"] for row in rows)
        anlz_only = next(row for row in rows if row["dedupe_key"].startswith("anlz:"))
        conflict = anlz_only["source_payload"]["_dropdex_cue_reconciliation"]["conflict"]
        assert conflict["reason"] == "ambiguous_db_timing_match"
        assert conflict["candidate_ids"] == ["one", "two"]

    def test_input_order_does_not_change_output(self):
        existing = [db_cue(cue_id="one", start_ms=1000), db_cue(cue_id="two", start_ms=1200)]
        entries = [
            anlz(family="hot", slot=1, start_ms=1000, source_index=0),
            anlz(family="memory", slot=None, start_ms=1200, source_index=1),
        ]
        forward = apply_plan(existing, entries)
        reversed_inputs = apply_plan(list(reversed(existing)), list(reversed(entries)))
        assert projection(forward) == projection(reversed_inputs)


class TestProductionPathParity:
    def test_initial_fast_and_reparse_produce_equivalent_rows(self):
        existing = [db_cue(family="memory", color_table_index=0)]
        entries = [
            anlz(
                family="hot",
                slot=1,
                start_ms=1000,
                point_type="loop",
                end_ms=2000,
                active_loop=True,
                color_id=0,
                loop_num=4,
                loop_den=1,
            )
        ]

        normal = FakeCueSb(existing)
        assert reconcile_and_write_cues(normal, "imp-1", "track-1", entries, []) is True

        fast = FakeCueSb(existing)
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

        reparse = FakeCueSb(existing)
        _reconcile_cues(reparse, "imp-1", "track-1", entries, CUE_MATCH_TOLERANCE_MS)

        assert projection(normal.rows) == projection(fast.rows) == projection(reparse.rows)
        # The fast route keeps the existing bulk write shape: one preload + one batch upsert.
        assert fast.upsert_batches == 1
