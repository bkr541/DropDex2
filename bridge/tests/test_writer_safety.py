from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path, PureWindowsPath
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from rekordbox_bridge.writer_models import ProcessState
from rekordbox_bridge.writer_safety import (
    StorageSafety,
    WriterSafetyError,
    _validate_trusted_target,
    create_backup_and_staging,
    detect_rekordbox_process,
    detect_storage_safety,
    sha256_file,
)


def _safe_storage(_path: Path) -> StorageSafety:
    return StorageSafety(True, "internal-fixed", "safe test fixture")


def _unsafe_storage(_path: Path) -> StorageSafety:
    return StorageSafety(False, "removable", "USB/removable targets are forbidden")


def test_trusted_local_fixture_is_accepted(tmp_path):
    db = tmp_path / "master.db"
    db.write_bytes(b"trusted")
    canonical, identity = _validate_trusted_target(db, storage_probe=_safe_storage)
    assert canonical == db.resolve()
    assert identity.storage_kind == "internal-fixed"
    assert identity.source_sha256 == sha256_file(db)


def test_removable_target_is_rejected(tmp_path):
    db = tmp_path / "master.db"
    db.write_bytes(b"usb")
    with pytest.raises(WriterSafetyError, match="USB/removable"):
        _validate_trusted_target(db, storage_probe=_unsafe_storage)


def test_symlink_to_master_db_is_rejected(tmp_path):
    real = tmp_path / "real" / "master.db"
    real.parent.mkdir()
    real.write_bytes(b"db")
    alias_dir = tmp_path / "alias"
    try:
        alias_dir.symlink_to(real.parent, target_is_directory=True)
    except OSError:
        pytest.skip("symlink creation is unavailable")
    with pytest.raises(WriterSafetyError) as exc:
        _validate_trusted_target(alias_dir / "master.db", storage_probe=_safe_storage)
    assert exc.value.code == "unsafe_symlink"


def test_parent_alias_is_rejected_before_resolution(tmp_path):
    nested = tmp_path / "nested"
    nested.mkdir()
    db = tmp_path / "master.db"
    db.write_bytes(b"db")
    aliased = nested / ".." / "master.db"
    with pytest.raises(WriterSafetyError) as exc:
        _validate_trusted_target(aliased, storage_probe=_safe_storage)
    assert exc.value.code == "unsafe_path_alias"


def test_unsupported_storage_platform_fails_closed(tmp_path):
    db = tmp_path / "master.db"
    db.write_bytes(b"db")
    result = detect_storage_safety(db, system="Linux")
    assert result.safe is False
    assert result.kind == "unsupported"


def test_macos_external_volume_is_rejected(tmp_path):
    db = tmp_path / "master.db"
    db.write_bytes(b"db")
    plist = b"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
    <plist version=\"1.0\"><dict>
    <key>Internal</key><false/><key>RemovableMedia</key><true/><key>Ejectable</key><true/>
    </dict></plist>"""
    proc = SimpleNamespace(returncode=0, stdout=plist)
    with patch("rekordbox_bridge.writer_safety._macos_mount_point", return_value=tmp_path), \
         patch("rekordbox_bridge.writer_safety.subprocess.run", return_value=proc):
        result = detect_storage_safety(db, system="Darwin")
    assert result.safe is False
    assert result.kind == "removable-or-external"


def test_macos_internal_volume_is_accepted(tmp_path):
    db = tmp_path / "master.db"
    db.write_bytes(b"db")
    plist = b"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
    <plist version=\"1.0\"><dict>
    <key>Internal</key><true/><key>RemovableMedia</key><false/><key>Ejectable</key><false/>
    </dict></plist>"""
    proc = SimpleNamespace(returncode=0, stdout=plist)
    with patch("rekordbox_bridge.writer_safety._macos_mount_point", return_value=tmp_path), \
         patch("rekordbox_bridge.writer_safety.subprocess.run", return_value=proc):
        result = detect_storage_safety(db, system="Darwin")
    assert result.safe is True


def test_rekordbox_running_blocks_macos():
    proc = SimpleNamespace(
        returncode=0,
        stdout="/Applications/rekordbox.app/Contents/MacOS/rekordbox\n",
    )
    with patch("rekordbox_bridge.writer_safety.subprocess.run", return_value=proc):
        result = detect_rekordbox_process(system="Darwin")
    assert result == ProcessState(False, True, True, "Rekordbox is running")


def test_windows_fixed_system_drive_is_accepted(monkeypatch):
    fake_kernel32 = SimpleNamespace(GetDriveTypeW=lambda _root: 3)
    fake_windll = SimpleNamespace(kernel32=fake_kernel32)
    monkeypatch.setenv("SystemDrive", "C:")
    with patch("rekordbox_bridge.writer_safety.ctypes.windll", fake_windll, create=True):
        result = detect_storage_safety(
            PureWindowsPath("C:/Users/Test/AppData/Local/Pioneer/rekordbox/master.db"),
            system="Windows",
        )
    assert result.safe is True
    assert result.kind == "internal-fixed"


