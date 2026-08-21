"""Filesystem/database safety for the read-only bridge and Stage 5 writer."""
from __future__ import annotations

import ctypes
import hashlib
import os
import platform
import plistlib
import re
import shutil
import stat
import subprocess
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterator, Optional, Sequence
from uuid import uuid4

from .discovery import candidate_master_db_paths, find_master_db
from .writer_models import ProcessSafetyResult, StagingGeneration, TargetSafetyResult

_OPERATION_RE = re.compile(r"^[A-Za-z0-9_-]{8,80}$")


@contextmanager
def readonly_snapshot(source_path: Path) -> Iterator[Path]:
    """Copy ``source_path`` to a private read-only temp file and clean it up.

    This remains the existing read-only export/upload isolation primitive. Stage
    5 write-capable operations use the stricter trusted-target and staging
    helpers below and never mutate this snapshot or the live source.
    """
    src_stat = source_path.stat()
    if not stat.S_ISREG(src_stat.st_mode):
        raise ValueError(f"source_path must be a regular file, got: {source_path}")

    fd, temp_name = tempfile.mkstemp(suffix=".db", prefix="dropdex_bridge_")
    os.close(fd)
    tmp_path = Path(temp_name)
    try:
        shutil.copy2(str(source_path), tmp_path)
        tmp_path.chmod(0o400)
        yield tmp_path
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass


class UnsafeWriterTargetError(RuntimeError):
    """The write-capable target could not be proven to be trusted local storage."""


class RekordboxProcessSafetyError(RuntimeError):
    """Rekordbox is running or its process state cannot be established safely."""


class StagingSafetyError(RuntimeError):
    """Backup/staging generation could not be created without ambiguity."""


