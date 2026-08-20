from __future__ import annotations

import pytest

from rekordbox_bridge.writer_models import (
    CueApplyPlan,
    CueIntent,
    CuePlanValidationError,
    TrackCueIntent,
)


def test_plan_fingerprint_is_stable_across_track_and_cue_order():
    a = CueIntent(family="hot", hot_cue_slot=1, point_type="cue", start_ms=1000)
    b = CueIntent(family="memory", paired_hot_cue_slot=1, point_type="cue", start_ms=500)
    left = CueApplyPlan(
        tracks=(TrackCueIntent("2", (a,)), TrackCueIntent("1", (b,))),
    )
    right = CueApplyPlan(
        tracks=(TrackCueIntent("1", (b,)), TrackCueIntent("2", (a,))),
    )
    assert left.fingerprint() == right.fingerprint()


@pytest.mark.parametrize("slot", range(1, 9))
def test_hot_slots_a_through_h_are_valid(slot):
    plan = CueApplyPlan(
        tracks=(
            TrackCueIntent(
                "123",
                (CueIntent(family="hot", hot_cue_slot=slot, point_type="cue", start_ms=1000),),
            ),
        )
    )
    plan.validate()


def test_duplicate_hot_slot_rejected():
    cue = CueIntent(family="hot", hot_cue_slot=1, point_type="cue", start_ms=1000)
    plan = CueApplyPlan(tracks=(TrackCueIntent("123", (cue, cue)),))
    with pytest.raises(CuePlanValidationError, match="duplicate Hot Cue"):
        plan.validate()


def test_loop_end_must_follow_start():
    cue = CueIntent(
        family="hot",
        hot_cue_slot=2,
        point_type="loop",
        start_ms=2000,
        end_ms=1000,
    )
    with pytest.raises(CuePlanValidationError, match="greater than start_ms"):
        cue.validate()


def test_point_cue_rejects_loop_end():
    cue = CueIntent(
        family="memory",
        point_type="cue",
        start_ms=2000,
        end_ms=3000,
    )
    with pytest.raises(CuePlanValidationError, match="must not include end_ms"):
        cue.validate()


def test_duplicate_content_id_rejected():
    plan = CueApplyPlan(tracks=(TrackCueIntent("123"), TrackCueIntent("123")))
    with pytest.raises(CuePlanValidationError, match="duplicate ContentID"):
        plan.validate()
