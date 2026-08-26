"""Deterministic current-local vs desired Rekordbox cue diffing for apply preflight.

The diff is informational safety evidence only. It consumes the same read-only
DjmdCue snapshot and the same validated writer plan used by apply preflight and
never mutates either side.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Sequence, Tuple

from .djmdcue_policy import (
    find_matching_desired_for_preservation,
    nondefault_preserved_fields,
    preservation_blocker,
)
from .writer import HOT_KIND_BY_SLOT, build_djmdcue_values
from .writer_models import PlannedCue

_SLOT_BY_HOT_KIND = {kind: slot for slot, kind in HOT_KIND_BY_SLOT.items()}


@dataclass(frozen=True)
class CueDiffCue:
    identity: Optional[str]
    family: str
    hot_cue_slot: Optional[int]
    point_type: str
    start_ms: int
    end_ms: Optional[int]
    color: Optional[int]
    color_table_index: Optional[int]
    comment: Optional[str]
    is_active_loop: Optional[bool]


@dataclass(frozen=True)
class CueDiffChange:
    before: CueDiffCue
    after: CueDiffCue
    match_basis: str
    changes: Tuple[str, ...]


@dataclass(frozen=True)
class CueTrackDiff:
    current_count: int
    desired_count: int
    added: Tuple[CueDiffCue, ...]
    removed: Tuple[CueDiffCue, ...]
    changed: Tuple[CueDiffChange, ...]
    conflicts: Tuple[str, ...] = ()
    blocking: bool = False


def _nullable_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _cue_sort_key(cue: CueDiffCue) -> tuple[Any, ...]:
    return (
        cue.start_ms,
        cue.end_ms if cue.end_ms is not None else -1,
        cue.family,
        cue.hot_cue_slot if cue.hot_cue_slot is not None else 99,
        cue.point_type,
        cue.identity or "",
        cue.comment or "",
        cue.color if cue.color is not None else -999,
        cue.color_table_index if cue.color_table_index is not None else -999,
    )


def _current_cue(row: Any) -> tuple[CueDiffCue, Optional[str]]:
    kind = _nullable_int(getattr(row, "Kind", None))
    if kind in _SLOT_BY_HOT_KIND:
        family = "hot"
        slot = _SLOT_BY_HOT_KIND[kind]
        conflict = None
    elif kind == 0:
        family = "memory"
        slot = None
        conflict = None
    else:
        family = "unknown"
        slot = None
        conflict = f"Current local cue {getattr(row, 'ID', '?')} has unsupported Rekordbox Kind {kind!r}."

    start_ms = _nullable_int(getattr(row, "InMsec", None))
    if start_ms is None or start_ms < 0:
        start_ms = -1
        conflict = conflict or f"Current local cue {getattr(row, 'ID', '?')} has an invalid start position."
    raw_end = _nullable_int(getattr(row, "OutMsec", None))
    point_type = "loop" if raw_end is not None and raw_end >= 0 else "cue"
    end_ms = raw_end if point_type == "loop" else None
    active_raw = _nullable_int(getattr(row, "ActiveLoop", None))
    active_loop = (active_raw == 1) if point_type == "loop" and active_raw is not None else None
    identity_value = getattr(row, "ID", None)

    return CueDiffCue(
        identity=str(identity_value) if identity_value is not None else None,
        family=family,
        hot_cue_slot=slot,
        point_type=point_type,
        start_ms=start_ms,
        end_ms=end_ms,
        color=_nullable_int(getattr(row, "Color", None)),
        color_table_index=_nullable_int(getattr(row, "ColorTableIndex", None)),
        comment=getattr(row, "Comment", None),
        is_active_loop=active_loop,
    ), conflict


def _desired_cue(cue: PlannedCue) -> CueDiffCue:
    values = build_djmdcue_values(
        cue,
        content_id="diff",
        content_uuid="diff",
        cue_id="diff",
        cue_uuid="diff",
    )
    return CueDiffCue(
        identity=cue.rekordbox_cue_id,
        family=cue.family,
        hot_cue_slot=cue.hot_cue_slot,
        point_type=cue.point_type,
        start_ms=int(values["InMsec"]),
        end_ms=int(values["OutMsec"]) if int(values["OutMsec"]) >= 0 else None,
        color=_nullable_int(values.get("Color")),
        color_table_index=_nullable_int(values.get("ColorTableIndex")),
        comment=values.get("Comment"),
        is_active_loop=(int(values["ActiveLoop"]) == 1) if cue.point_type == "loop" else None,
    )


def _pair_exact_identity(
    current: Sequence[CueDiffCue],
    desired: Sequence[CueDiffCue],
    current_left: set[int],
    desired_left: set[int],
) -> list[tuple[int, int, str]]:
    current_by_id = {
        cue.identity: index
        for index, cue in enumerate(current)
        if index in current_left and cue.identity is not None
    }
    pairs: list[tuple[int, int, str]] = []
    for desired_index in sorted(desired_left, key=lambda i: _cue_sort_key(desired[i])):
        identity = desired[desired_index].identity
        current_index = current_by_id.get(identity) if identity is not None else None
        if current_index is None or current_index not in current_left:
            continue
        pairs.append((current_index, desired_index, "stable-id"))
        current_left.remove(current_index)
        desired_left.remove(desired_index)
    return pairs


def _greedy_pairs(
    current: Sequence[CueDiffCue],
    desired: Sequence[CueDiffCue],
    current_left: set[int],
    desired_left: set[int],
    basis: str,
    predicate,
) -> list[tuple[int, int, str]]:
    candidates: list[tuple[Any, ...]] = []
    for current_index in current_left:
        for desired_index in desired_left:
            before = current[current_index]
            after = desired[desired_index]
            if not predicate(before, after):
                continue
            candidates.append((
                abs(before.start_ms - after.start_ms),
                _cue_sort_key(before),
                _cue_sort_key(after),
                current_index,
                desired_index,
            ))
    pairs: list[tuple[int, int, str]] = []
    for *_sort, current_index, desired_index in sorted(candidates):
        if current_index not in current_left or desired_index not in desired_left:
            continue
        pairs.append((current_index, desired_index, basis))
        current_left.remove(current_index)
        desired_left.remove(desired_index)
    return pairs


def _change_fields(before: CueDiffCue, after: CueDiffCue) -> tuple[str, ...]:
    changes: list[str] = []
    if before.start_ms != after.start_ms:
        changes.append("moved")
    if before.family != after.family:
        changes.append("family")
    if before.hot_cue_slot != after.hot_cue_slot:
        changes.append("slot")
    if before.point_type != after.point_type:
        changes.append("point-type")

    before_extent = (
        before.end_ms - before.start_ms
        if before.point_type == "loop" and before.end_ms is not None
        else None
    )
    after_extent = (
        after.end_ms - after.start_ms
        if after.point_type == "loop" and after.end_ms is not None
        else None
    )
    if before.point_type == "loop" and after.point_type == "loop" and before_extent != after_extent:
        changes.append("loop-extent")
    if before.comment != after.comment:
        changes.append("comment")
    if (before.color, before.color_table_index) != (after.color, after.color_table_index):
        changes.append("color")
    if before.is_active_loop != after.is_active_loop:
        changes.append("active-loop")
    return tuple(changes)


def diff_cues(current_rows: Sequence[Any], desired_cues: Sequence[PlannedCue]) -> CueTrackDiff:
    """Return a stable, order-independent cue diff without modifying inputs."""
    current_with_conflicts = [_current_cue(row) for row in current_rows]
    current = [item[0] for item in current_with_conflicts]
    desired = [_desired_cue(cue) for cue in desired_cues]
    conflicts = [item[1] for item in current_with_conflicts if item[1] is not None]

    for row in current_rows:
        if not nondefault_preserved_fields(row):
            continue
        desired_match, match_basis = find_matching_desired_for_preservation(row, desired_cues)
        if match_basis == "removed":
            # No cue of the same family/slot remains: this is an intentional removal.
            continue
        if match_basis == "ambiguous" or desired_match is None:
            conflicts.append(
                f"Current local cue {getattr(row, 'ID', '?')} contains non-default preserved DjmdCue fields "
                "but preservation ownership is ambiguous in the desired complete cue set."
            )
            continue
        blocker = preservation_blocker(
            row,
            desired_id=desired_match.rekordbox_cue_id,
            desired_start_ms=int(desired_match.start_ms),
            desired_end_ms=int(desired_match.end_ms) if desired_match.end_ms is not None else None,
            allow_semantic_rebind=match_basis == "semantic-rebind",
        )
        if blocker:
            conflicts.append(blocker)

    desired_ids = [cue.identity for cue in desired if cue.identity is not None]
    if len(desired_ids) != len(set(desired_ids)):
        conflicts.append("Desired cue document contains duplicate stable Rekordbox cue identity.")

    current_left = set(range(len(current)))
    desired_left = set(range(len(desired)))
    pairs = _pair_exact_identity(current, desired, current_left, desired_left)
    pairs += _greedy_pairs(
        current, desired, current_left, desired_left, "same-position",
        lambda before, after: before.start_ms == after.start_ms,
    )
    pairs += _greedy_pairs(
        current, desired, current_left, desired_left, "hot-slot",
        lambda before, after: (
            before.family == "hot"
            and after.family == "hot"
            and before.hot_cue_slot is not None
            and before.hot_cue_slot == after.hot_cue_slot
        ),
    )
    pairs += _greedy_pairs(
        current, desired, current_left, desired_left, "family-type-nearest",
        lambda before, after: before.family == after.family and before.point_type == after.point_type,
    )
    pairs += _greedy_pairs(
        current, desired, current_left, desired_left, "family-nearest",
        lambda before, after: before.family == after.family,
    )

    changed: list[CueDiffChange] = []
    for current_index, desired_index, basis in pairs:
        before = current[current_index]
        after = desired[desired_index]
        fields = _change_fields(before, after)
        if fields:
            changed.append(CueDiffChange(before=before, after=after, match_basis=basis, changes=fields))

    added = tuple(sorted((desired[index] for index in desired_left), key=_cue_sort_key))
    removed = tuple(sorted((current[index] for index in current_left), key=_cue_sort_key))
    changed.sort(key=lambda item: (_cue_sort_key(item.after), _cue_sort_key(item.before), item.match_basis))

    return CueTrackDiff(
        current_count=len(current),
        desired_count=len(desired),
        added=added,
        removed=removed,
        changed=tuple(changed),
        conflicts=tuple(sorted(set(conflicts))),
        blocking=bool(conflicts),
    )
