"""Memory-bounded upload helpers used by Rekordbox imports."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Callable

from fastapi import HTTPException, UploadFile

DEFAULT_CHUNK_BYTES = 1024 * 1024


def _cancelled_detail() -> dict[str, object]:
    return {
        "error_code": "IMPORT_CANCELLED",
        "detail": "Import was cancelled.",
        "retryable": False,
    }


async def stream_upload_to_temp(
    upload: UploadFile,
    *,
    max_bytes: int,
    suffix: str,
    cancellation_requested: Callable[[], bool] | None = None,
    chunk_bytes: int = DEFAULT_CHUNK_BYTES,
    temp_file_factory=None,
) -> tuple[str, int]:
    """Stream an UploadFile to disk and stop immediately when the limit is crossed."""
    path: str | None = None
    total = 0
    try:
        factory = temp_file_factory or tempfile.NamedTemporaryFile
        with factory(suffix=suffix, delete=False) as tmp:
            path = tmp.name
            while True:
                if cancellation_requested and cancellation_requested():
                    raise HTTPException(status_code=409, detail=_cancelled_detail())
                chunk = await upload.read(chunk_bytes)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    limit_mb = max_bytes // (1024 * 1024)
                    raise HTTPException(
                        status_code=413,
                        detail={
                            "error_code": "UPLOAD_TOO_LARGE",
                            "detail": f"File exceeds the maximum allowed size of {limit_mb} MB.",
                            "retryable": False,
                        },
                    )
                tmp.write(chunk)
        return path, total
    except Exception:
        if path and os.path.exists(path):
            os.unlink(path)
        raise
    finally:
        await upload.close()


async def read_upload_bounded(
    upload: UploadFile,
    *,
    max_bytes: int,
    cancellation_requested: Callable[[], bool] | None = None,
    chunk_bytes: int = DEFAULT_CHUNK_BYTES,
) -> bytes:
    """Read a deliberately small upload in bounded chunks."""
    chunks: list[bytes] = []
    total = 0
    try:
        while True:
            if cancellation_requested and cancellation_requested():
                raise HTTPException(status_code=409, detail=_cancelled_detail())
            chunk = await upload.read(chunk_bytes)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                limit_mb = max_bytes // (1024 * 1024)
                raise HTTPException(
                    status_code=413,
                    detail={
                        "error_code": "UPLOAD_TOO_LARGE",
                        "detail": f"File exceeds the maximum allowed size of {limit_mb} MB.",
                        "retryable": False,
                    },
                )
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        await upload.close()
