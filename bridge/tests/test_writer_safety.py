"""Stage 5 hard target/process guards and generation tests."""
from __future__ import annotations

import os
import plistlib
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from rekordbox_bridge.security import (
    RekordboxProcessSafetyError,
    StagingSafetyError,
    UnsafeWriterTargetError,
    _darwin_fixed_storage,
    create_backup_and_staging,
    detect_rekordbox_process,
    discover_trusted_writer_target,
    file_identity,
    preflight_writer_target,
    require_rekordbox_closed,
)


def local_db(tmp_path: Path, data: bytes = b"local rekordbox db") -> Path:
    path = tmp_path / "Pioneer" / "rekordbox" / "master.db"
    path.parent.mkdir(parents=True)
    path.write_bytes(data)
    return path


class Result:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class TestTargetGuard:
    def test_trusted_local_target(self, tmp_path):
        db = local_db(tmp_path)
        result = preflight_writer_target(
            db,
            system="Darwin",
            trusted_candidates=[db],
            storage_probe=lambda _path: True,
        )
        assert result.eligible is True
        assert result.source_identity == file_identity(db)

    def test_removable_volume_is_rejected_before_file_access(self):
        candidate = Path("/Volumes/DJ-USB/PIONEER/master.db")
        result = preflight_writer_target(
            candidate,
            system="Darwin",
            trusted_candidates=[candidate],
            storage_probe=lambda _path: True,
        )
        assert result.eligible is False
        assert result.code == "removable-target"

    def test_symlink_to_other_target_is_rejected(self, tmp_path):
        real = local_db(tmp_path / "real")
        link_dir = tmp_path / "link"
        link_dir.mkdir()
        link = link_dir / "master.db"
        link.symlink_to(real)
        result = preflight_writer_target(
            link,
            system="Darwin",
            trusted_candidates=[link],
            storage_probe=lambda _path: True,
        )
        assert result.code == "symlink-target"

    def test_parent_symlink_is_rejected(self, tmp_path):
        real_dir = tmp_path / "real"
        real_dir.mkdir()
        (real_dir / "master.db").write_bytes(b"db")
        alias = tmp_path / "alias"
        alias.symlink_to(real_dir, target_is_directory=True)
        candidate = alias / "master.db"
        result = preflight_writer_target(
            candidate,
            system="Darwin",
            trusted_candidates=[candidate],
            storage_probe=lambda _path: True,
        )
        assert result.code == "symlink-target"

    def test_path_traversal_alias_is_rejected(self, tmp_path):
        db = local_db(tmp_path)
        traversal = db.parent / "unused" / ".." / "master.db"
        result = preflight_writer_target(
            traversal,
            system="Darwin",
            trusted_candidates=[db],
            storage_probe=lambda _path: True,
        )
        assert result.code == "path-alias"

    def test_non_fixed_storage_is_rejected(self, tmp_path):
        db = local_db(tmp_path)
        result = preflight_writer_target(
            db,
            system="Darwin",
            trusted_candidates=[db],
            storage_probe=lambda _path: False,
        )
        assert result.code == "non-fixed-storage"

    def test_ambiguous_storage_is_rejected(self, tmp_path):
        db = local_db(tmp_path)
        result = preflight_writer_target(
            db,
            system="Darwin",
            trusted_candidates=[db],
            storage_probe=lambda _path: None,
        )
        assert result.code == "storage-status-unknown"

    def test_missing_local_database_never_falls_back_to_usb(self):
        with patch("rekordbox_bridge.security.find_master_db", return_value=None):
            with pytest.raises(UnsafeWriterTargetError, match="USB fallback is forbidden"):
                discover_trusted_writer_target(system="Darwin", storage_probe=lambda _path: True)

    def test_unsupported_platform_fails_closed(self, tmp_path):
        db = local_db(tmp_path)
        result = preflight_writer_target(db, system="Linux", trusted_candidates=[db])
        assert result.eligible is False
        assert result.code == "unsupported-platform"


class TestStorageClassification:
    def test_macos_diskutil_requires_internal_nonremovable_nonejectable(self, tmp_path):
        db = local_db(tmp_path)
        calls = []

        def runner(command, **kwargs):
            calls.append(command)
            if command[0] == "/bin/df":
                return Result(0, "Filesystem 512-blocks Used Available Capacity Mounted on\n/dev/disk3 1 1 1 1% /\n")
            payload = plistlib.dumps(
                {"Internal": True, "RemovableMedia": False, "Ejectable": False}
            )
            return Result(0, payload)

        assert _darwin_fixed_storage(db, runner) is True
        assert calls[1][-1] == "/"

    def test_macos_diskutil_removable_or_ambiguous_fails_closed(self, tmp_path):
        db = local_db(tmp_path)

        def removable_runner(command, **kwargs):
            if command[0] == "/bin/df":
                return Result(0, "h\n/dev/disk4 1 1 1 1% /Volumes/USB\n")
            return Result(
                0,
                plistlib.dumps(
                    {"Internal": False, "RemovableMedia": True, "Ejectable": True}
                ),
            )

        def ambiguous_runner(command, **kwargs):
            if command[0] == "/bin/df":
                return Result(0, "h\n/dev/disk3 1 1 1 1% /\n")
            return Result(0, plistlib.dumps({"Internal": True}))

        assert _darwin_fixed_storage(db, removable_runner) is False
        assert _darwin_fixed_storage(db, ambiguous_runner) is None


