"""Stage 9 cross-boundary cue-truth production-contract regression tests."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
IMPORTER_ROOT = REPO_ROOT / "importer"
if str(IMPORTER_ROOT) not in sys.path:
    sys.path.insert(0, str(IMPORTER_ROOT))

from dropdex_importer.cue_parser import AnlzCueEntry
from dropdex_importer.cue_reconciliation import build_cue_reconciliation_plan
from rekordbox_bridge.apply_service import ApplyTokenStore
from tests.test_verified_apply import fixture_db, preflight
from tests.test_writer import draft_cue, draft_row


def test_reconciliation_contract_flows_through_saved_draft_to_real_preflight(tmp_path):
    """Exercise real reconciliation semantics and the real destructive preflight.

    The production Cue Points view is a TypeScript boundary, so this Python test
    also asserts its production entry remains wired to baseline loading, draft
    creation, and desktop preflight while the runtime portions execute here.
    """

    db_row = {
        "id": "cue-db-1",
        "import_id": "import-1",
        "track_id": "track-101",
        "dedupe_key": "db:101:500.000",
        "cue_family": "hot",
        "cue_family_authority": "provisional",
        "hot_cue_slot": None,
        "point_type": "loop",
        "start_ms": 500.0,
        "end_ms": 3000.0,
        "color_table_index": 3,
        "color_hex": None,
        "color_name": None,
        "comment": "db-loop",
        "is_active_loop": False,
        "beat_loop_numerator": None,
        "beat_loop_denominator": None,
        "source_db_present": True,
        "source_anlz_present": False,
        "source_conflict": False,
        "source_payload": {
            "point_type": "loop",
            "start_ms": 500.0,
            "end_ms": 3000.0,
            "color_table_index": 3,
            "color_name": None,
            "comment": "db-loop",
            "is_active_loop": False,
            "beat_loop_numerator": None,
            "beat_loop_denominator": None,
        },
    }
    anlz = AnlzCueEntry(
        source_index=0,
        source_tag="PCO2",
        hot_cue_slot=1,
        cue_family="hot",
        point_type="loop",
        start_ms=500.0,
        end_ms=3000.0,
        color_hex="#FF0000",
        color_id=2,
        comment="anlz-label",
        is_active_loop=None,
        beat_loop_numerator=None,
        beat_loop_denominator=None,
        source_payload={"hot_cue": 1, "color_id": 2},
    )

    plan = build_cue_reconciliation_plan(
        [db_row], [anlz], import_id="import-1", track_id="track-101", tolerance_ms=10.0
    )
    assert len(plan.upsert_rows) == 1
    reconciled = plan.upsert_rows[0]
    assert reconciled["point_type"] == "loop"
    assert reconciled["hot_cue_slot"] == 1
    assert reconciled["is_active_loop"] is False
    assert reconciled["color_table_index"] == 3

    # Model the saved Cue Points desired document using the exact bridge contract
    # consumed by the production apply preflight.
    saved = draft_row(cues=[draft_cue(
        family=reconciled["cue_family"],
        hotCueSlot=reconciled["hot_cue_slot"],
        pointType=reconciled["point_type"],
        startMs=reconciled["start_ms"],
        endMs=reconciled["end_ms"],
        colorTableIndex=reconciled["color_table_index"],
        colorName=reconciled["color_name"],
        comment=reconciled["comment"],
        isActiveLoop=reconciled["is_active_loop"],
        rekordboxKind=1,
    )])
    path = fixture_db(tmp_path)
    result = preflight(path, [saved], ApplyTokenStore())

    assert result.ok is True
    assert result.token is not None
    assert result.tracks[0].imported_baseline_comparison == "match"

    cue_points_source = (REPO_ROOT / "src/components/cues/CuePointsView.tsx").read_text()
    assert "loadCueEditorBaseline" in cue_points_source
    assert "createCueDraftDocument" in cue_points_source
    assert "cueApplyPreflight" in cue_points_source
