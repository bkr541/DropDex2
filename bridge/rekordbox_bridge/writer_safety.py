"""Fail-closed safety gates and filesystem primitives for local Rekordbox writes."""
from __future__ import annotations

import ctypes
import hashlib
import os
import platform
import plistlib
import shutil
import stat
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from uuid import uuid4

from .discovery import find_master_db
from .writer_models import LocalDbIdentity, ProcessState


class WriterSafetyError(RuntimeError):
    """A structured, user-safe writer blocker."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True, slots=True)
class StorageSafety:
    safe: bool
    kind: str
    reason: str


@dataclass(frozen=True, slots=True)
class StagingArtifacts:
    operation_id: str
    backup_path: Path
    staging_path: Path
    source_sha256: str


StorageProbe = Callable[[Path], StorageSafety]
ProcessProbe = Callable[[], ProcessState]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _has_symlink_component(path: Path) -> bool:
    absolute = path if path.is_absolute() else Path.cwd() / path
    current = Path(absolute.anchor) if absolute.anchor else Path()
    for part in absolute.parts[1:] if absolute.anchor else absolute.parts:
        current = current / part
        try:
            if current.is_symlink():
                return True
        except OSError:
            return True
    return False


def _canonical_regular_master_db(path: Path) -> Path:
    if ".." in path.parts:
        raise WriterSafetyError("unsafe_path_alias", "Writer target contains a parent-path alias")
    if _has_symlink_component(path):
        raise WriterSafetyError("unsafe_symlink", "Writer target contains a symlink component")
    try:
        resolved = path.resolve(strict=True)
        mode = resolved.stat().st_mode
    except OSError as exc:
        raise WriterSafetyError(
            "target_unavailable", "Local Rekordbox database is unavailable"
        ) from exc
    if not stat.S_ISREG(mode):
        raise WriterSafetyError(
            "target_not_regular", "Local Rekordbox database is not a regular file"
        )
    if resolved.name.casefold() != "master.db":
        raise WriterSafetyError("unexpected_target", "Trusted Rekordbox target is not master.db")
    return resolved


def _macos_mount_point(path: Path) -> Path:
    current = path if path.is_dir() else path.parent
    try:
        device = current.stat().st_dev
    except OSError as exc:
        raise WriterSafetyError(
            "storage_unknown", "Could not identify the database volume"
        ) from exc
    while current.parent != current:
        try:
            if current.parent.stat().st_dev != device:
                break
        except OSError as exc:
            raise WriterSafetyError(
                "storage_unknown", "Could not identify the database volume"
            ) from exc
        current = current.parent
    return current


def detect_storage_safety(path: Path, system: str | None = None) -> StorageSafety:
    """Classify the target volume. Unknown/unsupported states are unsafe."""
    system = system or platform.system()
    if system == "Darwin":
        mount_point = _macos_mount_point(path)
        try:
            proc = subprocess.run(
                ["diskutil", "info", "-plist", str(mount_point)],
                capture_output=True,
                check=False,
                timeout=8,
            )
            if proc.returncode != 0:
                return StorageSafety(
                    False, "unknown", "diskutil could not classify the target volume"
                )
            info = plistlib.loads(proc.stdout)
        except (OSError, subprocess.SubprocessError, plistlib.InvalidFileException, ValueError):
            return StorageSafety(False, "unknown", "Target volume classification failed")

        internal = info.get("Internal")
        removable = info.get("RemovableMedia")
        ejectable = info.get("Ejectable")
        if internal is True and removable is False and ejectable is False:
            return StorageSafety(True, "internal-fixed", "Target is on internal fixed storage")
        if removable is True or ejectable is True or internal is False:
            return StorageSafety(
                False, "removable-or-external", "Target is removable or external storage"
            )
        return StorageSafety(
            False, "unknown", "Target volume did not report a safe fixed-storage state"
        )

    if system == "Windows":
        drive = path.drive
        if not drive:
            return StorageSafety(False, "unknown", "Target does not have a local Windows drive")
        root = f"{drive}\\"
        try:
            drive_type = ctypes.windll.kernel32.GetDriveTypeW(root)  # type: ignore[attr-defined]
        except (AttributeError, OSError):
            return StorageSafety(False, "unknown", "Windows drive type could not be determined")
        # GetDriveType alone can classify some external USB hard drives as fixed.
        # The trusted desktop collection is therefore restricted to the Windows
        # system volume as a second independent fail-closed check.
        system_drive = os.environ.get("SystemDrive")
        if drive_type != 3:
            if drive_type == 2:
                return StorageSafety(False, "removable", "Target is on removable storage")
            return StorageSafety(False, "non-fixed", "Target is not on a fixed local drive")
        if not system_drive or drive.casefold() != system_drive.rstrip("\\").casefold():
            return StorageSafety(
                False,
                "non-system-fixed",
                "Target is not on the trusted Windows system volume",
            )
        return StorageSafety(True, "internal-fixed", "Target is on the trusted fixed system volume")

    return StorageSafety(False, "unsupported", f"Writer storage checks are unsupported on {system}")


def detect_rekordbox_process(system: str | None = None) -> ProcessState:
    """Return a fail-closed Rekordbox process state for supported desktop platforms."""
    system = system or platform.system()
    if system == "Darwin":
        try:
            proc = subprocess.run(
                ["ps", "-axo", "comm="],
                capture_output=True,
                text=True,
                check=False,
                timeout=8,
            )
        except (OSError, subprocess.SubprocessError):
            return ProcessState(
                False, None, True, "Could not determine whether Rekordbox is running"
            )
        if proc.returncode != 0:
            return ProcessState(
                False, None, True, "Could not determine whether Rekordbox is running"
            )
        names = {
            Path(line.strip()).name.casefold()
            for line in proc.stdout.splitlines()
            if line.strip()
        }
        running = "rekordbox" in names or "rekordbox.exe" in names
        return ProcessState(
            not running,
            running,
            True,
            "Rekordbox is running" if running else "Rekordbox is closed",
        )

    if system == "Windows":
        try:
            proc = subprocess.run(
                ["tasklist", "/FI", "IMAGENAME eq rekordbox.exe", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                check=False,
                timeout=8,
            )
        except (OSError, subprocess.SubprocessError):
            return ProcessState(
                False, None, True, "Could not determine whether Rekordbox is running"
            )
        if proc.returncode != 0:
            return ProcessState(
                False, None, True, "Could not determine whether Rekordbox is running"
            )
        output = proc.stdout.casefold()
        running = '"rekordbox.exe"' in output or output.lstrip().startswith("rekordbox.exe")
        return ProcessState(
            not running,
            running,
            True,
            "Rekordbox is running" if running else "Rekordbox is closed",
        )

    return ProcessState(False, None, False, f"Writer process checks are unsupported on {system}")


def resolve_trusted_local_master_db(
    *,
    storage_probe: StorageProbe = detect_storage_safety,
) -> tuple[Path, LocalDbIdentity]:
    """Resolve the production writer target exclusively through trusted discovery."""
    discovered = find_master_db()
    if discovered is None:
        raise WriterSafetyError("database_not_found", "Local Rekordbox master.db was not found")
    return _validate_trusted_target(discovered, storage_probe=storage_probe)


def _validate_trusted_target(
    path: Path,
    *,
    storage_probe: StorageProbe,
) -> tuple[Path, LocalDbIdentity]:
    """Private seam used by integration tests; production callers use discovery above."""
    canonical = _canonical_regular_master_db(path)
    storage = storage_probe(canonical)
    if not storage.safe:
        raise WriterSafetyError("unsafe_storage", storage.reason)
    source_hash = sha256_file(canonical)
    identity = LocalDbIdentity(
        display_name="Rekordbox local master.db",
        source_sha256=source_hash,
        storage_kind=storage.kind,
    )
    return canonical, identity


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def _copy_exclusive(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(destination, flags, 0o600)
    try:
        with source.open("rb") as src, os.fdopen(fd, "wb", closefd=False) as dst:
            shutil.copyfileobj(src, dst, length=1024 * 1024)
            dst.flush()
            os.fsync(dst.fileno())
        shutil.copystat(source, destination, follow_symlinks=False)
        _fsync_directory(destination.parent)
    except Exception:
        try:
            destination.unlink(missing_ok=True)
        finally:
            os.close(fd)
        raise
    else:
        os.close(fd)



def _validate_artifact_root(root: Path, source: Path) -> None:
    """Keep backup/staging on the same trusted filesystem as the local source."""
    if ".." in root.parts or _has_symlink_component(root):
        raise WriterSafetyError(
            "unsafe_artifact_root", "Writer artifact root contains an unsafe alias"
        )

    parent = root
    while not parent.exists() and parent.parent != parent:
        parent = parent.parent
    try:
        parent_resolved = parent.resolve(strict=True)
        if parent_resolved.stat().st_dev != source.stat().st_dev:
            raise WriterSafetyError(
                "unsafe_artifact_root",
                "Writer artifacts must stay on the trusted local database filesystem",
            )
    except WriterSafetyError:
        raise
    except OSError as exc:
        raise WriterSafetyError(
            "unsafe_artifact_root", "Writer artifact filesystem could not be verified"
        ) from exc

def create_backup_and_staging(
    source_path: Path,
    *,
    artifact_root: Path | None = None,
    operation_id: str | None = None,
    now: datetime | None = None,
) -> StagingArtifacts:
    """Copy a known-good source to immutable backup, then stage from that backup."""
    source = _canonical_regular_master_db(source_path)
    root = artifact_root or source.parent / ".dropdex-writer"
    _validate_artifact_root(root, source)
    operation_id = operation_id or uuid4().hex
    if not operation_id.isalnum() or len(operation_id) > 64:
        raise WriterSafetyError("invalid_operation_id", "Writer operation ID is invalid")
    now = now or datetime.now(timezone.utc)
    timestamp = now.astimezone(timezone.utc).strftime("%Y%m%d-%H%M%S-%fZ")

    backup_dir = root / "backups"
    stage_dir = root / "staging" / operation_id
    try:
        stage_dir.mkdir(parents=True, exist_ok=False)
    except OSError as exc:
        raise WriterSafetyError(
            "staging_setup_failed", "Could not create isolated staging directory"
        ) from exc

    backup_path = backup_dir / f"master-backup-{timestamp}-{operation_id}.db"
    staging_path = stage_dir / "master.db"
    source_before = sha256_file(source)

    try:
        _copy_exclusive(source, backup_path)
        if sha256_file(backup_path) != source_before:
            raise WriterSafetyError(
                "backup_verification_failed", "Backup does not match source database"
            )
        # Backup is immutable for the remainder of the operation.
        try:
            backup_path.chmod(0o400)
        except OSError:
            pass

        # Stage from the verified backup so source and stage share one known generation.
        _copy_exclusive(backup_path, staging_path)
        try:
            staging_path.chmod(0o600)
        except OSError:
            pass
        if sha256_file(staging_path) != source_before:
            raise WriterSafetyError(
                "staging_verification_failed", "Staging copy does not match backup"
            )
        if sha256_file(source) != source_before:
            raise WriterSafetyError(
                "source_changed", "Local Rekordbox database changed during staging"
            )
    except WriterSafetyError:
        try:
            staging_path.unlink(missing_ok=True)
            stage_dir.rmdir()
        except OSError:
            pass
        raise
    except (OSError, shutil.Error) as exc:
        try:
            staging_path.unlink(missing_ok=True)
            stage_dir.rmdir()
        except OSError:
            pass
        raise WriterSafetyError("copy_failed", "Backup or staging copy failed") from exc

    return StagingArtifacts(
        operation_id=operation_id,
        backup_path=backup_path,
        staging_path=staging_path,
        source_sha256=source_before,
    )