def test_windows_fixed_non_system_drive_fails_closed(monkeypatch):
    fake_kernel32 = SimpleNamespace(GetDriveTypeW=lambda _root: 3)
    fake_windll = SimpleNamespace(kernel32=fake_kernel32)
    monkeypatch.setenv("SystemDrive", "C:")
    with patch("rekordbox_bridge.writer_safety.ctypes.windll", fake_windll, create=True):
        result = detect_storage_safety(
            PureWindowsPath("E:/Pioneer/rekordbox/master.db"),
            system="Windows",
        )
    assert result.safe is False
    assert result.kind == "non-system-fixed"


def test_windows_removable_drive_is_rejected(monkeypatch):
    fake_kernel32 = SimpleNamespace(GetDriveTypeW=lambda _root: 2)
    fake_windll = SimpleNamespace(kernel32=fake_kernel32)
    monkeypatch.setenv("SystemDrive", "C:")
    with patch("rekordbox_bridge.writer_safety.ctypes.windll", fake_windll, create=True):
        result = detect_storage_safety(
            PureWindowsPath("E:/Pioneer/rekordbox/master.db"),
            system="Windows",
        )
    assert result.safe is False
    assert result.kind == "removable"


def test_rekordbox_running_blocks_windows():
    proc = SimpleNamespace(returncode=0, stdout='"rekordbox.exe","1234","Console"\n')
    with patch("rekordbox_bridge.writer_safety.subprocess.run", return_value=proc):
        result = detect_rekordbox_process(system="Windows")
    assert result == ProcessState(False, True, True, "Rekordbox is running")


def test_process_detection_unsupported_fails_closed():
    result = detect_rekordbox_process(system="Linux")
    assert result.safe_to_write is False
    assert result.running is None
    assert result.supported is False


def test_backup_and_staging_are_same_generation_and_source_unchanged(tmp_path):
    source = tmp_path / "master.db"
    source.write_bytes(b"generation-1")
    before = sha256_file(source)
    artifacts = create_backup_and_staging(
        source,
        artifact_root=tmp_path / "writer",
        operation_id="op123",
        now=datetime(2026, 8, 20, 16, 0, tzinfo=timezone.utc),
    )
    assert artifacts.backup_path.name == "master-backup-20260820-160000-000000Z-op123.db"
    assert sha256_file(artifacts.backup_path) == before
    assert sha256_file(artifacts.staging_path) == before
    assert sha256_file(source) == before
    if os.name != "nt":
        assert artifacts.backup_path.stat().st_mode & 0o222 == 0
        assert artifacts.staging_path.stat().st_mode & 0o200 != 0


def test_backup_never_overwrites_existing_file(tmp_path):
    source = tmp_path / "master.db"
    source.write_bytes(b"generation-1")
    now = datetime(2026, 8, 20, 16, 0, tzinfo=timezone.utc)
    create_backup_and_staging(
        source,
        artifact_root=tmp_path / "writer",
        operation_id="op123",
        now=now,
    )
    with pytest.raises(WriterSafetyError):
        create_backup_and_staging(
            source,
            artifact_root=tmp_path / "writer",
            operation_id="op123",
            now=now,
        )


def test_symlinked_artifact_root_is_rejected(tmp_path):
    source = tmp_path / "master.db"
    source.write_bytes(b"generation-1")
    real_root = tmp_path / "real-artifacts"
    real_root.mkdir()
    alias_root = tmp_path / "artifact-alias"
    try:
        alias_root.symlink_to(real_root, target_is_directory=True)
    except OSError:
        pytest.skip("symlink creation is unavailable")

    with pytest.raises(WriterSafetyError) as exc:
        create_backup_and_staging(
            source,
            artifact_root=alias_root,
            operation_id="op123",
        )
    assert exc.value.code == "unsafe_artifact_root"
    assert not list(real_root.iterdir())


def test_stage_copy_failure_keeps_verified_backup_and_source(tmp_path):
    source = tmp_path / "master.db"
    source.write_bytes(b"generation-1")
    before = source.read_bytes()

    from rekordbox_bridge import writer_safety

    original_copy = writer_safety._copy_exclusive
    calls = 0

    def fail_second_copy(src, dst):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("simulated stage copy failure")
        original_copy(src, dst)

    with patch("rekordbox_bridge.writer_safety._copy_exclusive", side_effect=fail_second_copy):
        with pytest.raises(WriterSafetyError) as exc:
            create_backup_and_staging(
                source,
                artifact_root=tmp_path / "writer",
                operation_id="opcopyfail",
            )

    assert exc.value.code == "copy_failed"
    backups = list((tmp_path / "writer" / "backups").glob("*.db"))
    assert len(backups) == 1, "a verified backup must not be deleted after staging fails"
    assert backups[0].read_bytes() == before
    assert source.read_bytes() == before
