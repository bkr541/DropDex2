"""Source-level lock for the mandatory Stage 2-4 prerequisite gate."""
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_stage2_and_stage3_share_production_working_cue_state():
    view = read("src/components/cues/CuePointsView.tsx")
    assert "workingCues" in view
    assert "currentCues: workingCues" in view
    state = read("src/lib/music/cueEditorState.ts")
    assert "nearestBeat" in state
    assert "moveWorkingCue" in state


def test_stage4_saved_document_is_durable_versioned_and_writer_identified():
    migration = read("supabase/migrations/20260820010000_cue_draft_persistence_stage4.sql")
    document = read("src/lib/cues/cueDraftDocument.ts")
    query = read("src/lib/queries/cueDrafts.ts")
    assert "create table if not exists public.cue_drafts" in migration
    assert "revision" in migration
    assert "desired_fingerprint" in migration
    assert "imported_baseline_fingerprint" in migration
    assert "rekordbox_content_id" in migration
    assert "CUE_DRAFT_SCHEMA_VERSION = 1" in document
    assert "rekordboxContentId" in document
    assert "fingerprintCueDraftDocument" in document
    assert "save_cue_draft" in query


def test_stage4_is_reachable_hydrates_and_discards_saved_first():
    view = read("src/components/cues/CuePointsView.tsx")
    assert "fetchCueDraft" in view
    assert "hydrateCueDraftDocument" in view
    assert "saveCueDraft" in view
    assert "Save changes" in view
    assert "savedCueBaseline ?? importedCueBaseline" in view


def test_imported_cues_remain_immutable_and_export_stays_disabled():
    view = read("src/components/cues/CuePointsView.tsx")
    query = read("src/lib/queries/analysisData.ts")
    assert "Export to Rekordbox" in view
    export_index = view.index("Export to Rekordbox")
    export_area = view[export_index - 180:export_index + 80]
    assert "disabled" in export_area
    # Imported cue query layer contains reads only; Stage 4 does not update/delete it.
    assert ".from('rekordbox_cues')" in query
    assert ".update(" not in query
    assert ".delete(" not in query


def test_stage5_writer_is_not_exposed_to_cli_or_renderer():
    cli = read("bridge/rekordbox_bridge/cli.py")
    writer = read("bridge/rekordbox_bridge/writer.py")
    preload = read("electron/preload.cjs") if (ROOT / "electron/preload.cjs").exists() else ""
    main = read("electron/main.cjs") if (ROOT / "electron/main.cjs").exists() else ""
    assert "stage_saved_cue_drafts" not in cli
    assert "stage_saved_cue_drafts" not in preload
    assert "stage_saved_cue_drafts" not in main
    assert "No renderer-facing path API" in writer