class TestProcessGuard:
    def test_macos_running_is_rejected(self):
        result = detect_rekordbox_process(
            system="Darwin", runner=lambda *args, **kwargs: Result(0, "123\n")
        )
        assert result.state == "running"
        with pytest.raises(RekordboxProcessSafetyError):
            require_rekordbox_closed(
                system="Darwin", runner=lambda *args, **kwargs: Result(0, "123\n")
            )

    def test_macos_closed_is_eligible(self):
        result = require_rekordbox_closed(
            system="Darwin", runner=lambda *args, **kwargs: Result(1, "")
        )
        assert result.state == "closed"

    def test_process_detection_failure_is_unknown_and_rejected(self):
        def broken(*args, **kwargs):
            raise OSError("pgrep unavailable")

        result = detect_rekordbox_process(system="Darwin", runner=broken)
        assert result.state == "unknown"
        with pytest.raises(RekordboxProcessSafetyError):
            require_rekordbox_closed(system="Darwin", runner=broken)

    def test_windows_running_detection(self):
        result = detect_rekordbox_process(
            system="Windows",
            runner=lambda *args, **kwargs: Result(0, '"rekordbox.exe","1234","Console"'),
        )
        assert result.state == "running"

    def test_unsupported_process_detection_fails_closed(self):
        assert detect_rekordbox_process(system="Linux").state == "unknown"


class TestBackupAndStaging:
    def test_backup_and_staging_are_same_generation_and_source_unchanged(self, tmp_path):
        db = local_db(tmp_path, b"generation-one")
        before_stat = db.stat()
        generation = create_backup_and_staging(
            db,
            operation_id="operation123",
            now=datetime(2026, 8, 20, 23, 59, tzinfo=timezone.utc),
        )
        assert generation.source_path == db.resolve()
        assert (
            generation.source_identity
            == generation.backup_identity
            == generation.staging_identity
        )
        assert generation.backup_path.read_bytes() == b"generation-one"
        assert generation.staging_path.read_bytes() == b"generation-one"
        assert db.read_bytes() == b"generation-one"
        assert db.stat().st_mtime_ns == before_stat.st_mtime_ns
        assert generation.staging_path != db
        assert generation.backup_path != db

    def test_backup_is_non_overwriting(self, tmp_path):
        db = local_db(tmp_path)
        kwargs = {
            "operation_id": "collision123",
            "now": datetime(2026, 8, 20, 23, 59, tzinfo=timezone.utc),
        }
        first = create_backup_and_staging(db, **kwargs)
        original_backup = first.backup_path.read_bytes()
        with pytest.raises(StagingSafetyError):
            create_backup_and_staging(db, **kwargs)
        assert first.backup_path.read_bytes() == original_backup

    def test_source_symlink_is_rejected(self, tmp_path):
        db = local_db(tmp_path / "real")
        link = tmp_path / "master.db"
        link.symlink_to(db)
        with pytest.raises(StagingSafetyError, match="symlink"):
            create_backup_and_staging(link, operation_id="symlink123")

    def test_copy_failure_does_not_modify_source(self, tmp_path, monkeypatch):
        db = local_db(tmp_path, b"immutable")
        before = file_identity(db)

        def explode(*args, **kwargs):
            raise OSError("disk full")

        monkeypatch.setattr("rekordbox_bridge.security.shutil.copyfileobj", explode)
        with pytest.raises(StagingSafetyError):
            create_backup_and_staging(db, operation_id="copyfail123")
        assert file_identity(db) == before

    @pytest.mark.skipif(not hasattr(os, "symlink"), reason="symlinks unsupported")
    def test_staging_directory_alias_is_not_used(self, tmp_path):
        db = local_db(tmp_path)
        root = db.parent / ".dropdex-writer"
        outside = tmp_path / "outside"
        outside.mkdir()
        root.symlink_to(outside, target_is_directory=True)
        with pytest.raises(StagingSafetyError, match="symlink"):
            create_backup_and_staging(db, operation_id="aliasdir123")
