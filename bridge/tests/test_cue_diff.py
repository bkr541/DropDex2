from types import SimpleNamespace

from rekordbox_bridge.cue_diff import diff_cues
from rekordbox_bridge.writer_models import PlannedCue


def current_cue(
    cue_id: str,
    *,
    start: int,
    kind: int,
    end: int = -1,
    color: int = -1,
    color_index=None,
    active: int = -1,
    comment: str | None = None,
):
    return SimpleNamespace(
        ID=cue_id,
        InMsec=start,
        OutMsec=end,
        Kind=kind,
        Color=color,
        ColorTableIndex=color_index,
        ActiveLoop=active,
        Comment=comment,
    )


def desired_cue(
    *,
    cue_id: str | None,
    family: str,
    slot: int | None,
    start: int,
    point_type: str = "cue",
    end: int | None = None,
    color_index=None,
    color_name=None,
    comment=None,
    active=None,
):
    kind_by_slot = {1: 1, 2: 2, 3: 3, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9}
    return PlannedCue(
        family=family,
        hot_cue_slot=slot,
        point_type=point_type,
        start_ms=float(start),
        end_ms=float(end) if end is not None else None,
        color_table_index=color_index,
        color_hex=None,
        color_name=color_name,
        comment=comment,
        is_active_loop=active,
        beat_loop_numerator=None,
        beat_loop_denominator=None,
        rekordbox_kind=kind_by_slot.get(slot) if family == "hot" else None,
        rekordbox_cue_id=cue_id,
    )


def test_diff_distinguishes_add_remove_move_family_slot_loop_and_metadata_changes():
    current = [
        current_cue("1", start=500, kind=0, comment="memory"),
        current_cue("2", start=1000, kind=1, comment="hot-a"),
        current_cue("3", start=2000, kind=2, end=4000, color=255, color_index=5, active=1, comment="loop"),
        current_cue("4", start=3000, kind=0, comment="remove-me"),
    ]
    desired = [
        desired_cue(cue_id="1", family="hot", slot=3, start=500, comment="memory"),
        desired_cue(cue_id="2", family="hot", slot=1, start=1500, comment="hot-a"),
        desired_cue(
            cue_id="3",
            family="hot",
            slot=4,
            start=2000,
            point_type="loop",
            end=5000,
            color_index=6,
            comment="changed loop",
            active=False,
        ),
        desired_cue(cue_id=None, family="hot", slot=8, start=7000, comment="new"),
    ]

    result = diff_cues(current, desired)

    assert result.current_count == 4
    assert result.desired_count == 4
    assert [cue.start_ms for cue in result.added] == [7000]
    assert [cue.start_ms for cue in result.removed] == [3000]
    by_id = {change.after.identity: set(change.changes) for change in result.changed}
    assert {"family", "slot"} <= by_id["1"]
    assert "moved" in by_id["2"]
    assert {"slot", "loop-extent", "comment", "color", "active-loop"} <= by_id["3"]
    assert result.conflicts == ()


def test_diff_is_deterministic_for_reordered_inputs():
    current = [
        current_cue("1", start=500, kind=0, comment="one"),
        current_cue("2", start=1000, kind=1, comment="two"),
    ]
    desired = [
        desired_cue(cue_id=None, family="memory", slot=None, start=750, comment="one"),
        desired_cue(cue_id=None, family="hot", slot=1, start=1250, comment="two"),
    ]

    first = diff_cues(current, desired)
    second = diff_cues(list(reversed(current)), list(reversed(desired)))
    assert first == second


def test_no_change_diff_is_empty():
    current = [current_cue("10", start=500, kind=0, comment="existing")]
    desired = [desired_cue(cue_id="10", family="memory", slot=None, start=500, comment="existing")]

    result = diff_cues(current, desired)
    assert result.added == ()
    assert result.removed == ()
    assert result.changed == ()
    assert result.blocking is False


def test_unsupported_local_kind_is_reported_as_blocking_conflict():
    result = diff_cues(
        [current_cue("10", start=500, kind=4)],
        [desired_cue(cue_id="10", family="memory", slot=None, start=500)],
    )
    assert result.blocking is True
    assert "unsupported Rekordbox Kind" in result.conflicts[0]
