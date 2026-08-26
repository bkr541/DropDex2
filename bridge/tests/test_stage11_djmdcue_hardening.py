"""Stage 11 DjmdCue inventory, preservation, and semantic round-trip regressions."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from rekordbox_bridge.djmdcue_policy import (
    DJMDCUE_FIELD_POLICY,
    DJMDCUE_MODEL_FIELDS,
    EDITABLE_SEMANTIC,
    PRESERVED_SEMANTIC,
    WRITER_DERIVED,
    validate_model_inventory,
)
from rekordbox_bridge.writer import StagingWriterError, mutate_staging_database, verify_staging_database
from rekordbox_bridge.writer_plan import adapt_saved_cue_drafts
from tests.test_verified_apply import apply, cue_rows, fixture_db, preflight
from tests.test_writer import (
    CUE_COLUMNS,
    SqliteTestDb,
    Tables,
    draft_cue,
    draft_row,
    local_baseline_fingerprint,
)
from rekordbox_bridge.apply_service import ApplyTokenStore
from rekordbox_bridge import desktop_service
from rekordbox_bridge.security import create_backup_and_staging


HOT_CONTRACT = {
    1: (1, 18, -1),
    2: (2, 18, 255),
    3: (3, 32, -1),
    4: (5, 42, -1),
    5: (6, 1, -1),
    6: (7, 56, -1),
    7: (8, 9, -1),
    8: (9, 0, 255),
}
MEMORY_CONTRACT = {
    1: (4, None, "cue"),
    2: (4, 0, "loop"),
    3: (3, None, "cue"),
    4: (1, None, "cue"),
    5: (6, None, "cue"),
    6: (7, None, "cue"),
    7: (5, None, "cue"),
    8: (2, 0, "loop"),
}


class _Column:
    def __init__(self, name: str):
        self.name = name


def _model(*names: str):
    return type("DjmdCueFixture", (), {"__table__": SimpleNamespace(columns=tuple(_Column(n) for n in names))})


def _insert_rows(path, rows):
    db = SqliteTestDb(str(path))
    try:
        db.conn.execute("delete from djmdCue where ContentID='101'")
        placeholders = ",".join("?" for _ in CUE_COLUMNS)
        for row in rows:
            db.conn.execute(
                f"insert into djmdCue ({','.join(CUE_COLUMNS)}) values ({placeholders})",
                [row.get(column) for column in CUE_COLUMNS],
            )
        db.commit()
    finally:
        db.close()


def _golden_rows_and_draft():
    rows = []
    draft = []
    base = 10_000
    row_id = 100
    for slot in range(1, 9):
        kind, hot_cti, hot_color = HOT_CONTRACT[slot]
        is_loop = slot in (2, 8)
        start = base + slot * 10_000
        end = start + 8_000 if is_loop else -1
        hot_row = {
            "ID": str(row_id), "ContentID": "101", "ContentUUID": "local-uuid-101", "UUID": f"old-hot-{slot}",
            "InMsec": start, "InFrame": 0, "InMpegFrame": 0, "InMpegAbs": 0,
            "OutMsec": end, "OutFrame": 0 if is_loop else -1,
            "OutMpegFrame": 0 if is_loop else -1, "OutMpegAbs": 0 if is_loop else -1,
            "Kind": kind, "Color": hot_color, "ColorTableIndex": hot_cti,
            "ActiveLoop": 0 if is_loop else -1, "Comment": f"Hot {slot}",
            "BeatLoopSize": 0, "CueMicrosec": 0, "InPointSeekInfo": None, "OutPointSeekInfo": None,
        }
        # One supported untouched cue carries unusual precision/seek metadata.
        if slot == 4:
            hot_row.update({
                "InFrame": 4501, "InMpegFrame": 2250, "InMpegAbs": 654321,
                "CueMicrosec": 777, "InPointSeekInfo": "seek-in-golden",
            })
        rows.append(hot_row)
        draft.append(draft_cue(
            family="hot", hotCueSlot=slot, pointType="loop" if is_loop else "cue",
            startMs=start, endMs=end if is_loop else None, colorTableIndex=hot_cti,
            colorName=None, rekordboxColor=None, comment=f"Hot {slot}", isActiveLoop=False if is_loop else None,
            rekordboxKind=kind, rekordboxCueId=str(row_id), sourceDbPresent=True,
        ))
        row_id += 1

        mem_color, mem_cti, mem_type = MEMORY_CONTRACT[slot]
        mem_loop = mem_type == "loop"
        mem_start = start if slot in (1, 2, 8) else max(0, start - 16_000)
        mem_end = end if mem_loop else -1
        mem_row = {
            "ID": str(row_id), "ContentID": "101", "ContentUUID": "local-uuid-101", "UUID": f"old-mem-{slot}",
            "InMsec": mem_start, "InFrame": 0, "InMpegFrame": 0, "InMpegAbs": 0,
            "OutMsec": mem_end, "OutFrame": 0 if mem_loop else -1,
            "OutMpegFrame": 0 if mem_loop else -1, "OutMpegAbs": 0 if mem_loop else -1,
            "Kind": 0, "Color": mem_color, "ColorTableIndex": mem_cti,
            "ActiveLoop": 0 if mem_loop else -1, "Comment": f"Memory {slot}",
            "BeatLoopSize": 0, "CueMicrosec": 0, "InPointSeekInfo": None, "OutPointSeekInfo": None,
        }
        rows.append(mem_row)
        draft.append(draft_cue(
            family="memory", hotCueSlot=None, pointType=mem_type, startMs=mem_start,
            endMs=mem_end if mem_loop else None, colorTableIndex=mem_cti, colorName=None,
            rekordboxColor=mem_color, comment=f"Memory {slot}", isActiveLoop=False if mem_loop else None,
            rekordboxKind=0, rekordboxCueId=str(row_id), sourceDbPresent=True,
        ))
        row_id += 1
    return rows, draft


def test_complete_current_model_inventory_has_one_explicit_policy_per_column():
    assert validate_model_inventory(_model(*DJMDCUE_MODEL_FIELDS)) == DJMDCUE_MODEL_FIELDS
    assert set(DJMDCUE_FIELD_POLICY) == set(DJMDCUE_MODEL_FIELDS)
    assert {policy.classification for policy in DJMDCUE_FIELD_POLICY.values()} == {
        EDITABLE_SEMANTIC, PRESERVED_SEMANTIC, WRITER_DERIVED,
    }
    for required in (
        "InFrame", "InMpegFrame", "InMpegAbs", "OutFrame", "OutMpegFrame", "OutMpegAbs",
        "BeatLoopSize", "CueMicrosec", "InPointSeekInfo", "OutPointSeekInfo",
        "rb_data_status", "rb_local_data_status", "rb_local_deleted", "rb_local_synced",
        "usn", "rb_local_usn", "created_at", "updated_at",
    ):
        assert required in DJMDCUE_FIELD_POLICY


def test_unknown_future_djmdcue_column_fails_closed():
    with pytest.raises(ValueError, match="unclassified fields: FutureOpaqueField"):
        validate_model_inventory(_model(*DJMDCUE_MODEL_FIELDS, "FutureOpaqueField"))


def test_golden_unchanged_a_h_and_memory_set_round_trips_semantically_and_preserves_opaque_fields(tmp_path):
    path = fixture_db(tmp_path)
    rows, desired = _golden_rows_and_draft()
    _insert_rows(path, rows)
    baseline = local_baseline_fingerprint(rows)
    saved = draft_row(cues=desired, local_baseline=baseline)
    store = ApplyTokenStore()

    before = preflight(path, [saved], store)
    assert before.ok is True
    assert before.tracks[0].diff is not None
    assert before.tracks[0].diff.blocking is False

    result = apply(path, before.token, [saved], store)
    assert result.ok is True
    reopened = cue_rows(path, "101")
    assert len(reopened) == 16

    by_comment = {row.Comment: row for row in reopened}
    for slot in range(1, 9):
        kind, hot_cti, hot_color = HOT_CONTRACT[slot]
        hot = by_comment[f"Hot {slot}"]
        assert (hot.Kind, hot.ColorTableIndex, hot.Color) == (kind, hot_cti, hot_color)
        if slot in (2, 8):
            assert hot.OutMsec > hot.InMsec
            assert hot.ActiveLoop == 0
        mem_color, mem_cti, mem_type = MEMORY_CONTRACT[slot]
        memory = by_comment[f"Memory {slot}"]
        assert (memory.Kind, memory.Color, memory.ColorTableIndex) == (0, mem_color, mem_cti)
        assert (memory.OutMsec >= 0) is (mem_type == "loop")
        if mem_type == "loop":
            assert memory.ActiveLoop == 0

    preserved = by_comment["Hot 4"]
    assert (preserved.InFrame, preserved.InMpegFrame, preserved.InMpegAbs) == (4501, 2250, 654321)
    assert preserved.CueMicrosec == 777
    assert preserved.InPointSeekInfo == "seek-in-golden"


def test_golden_track_round_trip_enters_desktop_protocol_selection_and_execution_path(tmp_path, monkeypatch):
    path = fixture_db(tmp_path)
    rows, desired = _golden_rows_and_draft()
    _insert_rows(path, rows)
    saved = draft_row(cues=desired, local_baseline=local_baseline_fingerprint(rows))
    store = ApplyTokenStore()

    # Enter through the same desktop protocol dispatcher used by Electron, while
    # injecting only the fixture-local discovery/database dependencies. The
    # dispatched operations still execute the real Stage 6+ preflight/apply path.
    monkeypatch.setattr(
        desktop_service,
        "preflight_saved_cue_drafts",
        lambda saved_rows: preflight(path, saved_rows, store),
    )
    monkeypatch.setattr(
        desktop_service,
        "apply_saved_cue_drafts",
        lambda token, saved_rows: apply(path, token, saved_rows, store),
    )
    scope = {"kind": "track", "importId": "import-1", "trackId": "track-101"}
    preflight_result = desktop_service._handle({
        "operation": "preflight", "scope": scope, "savedDrafts": [saved],
    })
    assert preflight_result.ok is True
    apply_result = desktop_service._handle({
        "operation": "apply", "token": preflight_result.token, "scope": scope, "savedDrafts": [saved],
    })
    assert apply_result.ok is True
    assert len(cue_rows(path, "101")) == 16


def test_edited_comment_same_timing_preserves_opaque_values_but_timing_edit_blocks(tmp_path):
    path = fixture_db(tmp_path)
    rows, desired = _golden_rows_and_draft()
    _insert_rows(path, rows)
    baseline = local_baseline_fingerprint(rows)

    edited = [dict(cue) for cue in desired]
    hot_d = next(cue for cue in edited if cue["family"] == "hot" and cue["hotCueSlot"] == 4)
    hot_d["comment"] = "Edited Drop"
    saved = draft_row(cues=edited, local_baseline=baseline)
    store = ApplyTokenStore()
    ok = preflight(path, [saved], store)
    assert ok.ok is True
    applied = apply(path, ok.token, [saved], store)
    assert applied.ok is True
    edited_row = next(row for row in cue_rows(path, "101") if row.Comment == "Edited Drop")
    assert (edited_row.InFrame, edited_row.InMpegAbs, edited_row.CueMicrosec) == (4501, 654321, 777)

    # Stage 10 rebases the current semantic fingerprint while replacement row IDs
    # are regenerated. A second same-timing edit must rebind uniquely by current
    # local semantics and preserve the opaque values again.
    rebased_local = applied.tracks[0].local_cue_fingerprint
    second = [dict(cue) for cue in edited]
    second_d = next(cue for cue in second if cue["family"] == "hot" and cue["hotCueSlot"] == 4)
    second_d["comment"] = "Edited Drop Again"
    second_saved = draft_row(cues=second, local_baseline=baseline)
    second_saved["currentBaselineLocalCueFingerprint"] = rebased_local
    second_store = ApplyTokenStore()
    second_pf = preflight(path, [second_saved], second_store)
    assert second_pf.ok is True
    second_result = apply(path, second_pf.token, [second_saved], second_store)
    assert second_result.ok is True
    second_row = next(row for row in cue_rows(path, "101") if row.Comment == "Edited Drop Again")
    assert (second_row.InFrame, second_row.InMpegAbs, second_row.CueMicrosec) == (4501, 654321, 777)

    # Fresh fixture: moving the same cue would invalidate its opaque seek/precision metadata.
    path2 = tmp_path / "moved-master.db"
    from tests.test_writer import init_fixture
    init_fixture(path2)
    _insert_rows(path2, rows)
    moved = [dict(cue) for cue in desired]
    moved_d = next(cue for cue in moved if cue["family"] == "hot" and cue["hotCueSlot"] == 4)
    moved_d["startMs"] += 1000
    blocked = preflight(path2, [draft_row(cues=moved, local_baseline=baseline)], ApplyTokenStore())
    assert blocked.ok is False
    assert any("cannot safely regenerate" in blocker.message for blocker in blocked.blockers)


def test_unique_semantic_rebind_preserves_nondefault_fields_after_row_identity_regeneration(tmp_path):
    path = fixture_db(tmp_path)
    db = SqliteTestDb(str(path))
    try:
        db.conn.execute("update djmdCue set InMpegFrame=12, InMpegAbs=3456 where ID='10'")
        db.commit()
    finally:
        db.close()
    rows = cue_rows(path, "101")
    baseline = local_baseline_fingerprint([row.__dict__ for row in rows])
    desired = [draft_cue(
        family="memory", hotCueSlot=None, pointType="cue", startMs=500, endMs=None,
        colorTableIndex=None, colorName=None, rekordboxColor=-1, comment="existing",
        isActiveLoop=None, rekordboxKind=0, sourceDbPresent=True, rekordboxCueId="old-regenerated-id",
    )]
    saved = draft_row(cues=desired, local_baseline=baseline)
    store = ApplyTokenStore()
    result = preflight(path, [saved], store)
    assert result.ok is True
    applied = apply(path, result.token, [saved], store)
    assert applied.ok is True
    reopened = cue_rows(path, "101")[0]
    assert (reopened.InMpegFrame, reopened.InMpegAbs) == (12, 3456)


def test_ambiguous_semantic_rebind_blocks_nondefault_preserved_fields(tmp_path):
    path = fixture_db(tmp_path)
    db = SqliteTestDb(str(path))
    try:
        db.conn.execute("update djmdCue set InMpegFrame=12, InMpegAbs=3456 where ID='10'")
        db.commit()
    finally:
        db.close()
    rows = cue_rows(path, "101")
    baseline = local_baseline_fingerprint([row.__dict__ for row in rows])
    desired = [
        draft_cue(family="memory", hotCueSlot=None, pointType="cue", startMs=500, endMs=None, colorTableIndex=None, colorName=None, rekordboxColor=-1, comment="one", isActiveLoop=None, rekordboxKind=0, sourceDbPresent=True),
        draft_cue(family="memory", hotCueSlot=None, pointType="cue", startMs=500, endMs=None, colorTableIndex=None, colorName=None, rekordboxColor=-1, comment="two", isActiveLoop=None, rekordboxKind=0, sourceDbPresent=True),
    ]
    result = preflight(path, [draft_row(cues=desired, local_baseline=baseline)], ApplyTokenStore())
    assert result.ok is False
    assert any("preservation ownership is ambiguous" in blocker.message for blocker in result.blockers)


def test_verifier_detects_preserved_seek_metadata_drift(tmp_path):
    path = fixture_db(tmp_path)
    rows, desired = _golden_rows_and_draft()
    _insert_rows(path, rows)
    plan = adapt_saved_cue_drafts([draft_row(cues=desired, local_baseline=local_baseline_fingerprint(rows))])
    generation = create_backup_and_staging(path, operation_id="stage11seekdrift")
    expected = mutate_staging_database(plan, generation, database_factory=SqliteTestDb, tables_module=Tables)
    db = SqliteTestDb(str(generation.staging_path))
    try:
        db.conn.execute("update djmdCue set InPointSeekInfo='corrupted' where Comment='Hot 4'")
        db.commit()
    finally:
        db.close()
    verification = verify_staging_database(plan, generation, expected, database_factory=SqliteTestDb)
    assert verification.ok is False
    assert verification.mismatches
