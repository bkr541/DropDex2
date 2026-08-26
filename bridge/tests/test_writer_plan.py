"""Stage 5 saved-draft -> canonical writer-plan tests."""
from __future__ import annotations

from copy import deepcopy

import pytest

from rekordbox_bridge.writer_plan import CuePlanValidationError, adapt_saved_cue_drafts


def cue(**overrides):
    value = {
        "family": "hot",
        "hotCueSlot": 1,
        "pointType": "cue",
        "startMs": 1000.125,
        "endMs": None,
        "colorTableIndex": 18,
        "colorHex": None,
        "colorName": "Green",
        "rekordboxColor": -1,
        "comment": "First beat",
        "isActiveLoop": False,
        "beatLoopNumerator": None,
        "beatLoopDenominator": None,
        "rekordboxKind": 1,
        "sourceDbPresent": True,
    }
    value.update(overrides)
    return value


def saved_row(*, content_id="123", cues=None, revision=3):
    document = {
        "schemaVersion": 1,
        "importId": "import-1",
        "trackId": f"track-{content_id}",
        "rekordboxContentId": content_id,
        "cues": list(cues if cues is not None else [cue()]),
    }
    return {
        "importId": "import-1",
        "trackId": f"track-{content_id}",
        "rekordboxContentId": content_id,
        "revision": revision,
        "desiredFingerprint": "a" * 64,
        "importedBaselineFingerprint": "b" * 64,
        "desiredDocument": document,
        # Writer must ignore renderer/cloud-style fields not in its contract.
        "dbPath": "/Volumes/NEVER/master.db",
        "ContentUUID": "cloud-controlled-uuid",
    }


class TestWriterPlanAdapter:
    def test_saved_document_adapts_to_deterministic_plan(self):
        row = saved_row()
        first = adapt_saved_cue_drafts([row])
        second = adapt_saved_cue_drafts([deepcopy(row)])
        assert first == second
        assert len(first.plan_fingerprint) == 64
        assert first.tracks[0].content_id == "123"
        assert first.tracks[0].draft_revision == 3

    def test_multiple_tracks_are_canonicalized_by_content_id(self):
        plan = adapt_saved_cue_drafts([saved_row(content_id="20"), saved_row(content_id="10")])
        assert [track.content_id for track in plan.tracks] == ["10", "20"]

    def test_stage10_current_baseline_overrides_immutable_import_provenance(self):
        row = saved_row()
        row["currentBaselineFingerprint"] = "c" * 64
        row["currentBaselineLocalCueFingerprint"] = "d" * 64
        plan = adapt_saved_cue_drafts([row])
        assert plan.tracks[0].imported_baseline_fingerprint == "c" * 64
        assert plan.tracks[0].imported_baseline_local_cue_fingerprint == "d" * 64


    def test_stage5_edited_fields_survive_saved_document_to_writer_plan(self):
        row = saved_row(cues=[cue(
            hotCueSlot=4,
            rekordboxKind=5,
            pointType="loop",
            startMs=1111,
            endMs=4444,
            colorTableIndex=5,
            colorHex="#00FFFF",
            colorName="Aqua",
            comment="Exact drop loop",
            isActiveLoop=True,
            beatLoopNumerator=None,
            beatLoopDenominator=None,
        )])
        planned = adapt_saved_cue_drafts([row]).tracks[0].cues[0]
        assert planned.family == "hot"
        assert planned.hot_cue_slot == 4
        assert planned.rekordbox_kind == 5
        assert planned.point_type == "loop"
        assert planned.start_ms == 1111
        assert planned.end_ms == 4444
        assert planned.color_table_index == 5
        assert planned.color_hex == "#00FFFF"
        assert planned.color_name == "Aqua"
        assert planned.comment == "Exact drop loop"
        assert planned.is_active_loop is True

    def test_canonical_memory_color_survives_saved_document_to_writer_plan(self):
        planned = adapt_saved_cue_drafts([saved_row(cues=[cue(
            family="memory",
            hotCueSlot=None,
            rekordboxKind=None,
            colorTableIndex=5,
            colorName="Aqua",
            rekordboxColor=7,
        )])]).tracks[0].cues[0]
        assert planned.rekordbox_color == 7
        assert planned.source_db_present is True

    def test_legacy_imported_memory_without_canonical_color_is_blocked(self):
        legacy = cue(family="memory", hotCueSlot=None, rekordboxKind=None)
        legacy.pop("rekordboxColor")
        with pytest.raises(CuePlanValidationError, match="missing canonical Rekordbox Color metadata"):
            adapt_saved_cue_drafts([saved_row(cues=[legacy])])

    def test_rejects_unsupported_memory_color_code(self):
        invalid = cue(
            family="memory", hotCueSlot=None, rekordboxKind=None, rekordboxColor=8
        )
        with pytest.raises(CuePlanValidationError, match="unsupported Rekordbox Color value"):
            adapt_saved_cue_drafts([saved_row(cues=[invalid])])

    def test_rejects_unsaved_or_zero_revision(self):
        with pytest.raises(CuePlanValidationError, match="revision"):
            adapt_saved_cue_drafts([saved_row(revision=0)])

    def test_rejects_wrong_schema_version(self):
        row = saved_row()
        row["desiredDocument"]["schemaVersion"] = 2
        with pytest.raises(CuePlanValidationError, match="Unsupported"):
            adapt_saved_cue_drafts([row])

    def test_rejects_malformed_fingerprints(self):
        row = saved_row()
        row["desiredFingerprint"] = "not-a-hash"
        with pytest.raises(CuePlanValidationError, match="SHA-256"):
            adapt_saved_cue_drafts([row])

    def test_rejects_identity_mismatch(self):
        row = saved_row()
        row["desiredDocument"]["rekordboxContentId"] = "999"
        with pytest.raises(CuePlanValidationError, match="ContentID"):
            adapt_saved_cue_drafts([row])

    def test_rejects_duplicate_hot_slot(self):
        row = saved_row(cues=[cue(), cue(startMs=2000)])
        with pytest.raises(CuePlanValidationError, match="duplicate Hot Cue"):
            adapt_saved_cue_drafts([row])

    def test_rejects_invalid_loop_range(self):
        row = saved_row(cues=[cue(pointType="loop", startMs=2000, endMs=1500)])
        with pytest.raises(CuePlanValidationError, match="requires endMs"):
            adapt_saved_cue_drafts([row])

    def test_rejects_hot_kind_that_conflicts_with_slot(self):
        row = saved_row(cues=[cue(hotCueSlot=4, rekordboxKind=4)])
        with pytest.raises(CuePlanValidationError, match="conflicts"):
            adapt_saved_cue_drafts([row])

    def test_rejects_duplicate_planned_content_id(self):
        with pytest.raises(CuePlanValidationError, match="Duplicate planned ContentID"):
            adapt_saved_cue_drafts([saved_row(), saved_row()])

    def test_does_not_accept_path_or_content_uuid_as_plan_fields(self):
        plan = adapt_saved_cue_drafts([saved_row()])
        assert not hasattr(plan, "db_path")
        assert not hasattr(plan.tracks[0], "content_uuid")
