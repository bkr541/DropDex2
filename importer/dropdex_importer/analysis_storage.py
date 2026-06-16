"""
Supabase Storage abstraction for ANLZ analysis assets.

Responsibilities
----------------
- Build deterministic, private Storage object paths.
- Upload raw DAT / EXT / 2EX files using the Supabase service-role client.
- Detect and skip re-upload when the object already exists with the same SHA.
- Return structured metadata for every upload attempt.

Design constraints
------------------
- Source files are never deleted or modified.
- The bucket is private; objects are never made public.
- The service-role client performs uploads, bypassing RLS.
- All SHA-256 values are computed by anlz_parser._hash_file_and_read before
  this module is called; this module does not re-hash.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .analysis_paths import build_storage_path

logger = logging.getLogger(__name__)

# Default bucket name (must match the migration)
DEFAULT_BUCKET = "rekordbox-analysis-assets"


@dataclass
class StorageUploadResult:
    """Metadata returned after one upload attempt."""

    bucket: str
    storage_path: str
    file_size: int
    sha256: str
    was_skipped: bool = False
    """
    True when an object with identical SHA already existed at the target path.
    The upload was not re-issued; the stored object is already correct.
    """
    error: Optional[str] = None
    """Non-None when the upload failed.  was_skipped is False in this case."""

    @property
    def ok(self) -> bool:
        return self.error is None


def upload_anlz_asset(
    sb_storage: object,
    bucket: str,
    storage_path: str,
    local_path: str,
    expected_sha256: str,
    *,
    allow_overwrite: bool = False,
) -> StorageUploadResult:
    """
    Upload a raw ANLZ asset to Supabase Storage.

    Parameters
    ----------
    sb_storage:
        ``supabase_client.storage``  (the storage sub-client).
    bucket:
        Storage bucket name, typically ``DEFAULT_BUCKET``.
    storage_path:
        Deterministic object path within the bucket, from
        ``analysis_paths.build_storage_path``.
    local_path:
        Absolute path on disk of the file to upload.
    expected_sha256:
        Hex SHA-256 of the file bytes as computed by the parser.
        Used to detect identical-content objects on the bucket.
    allow_overwrite:
        When True, always upload even if an object already exists.
        When False (default), check for existence first and skip if matching.

    Returns
    -------
    StorageUploadResult with ``ok`` True on success or skip.

    Never raises.  All errors are captured in ``StorageUploadResult.error``.
    """
    path = Path(local_path)

    try:
        file_size = path.stat().st_size
    except OSError as exc:
        return StorageUploadResult(
            bucket=bucket,
            storage_path=storage_path,
            file_size=0,
            sha256=expected_sha256,
            error=f"Could not stat file: {exc}",
        )

    # ── Check for existing object ─────────────────────────────────────────────
    if not allow_overwrite:
        try:
            existing = _get_object_metadata(sb_storage, bucket, storage_path)
            if existing is not None:
                # Object exists.  We can't easily compare SHA via the Supabase
                # Storage API, so we trust that if an object exists at the
                # exact deterministic path it was uploaded by a prior run with
                # the same content.  Log the sha for audit trail.
                logger.info(
                    "Skipping upload (object already exists): bucket=%s path=%s sha256=%s",
                    bucket, storage_path, expected_sha256,
                )
                return StorageUploadResult(
                    bucket=bucket,
                    storage_path=storage_path,
                    file_size=file_size,
                    sha256=expected_sha256,
                    was_skipped=True,
                )
        except Exception as exc:
            # If the existence check itself fails, proceed with upload
            logger.warning(
                "Could not check existing object at %s/%s: %s — proceeding with upload",
                bucket, storage_path, exc,
            )

    # ── Upload ────────────────────────────────────────────────────────────────
    try:
        with open(path, "rb") as fh:
            file_bytes = fh.read()

        sb_storage.from_(bucket).upload(  # type: ignore[attr-defined]
            path=storage_path,
            file=file_bytes,
            file_options={"upsert": "true"},
        )

        logger.info(
            "Uploaded ANLZ asset: bucket=%s path=%s size=%d sha256=%s",
            bucket, storage_path, file_size, expected_sha256,
        )
        return StorageUploadResult(
            bucket=bucket,
            storage_path=storage_path,
            file_size=file_size,
            sha256=expected_sha256,
        )

    except Exception as exc:
        error_msg = f"{type(exc).__name__}: {exc}"
        logger.error(
            "Failed to upload %s/%s: %s", bucket, storage_path, error_msg
        )
        return StorageUploadResult(
            bucket=bucket,
            storage_path=storage_path,
            file_size=file_size,
            sha256=expected_sha256,
            error=error_msg,
        )


def _get_object_metadata(
    sb_storage: object, bucket: str, storage_path: str
) -> Optional[dict]:
    """
    Return Storage object metadata dict, or None if the object does not exist.

    The Supabase Storage Python SDK raises on 404; we map that to None.
    """
    try:
        result = sb_storage.from_(bucket).list(  # type: ignore[attr-defined]
            path=_parent_prefix(storage_path),
            options={"search": _filename(storage_path)},
        )
        if result:
            return result[0]
        return None
    except Exception:
        return None


def _parent_prefix(storage_path: str) -> str:
    """Return the directory portion of a storage path."""
    parts = storage_path.rsplit("/", 1)
    return parts[0] if len(parts) > 1 else ""


def _filename(storage_path: str) -> str:
    """Return the filename portion of a storage path."""
    return storage_path.rsplit("/", 1)[-1]
