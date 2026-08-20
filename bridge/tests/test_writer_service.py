from __future__ import annotations

import inspect
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from rekordbox_bridge.writer_models import CueApplyPlan, CueIntent, ProcessState, TrackCueIntent
from rekordbox_bridge.writer_safety import StorageSafety, sha256_file
from rekordbox_bridge.writer_service import _stage_cue_plan_for_test, stage_cue_plan


class FakeCueTable:
    @staticmethod
    def create(**kwargs):
        return SimpleNamespace(**kwargs)


class PersistentFakeDb:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.data = json.loads(self.path.read_text())
        self.pending_delete = []
        self.pending_add = []
        self.next_id = 10000

    def get_content(self, **kwargs):
        content_id = str(kwargs["ID"])
        item = self.data["contents"].get(content_id)
        return None if item is None else SimpleNamespace(ID=content_id, UUID=item["UUID"])

    def get_cue(self, **kwargs):
        item = self.data["contents"].get(str(kwargs["ContentID"]))
        return [] if item is None else [SimpleNamespace(**row) for row in item["cues"]]

    def delete(self, row):
        self.pending_delete.append(row)

    def generate_unused_id(self, _table):
        self.next_id += 1
        return self.next_id

    def add(self, row):
        self.pending_add.append(row)

    def commit(self):
        touched = {str(row.ContentID) for row in self.pending_delete + self.pending_add}
        for content_id in touched:
            rows = [
                vars(row).copy()
                for row in self.pending_add
                if str(row.ContentID) == content_id
            ]
            self.data["contents"][content_id]["cues"] = rows
        self.path.write_text(json.dumps(self.data, sort_keys=True))

    def rollback(self):
        self.pending_delete.clear()
        self.pending_add.clear()

    def close(self):
        pass


def db_factory(path: Path):
    return PersistentFakeDb(path)


def safe_storage(_path: Path):
    return StorageSafety(True, "internal-fixed", "fixture is safe")


def usb_storage(_path: Path):
    return StorageSafety(False, "removable", "USB/removable target rejected")


def closed_process():
    return ProcessState(True, False, True, "Rekordbox is closed")


def running_process():
    return ProcessState(False, True, True, "Rekordbox is running")


def make_source(path: Path):
    path.write_text(json.dumps({
        "contents": {
            "100": {"UUID": "uuid-100", "cues": []},
            "200": {"UUID": "uuid-200", "cues": []},
        }
    }, sort_keys=True))


def make_plan():
    return CueApplyPlan(tracks=(
        TrackCueIntent("100", (
            CueIntent(family="hot", hot_cue_slot=1, point_type="cue", start_ms=0),
            CueIntent(
                family="hot", hot_cue_slot=2, point_type="loop", start_ms=8000, end_ms=16000,
            ),
        )),
    ))


def test_production_writer_entry_point_has_no_database_path_argument():
    parameters = inspect.signature(stage_cue_plan).parameters
    assert "db_path" not in parameters
    assert "source_path" not in parameters
    assert set(parameters) == {"plan"}


def test_usb_rejection_happens_before_backup_or_staging(tmp_path):
    source = tmp_path / "master.db"
    make_source(source)
    artifact_root = tmp_path / "artifacts"
    result = _stage_cue_plan_for_test(
        make_plan(),
        source_path=source,
        storage_probe=usb_storage,
        process_probe=closed_process,
        artifact_root=artifact_root,
        db_factory=db_factory,
        cue_table=FakeCueTable,
    )
    assert result.ok is False
    assert "USB/removable" in result.blockers[0]
    assert not artifact_root.exists(), "unsafe target must be rejected before backup/staging"


def test_rekordbox_running_rejected_before_backup(tmp_path):
    source = tmp_path / "master.db"
    make_source(source)
    artifact_root = tmp_path / "artifacts"
    result = _stage_cue_plan_for_test(
        make_plan(),
        source_path=source,
        storage_probe=safe_storage,
        process_probe=running_process,
        artifact_root=artifact_root,
        db_factory=db_factory,
        cue_table=FakeCueTable,
    )
    assert result.ok is False
    assert result.process_state.running is True
    assert not artifact_root.exists()


