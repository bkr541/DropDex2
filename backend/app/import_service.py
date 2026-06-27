"""Database-only Rekordbox import orchestration."""

from __future__ import annotations

import inspect
import logging
import os
import tempfile
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from .config import settings
from .import_jobs import (
    ImportCancelledError,
    assert_import_not_cancelled,
    local_cancellation_requested,
    mark_import_failed,
    transition_import_job,
)
from .models import ImportResponse, PlaylistSummary
from .rekordbox_parser import parse_library
from .supabase_writer import write_to_supabase_full
from .upload_stream import stream_upload_to_temp
from .user_settings import upsert_active_import
from .validation import validate

logger = logging.getLogger(__name__)


def _write_library(library, user_id: str, import_id: str | None):
    try:
        parameters = inspect.signature(write_to_supabase_full).parameters
    except (TypeError, ValueError):
        parameters = {}
    supports_job = "import_id" in parameters or any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()
    )
    if import_id and supports_job:
        return write_to_supabase_full(
            library,
            settings.supabase_url,
            settings.supabase_secret_key,
            user_id,
            import_id=import_id,
            finalize_status="completed",
            should_cancel=(lambda: local_cancellation_requested(import_id)),
        )
    return write_to_supabase_full(
        library, settings.supabase_url, settings.supabase_secret_key, user_id
    )


async def run_import(
    file: UploadFile,
    user_id: str,
    device_name: str | None = None,
    import_id: str | None = None,
) -> ImportResponse:
    filename = file.filename or "upload"
    if not filename.lower().endswith(".db"):
        detail = "Only .db files are accepted. Please upload your rekordbox exportLibrary.db file."
        if import_id:
            await run_in_threadpool(
                mark_import_failed,
                import_id,
                user_id,
                error_code="INVALID_DATABASE_FILE",
                message=detail,
                retryable=False,
            )
        await file.close()
        raise HTTPException(
            status_code=422,
            detail=detail
            if not import_id
            else {
                "error_code": "INVALID_DATABASE_FILE",
                "detail": detail,
                "retryable": False,
            },
        )
    tmp_path: str | None = None
    try:
        if import_id:
            await run_in_threadpool(
                transition_import_job,
                import_id,
                user_id,
                expected_states={"created"},
                new_state="uploading",
            )
        tmp_path, _ = await stream_upload_to_temp(
            file,
            max_bytes=settings.max_upload_bytes,
            suffix=".db",
            cancellation_requested=lambda: local_cancellation_requested(import_id),
            temp_file_factory=tempfile.NamedTemporaryFile,
        )
        if import_id:
            await run_in_threadpool(assert_import_not_cancelled, import_id, user_id)
            await run_in_threadpool(
                transition_import_job,
                import_id,
                user_id,
                expected_states={"uploading"},
                new_state="queued",
                updates={"upload_completed_at": datetime.now(timezone.utc).isoformat()},
            )
            await run_in_threadpool(
                transition_import_job,
                import_id,
                user_id,
                expected_states={"queued"},
                new_state="processing",
                updates={"processing_started_at": datetime.now(timezone.utc).isoformat()},
            )
        try:
            library = await run_in_threadpool(parse_library, tmp_path)
        except ImportError:
            raise HTTPException(
                status_code=500,
                detail={
                    "error_code": "IMPORTER_UNAVAILABLE",
                    "detail": "The server is not configured to parse Rekordbox databases.",
                    "retryable": False,
                },
            )
        except Exception:
            logger.exception("Parser failed for user %s", user_id)
            raise HTTPException(
                status_code=422,
                detail={
                    "error_code": "DATABASE_PARSE_FAILED",
                    "detail": "Could not parse the uploaded file. Please confirm it is a valid Rekordbox exportLibrary.db.",
                    "retryable": False,
                },
            )
        if import_id:
            await run_in_threadpool(assert_import_not_cancelled, import_id, user_id)
        if device_name and not library.device_name:
            library.device_name = device_name
        validation = await run_in_threadpool(validate, library)
        if not validation.ok:
            raise HTTPException(
                status_code=422,
                detail={
                    "error_code": "LIBRARY_VALIDATION_FAILED",
                    "detail": f"Library validation failed: {'; '.join(validation.errors)}",
                    "retryable": False,
                },
            )
        try:
            result = await run_in_threadpool(_write_library, library, user_id, import_id)
        except Exception:
            if import_id:
                try:
                    await run_in_threadpool(assert_import_not_cancelled, import_id, user_id)
                except ImportCancelledError:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "error_code": "IMPORT_CANCELLED",
                            "detail": "Import was cancelled.",
                            "retryable": False,
                        },
                    )
            logger.exception("Supabase write failed for user %s", user_id)
            raise HTTPException(
                status_code=500,
                detail={
                    "error_code": "REKORDBOX_IMPORT_WRITE_FAILED",
                    "detail": "DropDex could not save this import. Please try again.",
                    "retryable": True,
                },
            )
        try:
            await run_in_threadpool(
                upsert_active_import,
                settings.supabase_url,
                settings.supabase_secret_key,
                user_id,
                result.import_id,
            )
        except Exception:
            logger.warning("Failed to set active import for user %s", user_id)
        counts: dict[str, int] = defaultdict(int)
        for placement in library.placements:
            counts[placement.rekordbox_playlist_id] += 1
        playlists = [
            PlaylistSummary(name=p.name, track_count=counts.get(p.rekordbox_playlist_id, 0))
            for p in sorted(library.playlists, key=lambda x: (x.sort_order or 0, x.name))
            if not p.is_folder
        ]
        return ImportResponse(
            import_id=result.import_id,
            status="completed",
            source_filename=library.source_filename,
            track_count=len(library.tracks),
            playlist_count=len(library.playlists),
            playlist_track_count=len(library.placements),
            playlists=playlists,
            analysis_status="awaiting_upload" if library.analysis_manifest else "not_requested",
            analysis_expected_track_count=len(library.analysis_manifest),
        )
    except ImportCancelledError:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "IMPORT_CANCELLED",
                "detail": "Import was cancelled.",
                "retryable": False,
            },
        )
    except HTTPException as exc:
        if not import_id and isinstance(exc.detail, dict):
            exc.detail = str(exc.detail.get("detail") or "Import failed.")
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        code = str(detail.get("error_code") or "IMPORT_FAILED")
        if import_id and code != "IMPORT_CANCELLED":
            await run_in_threadpool(
                mark_import_failed,
                import_id,
                user_id,
                error_code=code,
                message=str(detail.get("detail") or "Import failed."),
                retryable=bool(detail.get("retryable", False)),
            )
        raise
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        await file.close()
