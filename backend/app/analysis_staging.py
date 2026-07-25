"""Durable, request-independent staging for Rekordbox analysis assets.

Files are written atomically beneath a configurable root using opaque import and
track identifiers. Only relative staging keys are persisted in Postgres, so API
clients never receive server filesystem paths. A mounted persistent volume is
recommended in production; local development defaults to the system temp area.
"""

from __future__ import annotations

import os
import re
import shutil
import tarfile
import tempfile
from pathlib import Path
from typing import Iterable

_SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9_.-]+")


def _segment(value: str) -> str:
    cleaned = _SAFE_SEGMENT.sub("_", str(value)).strip("._")
    if not cleaned:
        raise ValueError("Invalid staging key segment")
    return cleaned[:160]


def staging_root(configured_root: str | None = None) -> Path:
    raw = configured_root or os.getenv("DROPDEX_ANALYSIS_STAGING_ROOT")
    root = Path(raw).expanduser() if raw else Path(tempfile.gettempdir()) / "dropdex-analysis-staging"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def validate_staging_root(
    configured_root: str | None = None,
    *,
    environment: str = "development",
) -> dict[str, str | bool]:
    """Validate that request-independent staging is present and writable.

    Production must use an explicitly configured persistent/shared mount. The
    write probe catches read-only or missing volume mounts before an import can
    accept thousands of USB files and then discover that resume is impossible.
    """
    if environment.strip().lower() == "production" and not (
        configured_root or os.getenv("DROPDEX_ANALYSIS_STAGING_ROOT")
    ):
        raise RuntimeError(
            "DROPDEX_ANALYSIS_STAGING_ROOT is required in production"
        )
    root = staging_root(configured_root)
    probe = root / f".dropdex-write-probe-{os.getpid()}"
    try:
        with probe.open("wb") as handle:
            handle.write(b"dropdex-staging-health")
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        probe.unlink(missing_ok=True)
    return {
        "ok": True,
        "configured": bool(configured_root or os.getenv("DROPDEX_ANALYSIS_STAGING_ROOT")),
        "path": str(root),
    }


def build_staging_key(import_id: str, track_id: str, asset_type: str, sha256: str) -> str:
    suffix = asset_type.lower()
    return "/".join(
        (
            _segment(import_id),
            "assets",
            _segment(track_id),
            f"{_segment(sha256)}.{_segment(suffix)}",
        )
    )


def resolve_staging_key(key: str, configured_root: str | None = None) -> Path:
    root = staging_root(configured_root)
    candidate = (root / key).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Staging key escapes configured root")
    return candidate


def write_staged_bytes(key: str, content: bytes, configured_root: str | None = None) -> Path:
    destination = resolve_staging_key(key, configured_root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=".upload-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, destination)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise
    return destination


def copy_staged_file(
    key: str,
    source_path: str | Path,
    configured_root: str | None = None,
) -> Path:
    """Atomically stream an existing file into durable staging."""
    destination = resolve_staging_key(key, configured_root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=".copy-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as target, Path(source_path).open("rb") as source:
            shutil.copyfileobj(source, target, length=1024 * 1024)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary_name, destination)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise
    return destination


def staged_file_exists(key: str | None, configured_root: str | None = None) -> bool:
    if not key:
        return False
    try:
        return resolve_staging_key(key, configured_root).is_file()
    except ValueError:
        return False


def remove_import_staging(import_id: str, configured_root: str | None = None) -> None:
    root = staging_root(configured_root)
    path = resolve_staging_key(_segment(import_id), configured_root)
    if path == root or root not in path.parents:
        raise ValueError("Refusing to remove staging root")
    shutil.rmtree(path, ignore_errors=True)


def create_archive(
    import_id: str,
    group_index: int | str,
    members: Iterable[tuple[str, str]],
    configured_root: str | None = None,
) -> tuple[Path, dict[str, str]]:
    """Create a compressed archive from ``(staging_key, archive_member)`` pairs."""
    root = staging_root(configured_root)
    group_name = (
        f"{group_index:06d}"
        if isinstance(group_index, int)
        else _segment(str(group_index))
    )
    archive_key = "/".join(
        (_segment(import_id), "archives", f"group-{group_name}.tar.gz")
    )
    archive_path = resolve_staging_key(archive_key, configured_root)
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    member_map: dict[str, str] = {}
    with tarfile.open(archive_path, mode="w:gz") as archive:
        for staging_key, archive_member in members:
            source = resolve_staging_key(staging_key, configured_root)
            if not source.is_file():
                continue
            safe_member = "/".join(_segment(part) for part in archive_member.split("/") if part)
            archive.add(source, arcname=safe_member, recursive=False)
            member_map[staging_key] = safe_member
    return archive_path, member_map


def extract_archive_member(
    archive_path: Path,
    member_name: str,
    destination: Path,
) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    safe_member = "/".join(_segment(part) for part in member_name.split("/") if part)
    output = (destination / Path(safe_member).name).resolve()
    if destination.resolve() not in output.parents:
        raise ValueError("Archive member destination escapes staging directory")
    with tarfile.open(archive_path, mode="r:gz") as archive:
        member = archive.getmember(safe_member)
        if not member.isfile():
            raise ValueError("Archive member is not a regular file")
        source = archive.extractfile(member)
        if source is None:
            raise ValueError("Archive member could not be opened")
        with output.open("wb") as handle:
            handle.write(source.read())
    return output
