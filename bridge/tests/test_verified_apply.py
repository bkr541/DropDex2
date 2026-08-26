"""Stage 6 verified transactional Rekordbox apply tests on disposable DBs."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from rekordbox_bridge.apply_service import (
    ApplyTokenStore,
    _cue_fingerprint,
    apply_saved_cue_drafts,
    preflight_saved_cue_drafts,
)
from rekordbox_bridge.security import (
    RekordboxProcessSafetyError,
    discover_trusted_writer_target,
    file_identity,
)
from rekordbox_bridge.writer_models import TargetSafetyResult
from tests.test_writer import SqliteTestDb, Tables, draft_cue, draft_row, init_fixture


NOW = datetime(2026, 8, 20, 22, 0, tzinfo=timezone.utc)


def discovery_for(path: Path):
    def discover():
        identity = file_identity(path)
        return path, TargetSafetyResult(
            True,
            "trusted-local-master-db",
            "fixture",
            identity,
        )

    return discover


def closed():
    return None


def preflight(path: Path, rows, store: ApplyTokenStore, **kwargs):
    return preflight_saved_cue_drafts(
        rows,
        token_store=store,
        now=NOW,
        discover_target=discovery_for(path),
        require_closed=closed,
        database_factory=SqliteTestDb,
        **kwargs,
    )


def apply(path: Path, token: str, rows, store: ApplyTokenStore, **kwargs):
    return apply_saved_cue_drafts(
        token,
        rows,
        token_store=store,
        now=NOW + timedelta(seconds=1),
        discover_target=discovery_for(path),
        require_closed=closed,
        database_factory=SqliteTestDb,
        tables_module=Tables,
        **kwargs,
    )


def fixture_db(tmp_path: Path) -> Path:
    path = tmp_path / "master.db"
    init_fixture(path)
    return path


def cue_comment(path: Path, content_id: str) -> str:
    db = SqliteTestDb(str(path))
    try:
        rows = db.get_cue(ContentID=content_id)
        assert len(rows) == 1
        return rows[0].Comment
    finally:
        db.close()


def cue_rows(path: Path, content_id: str):
    db = SqliteTestDb(str(path))
    try:
        return db.get_cue(ContentID=content_id)
    finally:
        db.close()


class TestStage6Preflight:
    def test_current_local_fingerprint_is_deterministic_and_preflight_is_read_only(self, tmp_path):
        path = fixture_db(tmp_path)
        before_identity = file_identity(path)
        before_stat = path.stat()
        store = ApplyTokenStore()

        first = preflight(path, [draft_row()], store)
        second = preflight(path, [draft_row()], store)

        assert first.ok is True
        assert second.ok is True
        assert first.tracks[0].current_cue_fingerprint == second.tracks[0].current_cue_fingerprint
        assert first.source_identity == before_identity
        assert file_identity(path) == before_identity
        assert path.stat().st_mtime_ns == before_stat.st_mtime_ns
        assert not Path(f"{path}-wal").exists()
        assert not Path(f"{path}-shm").exists()
        assert first.token != second.token

    def test_missing_target_track_blocks_token(self, tmp_path):
        path = fixture_db(tmp_path)
        result = preflight(path, [draft_row(content_id="999")], ApplyTokenStore())
        assert result.ok is False
        assert result.token is None
        assert result.blockers[0].code == "target-track-missing"

    def test_imported_vs_local_divergence_is_a_hard_blocker(self, tmp_path):
        path = fixture_db(tmp_path)
        row = draft_row()
        row["importedBaselineLocalCueFingerprint"] = "f" * 64
        result = preflight(path, [row], ApplyTokenStore())
        assert result.ok is False
        assert result.token is None
        assert result.tracks[0].imported_baseline_comparison == "diverged"
        assert any(item.code == "imported-baseline-stale" for item in result.blockers)
        assert result.warnings == ()

    def test_missing_local_baseline_blocks_legacy_destructive_apply(self, tmp_path):
        path = fixture_db(tmp_path)
        row = draft_row()
        row.pop("importedBaselineLocalCueFingerprint")
        result = preflight(path, [row], ApplyTokenStore())
        assert result.ok is False
        assert result.token is None
        assert result.tracks[0].imported_baseline_comparison == "missing"
        assert any(item.code == "imported-baseline-missing" for item in result.blockers)

    def test_legacy_draft_without_strong_identity_remains_parseable_but_cannot_apply(self, tmp_path):
        path = fixture_db(tmp_path)
        row = draft_row()
        row.pop("importedBaselineLocalCueFingerprint")
        row.pop("masterDbId")
        row.pop("masterContentId")
        result = preflight(path, [row], ApplyTokenStore())
        assert result.ok is False
        assert result.token is None
        assert any(item.code == "strong-track-identity-missing" for item in result.blockers)
        assert any(item.code == "imported-baseline-missing" for item in result.blockers)

    def test_stronger_master_db_identity_mismatch_blocks_even_when_weak_content_id_exists(self, tmp_path):
        path = fixture_db(tmp_path)
        row = draft_row(master_db_id="different-master-db")
        result = preflight(path, [row], ApplyTokenStore())
        assert result.ok is False
        assert result.token is None
        assert result.tracks[0].identity_comparison == "mismatch"
        assert any(item.code == "strong-track-identity-mismatch" for item in result.blockers)

    def test_ambiguous_strong_content_resolution_blocks(self, tmp_path):
        path = fixture_db(tmp_path)

        class AmbiguousDb(SqliteTestDb):
            def get_content(self, **filters):
                content = super().get_content(**filters)
                return [content, content] if content is not None else None

        result = preflight_saved_cue_drafts(
            [draft_row()],
            token_store=ApplyTokenStore(),
            now=NOW,
            discover_target=discovery_for(path),
            require_closed=closed,
            database_factory=AmbiguousDb,
        )
        assert result.ok is False
        assert result.token is None
        assert any(item.code == "strong-track-identity-ambiguous" for item in result.blockers)

    def test_canonical_fingerprint_is_stable_for_reordered_rows(self):
        first = SimpleNamespace(
            ContentID="101", InMsec=500, InFrame=0, InMpegFrame=0, InMpegAbs=0,
            OutMsec=-1, OutFrame=-1, OutMpegFrame=-1, OutMpegAbs=-1, Kind=0,
            Color=-1, ColorTableIndex=None, ActiveLoop=-1, Comment="one", BeatLoopSize=0, CueMicrosec=0,
        )
        second = SimpleNamespace(
            ContentID="101", InMsec=1000, InFrame=0, InMpegFrame=0, InMpegAbs=0,
            OutMsec=-1, OutFrame=-1, OutMpegFrame=-1, OutMpegAbs=-1, Kind=1,
            Color=-1, ColorTableIndex=2, ActiveLoop=-1, Comment="two", BeatLoopSize=0, CueMicrosec=0,
        )
        assert _cue_fingerprint([first, second]) == _cue_fingerprint([second, first])

    @pytest.mark.parametrize(
        "mutation",
        [
            "delete from djmdCue where ContentID='101'",
            "update djmdCue set InMsec=501 where ContentID='101'",
            "update djmdCue set Comment='external-metadata' where ContentID='101'",
            "update djmdCue set Color=2, ColorTableIndex=3 where ContentID='101'",
            "update djmdCue set Kind=1 where ContentID='101'",
            "update djmdCue set OutMsec=1000, OutFrame=0, OutMpegFrame=0, OutMpegAbs=0, ActiveLoop=1 where ContentID='101'",
            "insert into djmdCue values ('11','101','local-uuid-101','extra',750,0,0,0,-1,-1,-1,-1,1,-1,2,-1,'added',0,0)",
        ],
        ids=["deleted", "moved", "metadata", "recolored", "hot-memory-family", "loop", "added"],
    )
    def test_any_material_local_cue_change_after_import_blocks_preflight(self, tmp_path, mutation):
        path = fixture_db(tmp_path)
        db = SqliteTestDb(str(path))
        db.conn.execute(mutation)
        db.commit()
        db.close()
        result = preflight(path, [draft_row()], ApplyTokenStore())
        assert result.ok is False
        assert result.token is None
        assert result.tracks[0].imported_baseline_comparison == "diverged"
        assert any(item.code == "imported-baseline-stale" for item in result.blockers)

    def test_sqlite_sidecar_blocks_single_file_generation(self, tmp_path):
        path = fixture_db(tmp_path)
        Path(f"{path}-wal").write_bytes(b"pending")
        result = preflight(path, [draft_row()], ApplyTokenStore())
        assert result.ok is False
        assert result.blockers[0].code == "preflight-blocked"
        assert "sidecar" in result.blockers[0].message.lower()


class TestStage6TokenAndStaleState:
    def test_expired_token_is_rejected(self, tmp_path):
        path = fixture_db(tmp_path)
        store = ApplyTokenStore()
        pf = preflight(path, [draft_row()], store, token_ttl_seconds=2)
        result = apply_saved_cue_drafts(
            pf.token,
            [draft_row()],
            token_store=store,
            now=NOW + timedelta(seconds=3),
            discover_target=discovery_for(path),
            require_closed=closed,
            database_factory=SqliteTestDb,
            tables_module=Tables,
        )
        assert result.state == "rejected"
        assert result.blockers[0].code == "token-expired"

    def test_replay_is_rejected_after_successful_apply(self, tmp_path):
        path = fixture_db(tmp_path)
        store = ApplyTokenStore()
        rows = [draft_row()]
        pf = preflight(path, rows, store)
        first = apply(path, pf.token, rows, store)
        second = apply(path, pf.token, rows, store)
        assert first.ok is True
        assert second.state == "rejected"
        assert second.blockers[0].code == "token-replayed"

    def test_saved_revision_change_after_preflight_is_rejected(self, tmp_path):
        path = fixture_db(tmp_path)
        store = ApplyTokenStore()
        original = draft_row()
        pf = preflight(path, [original], store)
        changed = draft_row()
        changed["revision"] = original["revision"] + 1
        result = apply(path, pf.token, [changed], store)
        assert result.state == "rejected"
        assert result.blockers[0].code == "saved-plan-changed"
        assert cue_comment(path, "101") == "existing"

    def test_local_cue_change_after_preflight_is_rejected(self, tmp_path):
        path = fixture_db(tmp_path)
        store = ApplyTokenStore()
        rows = [draft_row()]
        pf = preflight(path, rows, store)
        db = SqliteTestDb(str(path))
        db.conn.execute("update djmdCue set Comment='external' where ContentID='101'")
        db.commit()
        db.close()
        result = apply(path, pf.token, rows, store)
        assert result.state == "rejected"
        assert result.blockers[0].code == "target-cues-stale"
        assert cue_comment(path, "101") == "external"

    def test_rekordbox_starting_after_preflight_blocks_apply(self, tmp_path):
        path = fixture_db(tmp_path)
        store = ApplyTokenStore()
        rows = [draft_row()]
        pf = preflight(path, rows, store)

        def running():
            raise RekordboxProcessSafetyError("rekordbox-running: fixture")

        result = apply_saved_cue_drafts(
            pf.token,
            rows,
            token_store=store,
            now=NOW + timedelta(seconds=1),
            discover_target=discovery_for(path),
            require_closed=running,
            database_factory=SqliteTestDb,
            tables_module=Tables,
        )
        assert result.state == "rejected"
        assert result.blockers[0].code == "apply-safety-blocked"
        assert cue_comment(path, "101") == "existing"


class TestStage6TransactionalApply:
    def test_stage5_edited_fields_flow_through_real_preflight_apply_and_live_verification(self, tmp_path):
        path = fixture_db(tmp_path)
        store = ApplyTokenStore()
        rows = [draft_row(cues=[
            draft_cue(
                family="hot",
                hotCueSlot=8,
                rekordboxKind=9,
                pointType="cue",
                startMs=1337,
                endMs=None,
                colorTableIndex=18,
                colorHex=None,
                colorName=None,
                comment="Stage 5 Hot H",
                isActiveLoop=False,
            ),
            draft_cue(
                family="memory",
                hotCueSlot=None,
                rekordboxKind=None,
                pointType="loop",
                startMs=2333,
                endMs=4666,
                colorTableIndex=5,
                colorHex=None,
                colorName="Aqua",
                comment="Stage 5 exact loop",
                isActiveLoop=True,
                beatLoopNumerator=None,
                beatLoopDenominator=None,
            ),
        ])]

        pf = preflight(path, rows, store)
        assert pf.ok is True
        result = apply(path, pf.token, rows, store)

        assert result.ok is True
        assert result.state == "applied"
        written = {cue.Comment: cue for cue in cue_rows(path, "101")}
        assert set(written) == {"Stage 5 Hot H", "Stage 5 exact loop"}

        hot = written["Stage 5 Hot H"]
        assert hot.InMsec == 1337
        assert hot.OutMsec == -1
        assert hot.Kind == 9
        assert hot.ColorTableIndex == 18
        assert hot.ActiveLoop == -1

        memory_loop = written["Stage 5 exact loop"]
        assert memory_loop.InMsec == 2333
        assert memory_loop.OutMsec == 4666
        assert memory_loop.Kind == 0
        assert memory_loop.Color == 5
        assert memory_loop.ColorTableIndex == 5
        assert memory_loop.ActiveLoop == 1

    def test_unchanged_state_multi_track_apply_stages_then_verifies_live(self, tmp_path):
        path = fixture_db(tmp_path)
        store = ApplyTokenStore()
        rows = [
            draft_row("101", [draft_cue(comment="new-101")]),
            draft_row("202", [draft_cue(comment="new-202")]),
        ]
        pf = preflight(path, rows, store)
        result = apply(path, pf.token, rows, store)
        assert result.ok is True
        assert result.state == "applied"
        assert {track.content_id for track in result.tracks} == {"101", "202"}
        assert all(track.state == "verified" for track in result.tracks)
        assert cue_comment(path, "101") == "new-101"
        assert cue_comment(path, "202") == "new-202"
        assert result.source_identity_after != result.source_identity_before
        assert result.backup_identity == result.source_identity_before

    def test_staging_failure_leaves_live_generation_unchanged(self, tmp_path):
        path = fixture_db(tmp_path)
        before = file_identity(path)
        store = ApplyTokenStore()
        rows = [draft_row()]
        pf = preflight(path, rows, store)

        def factory(db_path: str):
            if ".dropdex-writer" in db_path:
                raise RuntimeError("simulated staging mutation failure")
            return SqliteTestDb(db_path)

        result = apply_saved_cue_drafts(
            pf.token,
            rows,
            token_store=store,
            now=NOW + timedelta(seconds=1),
            discover_target=discovery_for(path),
            require_closed=closed,
            database_factory=factory,
            tables_module=Tables,
        )
        assert result.state == "rejected"
        assert result.blockers[0].code == "staging-failed"
        assert file_identity(path) == before

    def test_atomic_replace_failure_leaves_live_generation_unchanged(self, tmp_path):
        path = fixture_db(tmp_path)
        before = file_identity(path)
        store = ApplyTokenStore()
        rows = [draft_row()]
        pf = preflight(path, rows, store)

        def fail_replace(*args, **kwargs):
            raise OSError("simulated replace failure")

        result = apply(path, pf.token, rows, store, replace_generation=fail_replace)
        assert result.state == "rejected"
        assert result.blockers[0].code == "atomic-replacement-failed"
        assert file_identity(path) == before
        assert cue_comment(path, "101") == "existing"

    def test_final_verification_failure_rolls_back_and_verifies_old_state(self, tmp_path):
        path = fixture_db(tmp_path)
        before = file_identity(path)
        store = ApplyTokenStore()
        rows = [draft_row(cues=[draft_cue(comment="new")])]
        pf = preflight(path, rows, store)

        def corrupt_live(db_path: Path):
            db = SqliteTestDb(str(db_path))
            db.conn.execute("update djmdCue set Comment='corrupt' where ContentID='101'")
            db.commit()
            db.close()

        result = apply(path, pf.token, rows, store, after_replace_hook=corrupt_live)
        assert result.ok is False
        assert result.state == "rolled-back"
        assert result.rollback_verified is True
        assert file_identity(path) == before
        assert cue_comment(path, "101") == "existing"

    def test_rollback_verification_failure_reports_critical_recovery_state(self, tmp_path):
        path = fixture_db(tmp_path)
        store = ApplyTokenStore()
        rows = [draft_row(cues=[draft_cue(comment="new")])]
        pf = preflight(path, rows, store)

        def corrupt_live(db_path: Path):
            db = SqliteTestDb(str(db_path))
            db.conn.execute("update djmdCue set Comment='corrupt' where ContentID='101'")
            db.commit()
            db.close()

        def corrupt_rollback(db_path: Path):
            db = SqliteTestDb(str(db_path))
            db.conn.execute("update djmdCue set Comment='rollback-corrupt' where ContentID='101'")
            db.commit()
            db.close()

        result = apply(
            path,
            pf.token,
            rows,
            store,
            after_replace_hook=corrupt_live,
            after_rollback_hook=corrupt_rollback,
        )
        assert result.ok is False
        assert result.state == "recovery-unverified"
        assert result.rollback_verified is False
        assert result.blockers[0].code == "rollback-unverified"
        assert result.recovery["status"] == "manual-recovery-required"


class TestStage6DeepSafetyBoundary:
    def test_preflight_rejects_usb_through_stage5_central_guard(self):
        usb = Path("/Volumes/PERFORMANCE-USB/PIONEER/rekordbox/master.db")

        def discover_usb():
            with patch("rekordbox_bridge.security.find_master_db", return_value=usb):
                return discover_trusted_writer_target(
                    system="Darwin", storage_probe=lambda _path: True
                )

        result = preflight_saved_cue_drafts(
            [draft_row()],
            token_store=ApplyTokenStore(),
            now=NOW,
            discover_target=discover_usb,
            require_closed=closed,
            database_factory=SqliteTestDb,
        )
        assert result.ok is False
        assert "removable-target" in result.blockers[0].message

    def test_apply_rechecks_stage5_guard_and_rejects_usb_before_handoff(self, tmp_path):
        path = fixture_db(tmp_path)
        store = ApplyTokenStore()
        rows = [draft_row()]
        pf = preflight(path, rows, store)
        usb = Path("/Volumes/PERFORMANCE-USB/PIONEER/rekordbox/master.db")

        def discover_usb():
            with patch("rekordbox_bridge.security.find_master_db", return_value=usb):
                return discover_trusted_writer_target(
                    system="Darwin", storage_probe=lambda _path: True
                )

        result = apply_saved_cue_drafts(
            pf.token,
            rows,
            token_store=store,
            now=NOW + timedelta(seconds=1),
            discover_target=discover_usb,
            require_closed=closed,
            database_factory=SqliteTestDb,
            tables_module=Tables,
        )
        assert result.state == "rejected"
        assert result.blockers[0].code == "apply-safety-blocked"
        assert "removable-target" in result.blockers[0].message
        assert cue_comment(path, "101") == "existing"


def test_stage6_service_is_not_exposed_to_cli_or_electron():
    root = Path(__file__).resolve().parents[2]
    for relative in ("bridge/rekordbox_bridge/cli.py", "electron/main.cjs", "electron/preload.cjs"):
        text = (root / relative).read_text(encoding="utf-8")
        assert "preflight_saved_cue_drafts" not in text
        assert "apply_saved_cue_drafts" not in text


def test_deepest_guard_rejects_usb_after_staging_before_live_handoff(tmp_path):
    path = fixture_db(tmp_path)
    before = file_identity(path)
    store = ApplyTokenStore()
    rows = [draft_row()]
    pf = preflight(path, rows, store)
    usb = Path("/Volumes/PERFORMANCE-USB/PIONEER/rekordbox/master.db")
    calls = 0

    def staged_then_usb():
        nonlocal calls
        calls += 1
        if calls == 1:
            return discovery_for(path)()
        with patch("rekordbox_bridge.security.find_master_db", return_value=usb):
            return discover_trusted_writer_target(system="Darwin", storage_probe=lambda _path: True)

    result = apply_saved_cue_drafts(
        pf.token,
        rows,
        token_store=store,
        now=NOW + timedelta(seconds=1),
        discover_target=staged_then_usb,
        require_closed=closed,
        database_factory=SqliteTestDb,
        tables_module=Tables,
    )
    assert calls == 2
    assert result.state == "rejected"
    assert result.blockers[0].code == "atomic-replacement-failed"
    assert "removable-target" in result.blockers[0].message
    assert file_identity(path) == before


def test_rekordbox_starting_mid_operation_is_caught_by_deepest_guard(tmp_path):
    path = fixture_db(tmp_path)
    before = file_identity(path)
    store = ApplyTokenStore()
    rows = [draft_row()]
    pf = preflight(path, rows, store)
    calls = 0

    def closed_then_running():
        nonlocal calls
        calls += 1
        if calls == 1:
            return None
        raise RekordboxProcessSafetyError("rekordbox-running: started during staging")

    result = apply_saved_cue_drafts(
        pf.token,
        rows,
        token_store=store,
        now=NOW + timedelta(seconds=1),
        discover_target=discovery_for(path),
        require_closed=closed_then_running,
        database_factory=SqliteTestDb,
        tables_module=Tables,
    )
    assert calls == 2
    assert result.state == "rejected"
    assert result.blockers[0].code == "atomic-replacement-failed"
    assert "started during staging" in result.blockers[0].message
    assert file_identity(path) == before


def test_target_removed_after_preflight_is_reported_before_handoff(tmp_path):
    path = fixture_db(tmp_path)
    store = ApplyTokenStore()
    rows = [draft_row()]
    pf = preflight(path, rows, store)
    db = SqliteTestDb(str(path))
    db.conn.execute("delete from djmdContent where ID='101'")
    db.commit()
    db.close()
    result = apply(path, pf.token, rows, store)
    assert result.state == "rejected"
    assert result.blockers[0].code == "target-track-missing"


def test_unrelated_local_generation_change_still_blocks_apply(tmp_path):
    path = fixture_db(tmp_path)
    store = ApplyTokenStore()
    rows = [draft_row("101")]
    pf = preflight(path, rows, store)
    db = SqliteTestDb(str(path))
    db.conn.execute("update djmdCue set Comment='other-track-change' where ContentID='202'")
    db.commit()
    db.close()
    result = apply(path, pf.token, rows, store)
    assert result.state == "rejected"
    assert result.blockers[0].code == "local-generation-stale"
    assert cue_comment(path, "101") == "existing"