def file_identity(path: Path) -> str:
    """Return a SHA-256 identity for a regular file without exposing its path."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _has_symlink_component(path: Path) -> bool:
    """Return True when any existing component of *path* is a symlink."""
    absolute = path.absolute()
    current = Path(absolute.anchor) if absolute.anchor else Path()
    for part in absolute.parts[1:] if absolute.anchor else absolute.parts:
        current = current / part
        try:
            if current.is_symlink():
                return True
        except OSError:
            return True
    return False


def _looks_like_removable_mount(path: Path, system: str) -> bool:
    text = str(path).replace("\\", "/").lower()
    if system == "Darwin":
        return text == "/volumes" or text.startswith("/volumes/")
    if system not in ("Darwin", "Windows"):
        return any(
            text == prefix or text.startswith(prefix + "/")
            for prefix in ("/media", "/mnt", "/run/media")
        )
    return False


def _darwin_fixed_storage(
    path: Path,
    runner: Callable[..., subprocess.CompletedProcess],
) -> Optional[bool]:
    """Classify the filesystem containing *path* using ``df`` + ``diskutil``.

    ``diskutil info`` accepts a mount point, not an arbitrary file path on all
    supported macOS releases, so resolve the containing mount first. Any
    command/parsing ambiguity returns ``None`` and therefore fails closed.
    """
    try:
        df = runner(
            ["/bin/df", "-P", str(path)],
            check=False,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if df.returncode != 0 or not df.stdout:
        return None
    lines = [line for line in df.stdout.splitlines() if line.strip()]
    if len(lines) < 2:
        return None
    fields = lines[-1].split(None, 5)
    if len(fields) != 6:
        return None
    mount_point = fields[5]

    try:
        completed = runner(
            ["/usr/sbin/diskutil", "info", "-plist", mount_point],
            check=False,
            capture_output=True,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0 or not completed.stdout:
        return None
    try:
        info = plistlib.loads(completed.stdout)
    except (plistlib.InvalidFileException, ValueError, TypeError):
        return None

    internal = info.get("Internal")
    removable = info.get("RemovableMedia")
    ejectable = info.get("Ejectable")
    if not all(isinstance(value, bool) for value in (internal, removable, ejectable)):
        return None
    return bool(internal and not removable and not ejectable)


def _windows_fixed_storage(path: Path) -> Optional[bool]:
    """Use Win32 GetDriveTypeW; return None when the status is unavailable."""
    try:
        drive = path.drive
        if not drive:
            return None
        root = f"{drive}\\"
        get_drive_type = ctypes.windll.kernel32.GetDriveTypeW  # type: ignore[attr-defined]
        drive_type = int(get_drive_type(root))
    except (AttributeError, OSError, ValueError):
        return None
    # DRIVE_FIXED == 3. REMOVABLE=2, REMOTE=4, CDROM=5, RAMDISK=6.
    return drive_type == 3


def _storage_is_fixed_local(
    path: Path,
    *,
    system: str,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
    storage_probe: Optional[Callable[[Path], Optional[bool]]] = None,
) -> Optional[bool]:
    if storage_probe is not None:
        return storage_probe(path)
    if system == "Darwin":
        return _darwin_fixed_storage(path, runner)
    if system == "Windows":
        return _windows_fixed_storage(path)
    return None


def preflight_writer_target(
    candidate: Path,
    *,
    system: Optional[str] = None,
    trusted_candidates: Optional[Sequence[Path]] = None,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
    storage_probe: Optional[Callable[[Path], Optional[bool]]] = None,
) -> TargetSafetyResult:
    """Prove a candidate is the canonical trusted local ``master.db``.

    Production callers pass only the internally discovered path. The explicit
    candidate argument is retained as a test-only seam so removable/symlink
    falsification can be exercised without touching a real Rekordbox database.
    """
    system = system or platform.system()
    if system not in ("Darwin", "Windows"):
        return TargetSafetyResult(
            False,
            "unsupported-platform",
            "Writer target safety is unsupported on this platform.",
        )

    if not candidate.is_absolute() or ".." in candidate.parts:
        return TargetSafetyResult(
            False, "path-alias", "Relative or traversal-style writer targets are forbidden."
        )
    if candidate.name != "master.db":
        return TargetSafetyResult(
            False,
            "unexpected-target-name",
            "Writer target is not the trusted Rekordbox master database.",
        )
    if _looks_like_removable_mount(candidate, system):
        return TargetSafetyResult(
            False,
            "removable-target",
            "Removable or performance-media targets are permanently forbidden.",
        )
    if _has_symlink_component(candidate):
        return TargetSafetyResult(
            False, "symlink-target", "Symlink or alias targets are not eligible for writing."
        )

    try:
        source_stat = candidate.stat()
        resolved = candidate.resolve(strict=True)
    except (OSError, RuntimeError):
        return TargetSafetyResult(
            False, "target-unavailable", "Trusted local Rekordbox database is unavailable."
        )
    if not stat.S_ISREG(source_stat.st_mode):
        return TargetSafetyResult(
            False, "target-not-file", "Writer target is not a regular database file."
        )

    candidates = (
        trusted_candidates
        if trusted_candidates is not None
        else candidate_master_db_paths(system)
    )
    resolved_candidates: set[Path] = set()
    for expected in candidates:
        if _has_symlink_component(expected):
            continue
        try:
            if expected.exists():
                resolved_candidates.add(expected.resolve(strict=True))
            else:
                # Keep a lexical absolute candidate for tests where the source
                # is fabricated under the expected path but resolution is mocked.
                resolved_candidates.add(expected.absolute())
        except (OSError, RuntimeError):
            continue
    if resolved not in resolved_candidates and resolved.absolute() not in resolved_candidates:
        return TargetSafetyResult(
            False,
            "untrusted-discovery-path",
            "Target is outside DropDex's trusted Rekordbox discovery contract.",
        )

    fixed = _storage_is_fixed_local(
        resolved,
        system=system,
        runner=runner,
        storage_probe=storage_probe,
    )
    if fixed is not True:
        code = "non-fixed-storage" if fixed is False else "storage-status-unknown"
        return TargetSafetyResult(
            False,
            code,
            "Target could not be proven to be trusted internal fixed storage.",
        )

    try:
        identity = file_identity(resolved)
    except OSError:
        return TargetSafetyResult(
            False,
            "target-unreadable",
            "Trusted local Rekordbox database could not be fingerprinted.",
        )
    return TargetSafetyResult(
        True,
        "trusted-local-master-db",
        "Trusted local Rekordbox database is eligible for staging.",
        identity,
    )


def discover_trusted_writer_target(
    *,
    system: Optional[str] = None,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
    storage_probe: Optional[Callable[[Path], Optional[bool]]] = None,
) -> tuple[Path, TargetSafetyResult]:
    """Discover and prove the production writer target without accepting a path."""
    discovered = find_master_db()
    if discovered is None:
        raise UnsafeWriterTargetError(
            "Trusted local Rekordbox master.db was not found; USB fallback is forbidden."
        )
    result = preflight_writer_target(
        discovered,
        system=system,
        trusted_candidates=candidate_master_db_paths(system),
        runner=runner,
        storage_probe=storage_probe,
    )
    if not result.eligible:
        raise UnsafeWriterTargetError(f"{result.code}: {result.message}")
    return discovered.resolve(strict=True), result


def detect_rekordbox_process(
    *,
    system: Optional[str] = None,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> ProcessSafetyResult:
    """Return ``closed``, ``running``, or fail-closed ``unknown``."""
    system = system or platform.system()
    if system == "Darwin":
        try:
            completed = runner(
                ["/usr/bin/pgrep", "-x", "rekordbox"],
                check=False,
                capture_output=True,
                text=True,
            )
        except (OSError, subprocess.SubprocessError):
            return ProcessSafetyResult(
                "unknown",
                "process-detection-failed",
                "Could not establish whether Rekordbox is running.",
            )
        if completed.returncode == 0:
            return ProcessSafetyResult(
                "running",
                "rekordbox-running",
                "Rekordbox must be closed before staging mutation.",
            )
        if completed.returncode == 1:
            return ProcessSafetyResult("closed", "rekordbox-closed", "Rekordbox is not running.")
        return ProcessSafetyResult(
            "unknown", "process-detection-ambiguous", "Rekordbox process state is ambiguous."
        )

    if system == "Windows":
        try:
            completed = runner(
                ["tasklist", "/FI", "IMAGENAME eq rekordbox.exe", "/FO", "CSV", "/NH"],
                check=False,
                capture_output=True,
                text=True,
            )
        except (OSError, subprocess.SubprocessError):
            return ProcessSafetyResult(
                "unknown",
                "process-detection-failed",
                "Could not establish whether Rekordbox is running.",
            )
        if completed.returncode != 0:
            return ProcessSafetyResult(
            "unknown", "process-detection-ambiguous", "Rekordbox process state is ambiguous."
        )
        stdout = (completed.stdout or "").lower()
        if '"rekordbox.exe"' in stdout:
            return ProcessSafetyResult(
                "running",
                "rekordbox-running",
                "Rekordbox must be closed before staging mutation.",
            )
        if "no tasks are running" in stdout or "info: no tasks" in stdout or not stdout.strip():
            return ProcessSafetyResult("closed", "rekordbox-closed", "Rekordbox is not running.")
        return ProcessSafetyResult(
            "unknown", "process-output-unrecognized", "Rekordbox process state is ambiguous."
        )

    return ProcessSafetyResult(
        "unknown",
        "unsupported-platform",
        "Rekordbox process detection is unsupported on this platform.",
    )


def require_rekordbox_closed(
    *,
    system: Optional[str] = None,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> ProcessSafetyResult:
    result = detect_rekordbox_process(system=system, runner=runner)
    if not result.eligible:
        raise RekordboxProcessSafetyError(f"{result.code}: {result.message}")
    return result


def _exclusive_copy(source: Path, destination: Path, mode: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if _has_symlink_component(destination.parent):
        raise StagingSafetyError("Backup/staging directory contains a symlink component.")
    created = False
    try:
        with source.open("rb") as src:
            with destination.open("xb") as dst:
                created = True
                shutil.copyfileobj(src, dst, length=1024 * 1024)
                dst.flush()
                os.fsync(dst.fileno())
        destination.chmod(mode)
    except Exception:  # noqa: BLE001 - cleanup partial file before re-raising
        # Never delete a destination that existed before this invocation. That
        # would turn collision protection into backup destruction.
        if created:
            try:
                destination.unlink(missing_ok=True)
            except OSError:
                pass
        raise


def create_backup_and_staging(
    source_path: Path,
    *,
    operation_id: Optional[str] = None,
    now: Optional[datetime] = None,
) -> StagingGeneration:
    """Create a collision-safe backup then writable staging copy.

    Staging is copied from the verified backup, not independently from the live
    source, so backup and staging are guaranteed to represent the same captured
    source generation. The live ``master.db`` is never opened for writing.
    """
    operation_id = operation_id or uuid4().hex
    if not _OPERATION_RE.fullmatch(operation_id):
        raise StagingSafetyError("Invalid operation identifier.")
    now = now or datetime.now(timezone.utc)

    try:
        source = source_path.resolve(strict=True)
        source_stat = source.stat()
    except OSError as exc:
        raise StagingSafetyError("Source database is unavailable.") from exc
    if not stat.S_ISREG(source_stat.st_mode):
        raise StagingSafetyError("Source database is not a regular file.")
    if _has_symlink_component(source_path):
        raise StagingSafetyError("Source database may not be reached through a symlink or alias.")

    root = source.parent / ".dropdex-writer"
    backup_dir = root / "backups"
    staging_dir = root / "staging" / operation_id
    timestamp = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = backup_dir / f"master-stage5-{timestamp}-{operation_id}.db"
    staging = staging_dir / "master.db"

    before = file_identity(source)
    try:
        _exclusive_copy(source, backup, 0o400)
        backup_id = file_identity(backup)
        after_backup = file_identity(source)
        if before != backup_id or before != after_backup:
            backup.unlink(missing_ok=True)
            raise StagingSafetyError(
                "Source database changed while the backup generation was captured."
            )

        _exclusive_copy(backup, staging, 0o600)
        staging_id = file_identity(staging)
        after_staging = file_identity(source)
        if staging_id != backup_id or after_staging != before:
            staging.unlink(missing_ok=True)
            backup.unlink(missing_ok=True)
            raise StagingSafetyError("Source/backup/staging generation identity mismatch.")
    except StagingSafetyError:
        raise
    except (OSError, shutil.Error) as exc:
        raise StagingSafetyError(
            "Backup or staging copy failed safely before live mutation."
        ) from exc

    return StagingGeneration(
        operation_id=operation_id,
        source_path=source,
        backup_path=backup,
        staging_path=staging,
        source_identity=before,
        backup_identity=backup_id,
        staging_identity=staging_id,
    )
