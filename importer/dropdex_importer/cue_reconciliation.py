"""Canonical Rekordbox DB + ANLZ cue reconciliation.

This module owns source matching and field authority for normalized imported cues.
Callers may preload rows in bulk, but they must not reimplement matching or merge
rules. Device Library Plus DB cue-family classification is provisional; parsed
ANLZ PCOB/PCO2 semantics are authoritative for the fields they encode.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

_RECONCILIATION_KEY = "_dropdex_cue_reconciliation"
_CUE_TABLE = "rekordbox_cues"
_SERVER_MANAGED_FIELDS = frozenset({"id", "created_at", "updated_at"})


@dataclass(frozen=True)
class CueReconciliationPlan:
    """Persistence operations produced by canonical cue reconciliation."""

    upsert_rows: tuple[dict[str, Any], ...]
    delete_ids: tuple[str, ...]


@dataclass(frozen=True)
class CueReconciliationApplyResult:
    """Observed persistence outcome for one canonical reconciliation plan."""

    state: str
    planned_upserts: int
    planned_deletes: int
    applied_upserts: int
    applied_deletes: int
    error: str | None = None

    @property
    def complete(self) -> bool:
        return self.state == "complete"


class CueReconciliationPersistenceError(RuntimeError):
    """Canonical cue persistence failed before the full plan was committed."""

    def __init__(self, result: CueReconciliationApplyResult) -> None:
        super().__init__(result.error or "Cue reconciliation persistence failed.")
        self.result = result


def _persistable_row(row: Mapping[str, Any]) -> dict[str, Any]:
    """Strip server-owned columns before an upsert on the semantic dedupe key."""
    return {key: value for key, value in row.items() if key not in _SERVER_MANAGED_FIELDS}


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _entry_sort_key(entry: Any) -> tuple[Any, ...]:
    start_ms = _as_float(getattr(entry, "start_ms", None))
    return (
        start_ms if start_ms is not None else float("inf"),
        str(getattr(entry, "cue_family", "")),
        int(getattr(entry, "hot_cue_slot", 0) or 0),
        str(getattr(entry, "source_tag", "")),
        int(getattr(entry, "source_index", 0)),
    )


def _row_sort_key(row: Mapping[str, Any]) -> tuple[Any, ...]:
    start_ms = _as_float(row.get("start_ms"))
    return (
        start_ms if start_ms is not None else float("inf"),
        str(row.get("dedupe_key") or ""),
        str(row.get("id") or ""),
    )


def _anlz_key(import_id: str, entry: Any) -> str:
    return f"anlz:{import_id}:{entry.source_tag}:{entry.source_index}"


def _anlz_evidence(entry: Any) -> dict[str, Any]:
    payload = dict(getattr(entry, "source_payload", None) or {})
    payload["source_tag"] = str(entry.source_tag)
    payload["source_index"] = int(entry.source_index)
    return {
        "cue_family": str(entry.cue_family),
        "hot_cue_slot": entry.hot_cue_slot,
        "point_type": str(entry.point_type),
        "start_ms": float(entry.start_ms),
        "end_ms": entry.end_ms,
        "is_active_loop": bool(entry.is_active_loop),
        "color_id": entry.color_id,
        "color_hex": entry.color_hex,
        "comment": entry.comment,
        "beat_loop_numerator": entry.beat_loop_numerator,
        "beat_loop_denominator": entry.beat_loop_denominator,
        "source": payload,
    }


def _existing_payload(row: Mapping[str, Any]) -> dict[str, Any]:
    payload = row.get("source_payload")
    return dict(payload) if isinstance(payload, Mapping) else {}


def _db_evidence(row: Mapping[str, Any]) -> dict[str, Any] | None:
    if not row.get("source_db_present"):
        return None
    payload = _existing_payload(row)
    previous = payload.get(_RECONCILIATION_KEY)
    if isinstance(previous, Mapping):
        previous_db = previous.get("db")
        if isinstance(previous_db, Mapping):
            return dict(previous_db)

    # Fresh Stage 2 DB rows retain their provisional evidence in source_payload
    # before ANLZ is allowed to overwrite normalized semantic fields.
    if "provisional_cue_family" in payload:
        return {
            "provisional_cue_family": payload.get("provisional_cue_family"),
            "point_type": payload.get("point_type", row.get("point_type")),
            "start_ms": payload.get("start_ms", row.get("start_ms")),
            "end_ms": payload.get("end_ms", row.get("end_ms")),
            "is_active_loop": row.get("is_active_loop"),
            "color_table_index": row.get("color_table_index"),
            "color_hex": row.get("color_hex"),
            "color_name": row.get("color_name"),
            "comment": row.get("comment"),
            "beat_loop_numerator": row.get("beat_loop_numerator"),
            "beat_loop_denominator": row.get("beat_loop_denominator"),
        }

    # A pre-Stage-2 row that was already ANLZ-merged did not retain a canonical
    # DB baseline. Treat that evidence as unavailable instead of reverse-guessing
    # it from color or from fields ANLZ may already have changed.
    if row.get("source_anlz_present"):
        return None

    return {
        "provisional_cue_family": row.get("cue_family"),
        "point_type": row.get("point_type"),
        "start_ms": row.get("start_ms"),
        "end_ms": row.get("end_ms"),
        "is_active_loop": row.get("is_active_loop"),
        "color_table_index": row.get("color_table_index"),
        "color_hex": row.get("color_hex"),
        "color_name": row.get("color_name"),
        "comment": row.get("comment"),
        "beat_loop_numerator": row.get("beat_loop_numerator"),
        "beat_loop_denominator": row.get("beat_loop_denominator"),
    }


def _payload_with_reconciliation(
    row: Mapping[str, Any],
    entry: Any,
    *,
    conflict: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    payload = _existing_payload(row)
    previous = payload.pop(_RECONCILIATION_KEY, None)
    previous_db = None
    if isinstance(previous, Mapping) and isinstance(previous.get("db"), Mapping):
        previous_db = dict(previous["db"])
    payload[_RECONCILIATION_KEY] = {
        "db": previous_db if previous_db is not None else _db_evidence(row),
        "anlz": _anlz_evidence(entry),
        "authority": "anlz",
        "conflict": dict(conflict) if conflict is not None else None,
    }
    return payload


def _mark_conflict_payload(
    row: Mapping[str, Any], entry: Any, reason: str, candidate_ids: Sequence[str]
) -> dict[str, Any]:
    return _payload_with_reconciliation(
        row,
        entry,
        conflict={
            "reason": reason,
            "candidate_ids": list(candidate_ids),
        },
    )


def _parser_owned(row: Mapping[str, Any]) -> bool:
    # The anlz: dedupe namespace is reserved for parser-created rows. Older
    # normal-analysis code did not always persist source_kind, so requiring a
    # PCO* source label would leave those legacy parser rows stale forever.
    return (
        not row.get("source_db_present")
        and str(row.get("dedupe_key") or "").startswith("anlz:")
    )


def _candidate_rows(
    entry: Any,
    rows: Sequence[dict[str, Any]],
    matched_ids: set[str],
    tolerance_ms: float,
) -> list[tuple[tuple[int, float], dict[str, Any]]]:
    candidates: list[tuple[tuple[int, float], dict[str, Any]]] = []
    entry_ms = float(entry.start_ms)

    for row in rows:
        row_id = str(row.get("id") or "")
        if not row_id or row_id in matched_ids or not row.get("source_db_present"):
            continue

        row_ms = _as_float(row.get("start_ms"))
        row_slot = row.get("hot_cue_slot")
        row_has_anlz = bool(row.get("source_anlz_present"))

        # A previously ANLZ-identified Hot slot is a strong source identity. It
        # can survive a timing correction, but a different known Hot slot is a
        # distinct cue and must not be stolen by timing proximity.
        if entry.cue_family == "hot" and row_has_anlz and row_slot is not None:
            if int(row_slot) == int(entry.hot_cue_slot or 0):
                delta = abs(row_ms - entry_ms) if row_ms is not None else float("inf")
                candidates.append(((0, delta), row))
            continue

        if row_ms is None:
            continue
        delta = abs(row_ms - entry_ms)
        if delta <= tolerance_ms:
            candidates.append(((1, delta), row))

    return candidates


def _choose_candidate(
    entry: Any,
    rows: Sequence[dict[str, Any]],
    matched_ids: set[str],
    tolerance_ms: float,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    candidates = _candidate_rows(entry, rows, matched_ids, tolerance_ms)
    if not candidates:
        return None, []

    candidates.sort(key=lambda item: (item[0], _row_sort_key(item[1])))
    best_score = candidates[0][0]
    equally_best = [row for score, row in candidates if score == best_score]
    if len(equally_best) > 1:
        return None, equally_best
    return candidates[0][1], []


def _merge_anlz(row: Mapping[str, Any], entry: Any) -> dict[str, Any]:
    merged = dict(row)
    merged.update(
        {
            "cue_family": entry.cue_family,
            "cue_family_authority": "anlz",
            "hot_cue_slot": entry.hot_cue_slot,
            "point_type": entry.point_type,
            "source_kind": entry.source_tag,
            "start_ms": entry.start_ms,
            "end_ms": entry.end_ms,
            "is_active_loop": entry.is_active_loop,
            "source_anlz_present": True,
            "source_conflict": False,
        }
    )
    if entry.color_hex is not None:
        merged["color_hex"] = entry.color_hex
    if entry.color_id is not None:
        merged["color_table_index"] = entry.color_id
    if entry.comment is not None:
        merged["comment"] = entry.comment
    if entry.beat_loop_numerator is not None:
        merged["beat_loop_numerator"] = entry.beat_loop_numerator
    if entry.beat_loop_denominator is not None:
        merged["beat_loop_denominator"] = entry.beat_loop_denominator
    merged["source_payload"] = _payload_with_reconciliation(row, entry)
    return merged


def _new_anlz_row(
    import_id: str,
    track_id: str,
    entry: Any,
    *,
    conflict: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    seed = {
        "import_id": import_id,
        "track_id": track_id,
        "dedupe_key": _anlz_key(import_id, entry),
        "rekordbox_cue_id": None,
        "cue_family": entry.cue_family,
        "cue_family_authority": "anlz",
        "hot_cue_slot": entry.hot_cue_slot,
        "point_type": entry.point_type,
        "source_kind": entry.source_tag,
        "start_ms": entry.start_ms,
        "end_ms": entry.end_ms,
        "color_hex": entry.color_hex,
        "color_table_index": entry.color_id,
        "comment": entry.comment,
        "is_active_loop": entry.is_active_loop,
        "beat_loop_numerator": entry.beat_loop_numerator,
        "beat_loop_denominator": entry.beat_loop_denominator,
        "source_db_present": False,
        "source_anlz_present": True,
        "source_conflict": conflict is not None,
        "source_payload": {},
    }
    seed["source_payload"] = _payload_with_reconciliation(seed, entry, conflict=conflict)
    return seed


def _restore_db_only(row: Mapping[str, Any]) -> dict[str, Any]:
    restored = dict(row)
    payload = _existing_payload(row)
    reconciliation = payload.get(_RECONCILIATION_KEY)
    db = reconciliation.get("db") if isinstance(reconciliation, Mapping) else None

    restored["source_anlz_present"] = False
    restored["cue_family_authority"] = "provisional"
    restored["hot_cue_slot"] = None

    if isinstance(db, Mapping):
        field_map = {
            "provisional_cue_family": "cue_family",
            "point_type": "point_type",
            "start_ms": "start_ms",
            "end_ms": "end_ms",
            "is_active_loop": "is_active_loop",
            "color_table_index": "color_table_index",
            "color_hex": "color_hex",
            "color_name": "color_name",
            "comment": "comment",
            "beat_loop_numerator": "beat_loop_numerator",
            "beat_loop_denominator": "beat_loop_denominator",
        }
        for source_field, target_field in field_map.items():
            if source_field in db:
                restored[target_field] = db[source_field]
        restored["source_conflict"] = False
        payload[_RECONCILIATION_KEY] = {
            "db": dict(db),
            "anlz": None,
            "authority": "provisional",
            "conflict": None,
        }
    else:
        # Legacy merged rows did not retain a canonical DB baseline. Clearing
        # ANLZ authority is safe, but guessing the lost DB family is not.
        restored["source_conflict"] = True
        payload[_RECONCILIATION_KEY] = {
            "db": None,
            "anlz": None,
            "authority": "provisional",
            "conflict": {"reason": "anlz_removed_legacy_db_baseline_unrecoverable"},
        }
    restored["source_payload"] = payload
    return restored


def build_cue_reconciliation_plan(
    existing_rows: Iterable[Mapping[str, Any]],
    anlz_entries: Iterable[Any],
    *,
    import_id: str,
    track_id: str,
    tolerance_ms: float,
) -> CueReconciliationPlan:
    """Return deterministic persistence operations for one track.

    DB cue-family labels are deliberately ignored for candidate matching because
    they are provisional. ANLZ owns family/slot/type/timing/loop semantics. A
    timing tie between multiple DB-owned rows is explicit conflict state rather
    than an arbitrary merge.
    """

    originals = [dict(row) for row in existing_rows]
    originals.sort(key=_row_sort_key)
    working = {str(row["id"]): dict(row) for row in originals if row.get("id")}
    original_by_id = {str(row["id"]): dict(row) for row in originals if row.get("id")}
    changed_ids: set[str] = set()
    matched_ids: set[str] = set()
    current_parser_ids: set[str] = set()
    inserts: dict[str, dict[str, Any]] = {}

    parser_rows_by_key = {
        str(row.get("dedupe_key")): row
        for row in originals
        if row.get("id") and _parser_owned(row)
    }

    for entry in sorted(list(anlz_entries), key=_entry_sort_key):
        anlz_key = _anlz_key(import_id, entry)
        match, ambiguous = _choose_candidate(
            entry, list(working.values()), matched_ids, tolerance_ms
        )

        if ambiguous:
            candidate_ids = sorted(str(row["id"]) for row in ambiguous)
            conflict = {
                "reason": "ambiguous_db_timing_match",
                "candidate_ids": candidate_ids,
            }
            for candidate in ambiguous:
                candidate_id = str(candidate["id"])
                updated = dict(working[candidate_id])
                updated["source_conflict"] = True
                updated["source_payload"] = _mark_conflict_payload(
                    updated, entry, conflict["reason"], candidate_ids
                )
                working[candidate_id] = updated
                changed_ids.add(candidate_id)

            parser_row = parser_rows_by_key.get(anlz_key)
            if parser_row is not None:
                parser_id = str(parser_row["id"])
                updated = _merge_anlz(working[parser_id], entry)
                updated["source_conflict"] = True
                updated["source_payload"] = _payload_with_reconciliation(
                    updated, entry, conflict=conflict
                )
                working[parser_id] = updated
                changed_ids.add(parser_id)
                current_parser_ids.add(parser_id)
            else:
                inserts[anlz_key] = _new_anlz_row(
                    import_id, track_id, entry, conflict=conflict
                )
            continue

        if match is not None:
            match_id = str(match["id"])
            working[match_id] = _merge_anlz(working[match_id], entry)
            matched_ids.add(match_id)
            changed_ids.add(match_id)
            continue

        parser_row = parser_rows_by_key.get(anlz_key)
        if parser_row is not None:
            parser_id = str(parser_row["id"])
            working[parser_id] = _merge_anlz(working[parser_id], entry)
            matched_ids.add(parser_id)
            current_parser_ids.add(parser_id)
            changed_ids.add(parser_id)
            continue

        inserts[anlz_key] = _new_anlz_row(import_id, track_id, entry)

    delete_ids: list[str] = []
    for original in originals:
        row_id = str(original.get("id") or "")
        if not row_id or row_id in matched_ids or row_id in current_parser_ids:
            continue
        current = working[row_id]
        if not current.get("source_anlz_present"):
            continue
        if _parser_owned(current):
            delete_ids.append(row_id)
            changed_ids.discard(row_id)
        elif current.get("source_db_present"):
            working[row_id] = _restore_db_only(current)
            changed_ids.add(row_id)

    # If a formerly duplicated parser-only row represents an entry that merged
    # into a DB row this run, it is stale and is deleted by the loop above.
    changed_rows = [working[row_id] for row_id in sorted(changed_ids) if row_id not in delete_ids]
    insert_rows = [inserts[key] for key in sorted(inserts)]

    # Do not churn rows whose semantic state is already identical. Supabase may
    # include timestamps in selected rows; direct dict equality remains stable
    # because we only replace rows that the planner intentionally touched.
    effective_updates = [
        _persistable_row(row)
        for row in changed_rows
        if row != original_by_id.get(str(row.get("id")))
    ]

    return CueReconciliationPlan(
        upsert_rows=tuple(effective_updates + [_persistable_row(row) for row in insert_rows]),
        delete_ids=tuple(sorted(delete_ids)),
    )


def apply_cue_reconciliation_plan(
    sb: Any, plan: CueReconciliationPlan
) -> CueReconciliationApplyResult:
    """Apply a canonical plan and preserve complete/partial/failed semantics.

    Supabase/PostgREST does not give this path a cross-request transaction for the
    upsert + stale-row delete pair. If the second mutation fails after the first
    succeeded, the caller must know the baseline is partial and non-authoritative;
    it must never continue as though reconciliation completed successfully.
    """

    planned_upserts = len(plan.upsert_rows)
    planned_deletes = len(plan.delete_ids)
    applied_upserts = 0
    applied_deletes = 0

    if plan.upsert_rows:
        try:
            sb.table(_CUE_TABLE).upsert(
                list(plan.upsert_rows), on_conflict="track_id,dedupe_key"
            ).execute()
            applied_upserts = planned_upserts
        except Exception as exc:
            result = CueReconciliationApplyResult(
                state="failed",
                planned_upserts=planned_upserts,
                planned_deletes=planned_deletes,
                applied_upserts=0,
                applied_deletes=0,
                error=f"Cue reconciliation upsert failed ({type(exc).__name__}).",
            )
            raise CueReconciliationPersistenceError(result) from exc

    if plan.delete_ids:
        try:
            sb.table(_CUE_TABLE).delete().in_("id", list(plan.delete_ids)).execute()
            applied_deletes = planned_deletes
        except Exception as exc:
            result = CueReconciliationApplyResult(
                state="partial" if applied_upserts > 0 else "failed",
                planned_upserts=planned_upserts,
                planned_deletes=planned_deletes,
                applied_upserts=applied_upserts,
                applied_deletes=0,
                error=f"Cue reconciliation delete failed ({type(exc).__name__}).",
            )
            raise CueReconciliationPersistenceError(result) from exc

    return CueReconciliationApplyResult(
        state="complete",
        planned_upserts=planned_upserts,
        planned_deletes=planned_deletes,
        applied_upserts=applied_upserts,
        applied_deletes=applied_deletes,
    )