def test_real_bridge_service_boundary_stages_writes_verifies_and_leaves_source_unchanged(tmp_path):
    source = tmp_path / "master.db"
    make_source(source)
    source_before = source.read_bytes()
    source_hash = sha256_file(source)
    artifact_root = tmp_path / "artifacts"

    result = _stage_cue_plan_for_test(
        make_plan(),
        source_path=source,
        storage_probe=safe_storage,
        process_probe=closed_process,
        artifact_root=artifact_root,
        db_factory=db_factory,
        cue_table=FakeCueTable,
    )

    assert result.ok is True
    assert result.backup_created is True
    assert result.staging_created is True
    assert result.verification is not None and result.verification.verified is True
    assert result.verification.cues_verified == 2
    assert source.read_bytes() == source_before
    assert sha256_file(source) == source_hash

    backups = list((artifact_root / "backups").glob("*.db"))
    stages = list((artifact_root / "staging").glob("*/master.db"))
    assert len(backups) == 1
    assert len(stages) == 1
    assert backups[0].read_bytes() == source_before
    assert stages[0].read_bytes() != source_before


def test_missing_content_returns_structured_blocker_without_mutating_source(tmp_path):
    source = tmp_path / "master.db"
    make_source(source)
    before = source.read_bytes()
    plan = CueApplyPlan(tracks=(TrackCueIntent("999"),))
    result = _stage_cue_plan_for_test(
        plan,
        source_path=source,
        storage_probe=safe_storage,
        process_probe=closed_process,
        artifact_root=tmp_path / "artifacts",
        db_factory=db_factory,
        cue_table=FakeCueTable,
    )
    assert result.ok is False
    assert result.tracks[0].found is False
    assert "missing" in result.blockers[0]
    assert source.read_bytes() == before


def test_production_service_fails_closed_when_process_state_is_ambiguous(tmp_path):
    source = tmp_path / "master.db"
    make_source(source)
    identity = SimpleNamespace(
        display_name="Rekordbox local master.db",
        source_sha256=sha256_file(source),
        storage_kind="internal-fixed",
    )
    unsafe = ProcessState(False, None, False, "process state unsupported")
    with patch(
        "rekordbox_bridge.writer_service.resolve_trusted_local_master_db",
        return_value=(source, identity),
    ), patch(
        "rekordbox_bridge.writer_service.detect_rekordbox_process",
        return_value=unsafe,
    ):
        result = stage_cue_plan(make_plan())
    assert result.ok is False
    assert result.process_state.safe_to_write is False
    assert "unsupported" in result.blockers[0]


def test_rekordbox_opened_after_preflight_blocks_staging_mutation(tmp_path):
    source = tmp_path / "master.db"
    make_source(source)
    before = source.read_bytes()
    states = iter((closed_process(), running_process()))

    result = _stage_cue_plan_for_test(
        make_plan(),
        source_path=source,
        storage_probe=safe_storage,
        process_probe=lambda: next(states),
        artifact_root=tmp_path / "artifacts",
        db_factory=db_factory,
        cue_table=FakeCueTable,
    )

    assert result.ok is False
    assert result.process_state.running is True
    assert result.backup_created is True
    assert result.staging_created is True
    assert source.read_bytes() == before
    stages = list((tmp_path / "artifacts" / "staging").glob("*/master.db"))
    assert len(stages) == 1
    assert stages[0].read_bytes() == before, "staging must not mutate after Rekordbox opens"


def test_corrupt_staging_database_fails_closed_and_preserves_source(tmp_path):
    source = tmp_path / "master.db"
    make_source(source)
    before = source.read_bytes()

    def corrupt_db_factory(_path: Path):
        raise ValueError("corrupt staging database")

    result = _stage_cue_plan_for_test(
        make_plan(),
        source_path=source,
        storage_probe=safe_storage,
        process_probe=closed_process,
        artifact_root=tmp_path / "artifacts",
        db_factory=corrupt_db_factory,
        cue_table=FakeCueTable,
    )

    assert result.ok is False
    assert "corrupt staging database" in result.blockers[0]
    assert source.read_bytes() == before


def test_malformed_plan_is_rejected_before_backup(tmp_path):
    source = tmp_path / "master.db"
    make_source(source)
    invalid = CueApplyPlan(tracks=(
        TrackCueIntent("100", (
            CueIntent(
                family="hot",
                hot_cue_slot=2,
                point_type="loop",
                start_ms=5000,
                end_ms=4000,
            ),
        )),
    ))
    artifact_root = tmp_path / "artifacts"

    result = _stage_cue_plan_for_test(
        invalid,
        source_path=source,
        storage_probe=safe_storage,
        process_probe=closed_process,
        artifact_root=artifact_root,
        db_factory=db_factory,
        cue_table=FakeCueTable,
    )

    assert result.ok is False
    assert "greater than start_ms" in result.blockers[0]
    assert not artifact_root.exists()
