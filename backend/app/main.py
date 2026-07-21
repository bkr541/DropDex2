import asyncio
import logging
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from starlette.concurrency import run_in_threadpool

from .analysis_import_service import (
    complete_analysis_import,
    get_analysis_status,
    process_analysis_batch,
    start_analysis_import,
)
from .auth import get_current_user_id
from .bundle_import_service import import_bundle
from .config import settings
from .discovery.repository import DiscoveryRepository
from .discovery.routes import router as discovery_router
from .import_jobs import (
    cancel_import_job,
    create_import_job,
    get_import_job,
    recover_interrupted_import_jobs,
)
from .import_service import run_import
from .models import (
    AnalysisStatusResponse,
    BatchUploadResponse,
    CompleteRequest,
    CompleteResponse,
    ImportJobCreateRequest,
    ImportJobResponse,
    ImportResponse,
    ImportStartResponse,
    RelatedTracksImportResponse,
    RelatedTracksPayload,
)
from .related_tracks_service import import_related_tracks

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="DropDex API",
    # Disable interactive docs in production-oriented builds
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(discovery_router)


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log unhandled exceptions with type so the root cause can be identified."""
    logger.exception(
        "Unhandled %s on %s %s",
        type(exc).__name__,
        request.method,
        request.url.path,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "exception_type": type(exc).__name__},
    )


@app.exception_handler(APIError)
async def supabase_api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    """
    Catch unhandled postgrest APIError (Supabase REST layer errors) and return
    a structured JSON 503 instead of a raw 500 text/plain response.

    The full error detail is logged server-side; only a safe message reaches
    the client so internal schema / query details are not exposed.
    """
    logger.error(
        "Supabase APIError on %s %s — code=%s message=%s",
        request.method,
        request.url.path,
        getattr(exc, "code", "unknown"),
        getattr(exc, "message", str(exc)),
    )
    return JSONResponse(
        status_code=503,
        content={"detail": "A database error occurred. Please try again or contact support."},
    )


@app.on_event("startup")
async def recover_rekordbox_import_jobs() -> None:
    try:
        recovered = await run_in_threadpool(recover_interrupted_import_jobs)
        if recovered:
            logger.warning("Recovered %d interrupted Rekordbox import job(s)", recovered)
    except Exception:
        # Startup must remain available even if Supabase is temporarily offline.
        logger.exception("Could not recover interrupted Rekordbox imports at startup")


_discovery_reaper_task: asyncio.Task[None] | None = None


async def _recover_stale_discovery_jobs() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(
        minutes=max(1, settings.discovery_job_stale_minutes)
    )
    repo = DiscoveryRepository(settings.supabase_url, settings.supabase_secret_key)
    recovered = await run_in_threadpool(
        repo.recover_stale_scrape_jobs,
        cutoff.isoformat(),
    )
    if recovered:
        logger.warning("Recovered %d stale discovery scrape job(s)", recovered)


async def _run_discovery_job_reaper() -> None:
    interval = max(15, int(settings.discovery_job_reaper_seconds))
    while True:
        await asyncio.sleep(interval)
        try:
            await _recover_stale_discovery_jobs()
        except Exception:
            logger.exception("Could not recover stale discovery jobs")


@app.on_event("startup")
async def recover_discovery_jobs() -> None:
    """Fail stale jobs now and keep checking after a recent restart."""
    global _discovery_reaper_task
    try:
        await _recover_stale_discovery_jobs()
    except Exception:
        logger.exception("Could not recover stale discovery jobs at startup")
    _discovery_reaper_task = asyncio.create_task(
        _run_discovery_job_reaper(),
        name="dropdex-discovery-job-reaper",
    )


@app.on_event("shutdown")
async def stop_discovery_job_reaper() -> None:
    global _discovery_reaper_task
    if _discovery_reaper_task is None:
        return
    _discovery_reaper_task.cancel()
    with suppress(asyncio.CancelledError):
        await _discovery_reaper_task
    _discovery_reaper_task = None


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/api/rekordbox/import/jobs", response_model=ImportJobResponse)
def create_rekordbox_import_job(
    body: ImportJobCreateRequest,
    user_id: str = Depends(get_current_user_id),
) -> ImportJobResponse:
    if body.source_bundle_type not in {"database_only", "usb_folder", "zip_bundle"}:
        raise HTTPException(
            status_code=422,
            detail={
                "error_code": "INVALID_IMPORT_MODE",
                "detail": "Unsupported Rekordbox import mode.",
                "retryable": False,
            },
        )
    row = create_import_job(
        user_id=user_id,
        source_filename=body.source_filename,
        source_bundle_type=body.source_bundle_type,
        device_name=body.device_name,
    )
    return ImportJobResponse(
        import_id=row["id"],
        status=row["status"],
        source_filename=row.get("source_filename") or body.source_filename,
        source_bundle_type=row.get("source_bundle_type"),
        error_code=row.get("error_code"),
        error_message=row.get("error_message"),
        retryable=bool(row.get("retryable")),
    )


@app.get("/api/rekordbox/import/{import_id}/job-status", response_model=ImportJobResponse)
def rekordbox_import_job_status(
    import_id: str,
    user_id: str = Depends(get_current_user_id),
) -> ImportJobResponse:
    row = get_import_job(import_id, user_id)
    return ImportJobResponse(
        import_id=row["id"],
        status=row["status"],
        source_filename=row.get("source_filename") or "upload",
        source_bundle_type=row.get("source_bundle_type"),
        error_code=row.get("error_code"),
        error_message=row.get("error_message"),
        retryable=bool(row.get("retryable")),
    )


@app.post("/api/rekordbox/import/{import_id}/cancel", response_model=ImportJobResponse)
def cancel_rekordbox_import(
    import_id: str,
    user_id: str = Depends(get_current_user_id),
) -> ImportJobResponse:
    row = cancel_import_job(import_id, user_id)
    return ImportJobResponse(
        import_id=row["id"],
        status=row["status"],
        source_filename=row.get("source_filename") or "upload",
        source_bundle_type=row.get("source_bundle_type"),
        error_code=row.get("error_code"),
        error_message=row.get("error_message"),
        retryable=bool(row.get("retryable")),
    )


@app.post("/api/rekordbox/import", response_model=ImportResponse)
async def import_rekordbox(
    file: UploadFile = File(..., description="rekordbox exportLibrary.db file"),
    device_name: Optional[str] = Form(None, description="USB drive label (e.g. 'LUMA')"),
    import_id: Optional[str] = Form(None),
    user_id: str = Depends(get_current_user_id),
) -> ImportResponse:
    """
    Upload an exportLibrary.db file and import it into the authenticated user's
    DropDex library.

    - Authenticated via Supabase Bearer token; user_id is derived from the token.
    - File is written to a temp path, parsed, validated, then written to Supabase.
    - Temp file is deleted whether the import succeeds or fails.
    - Each upload creates a new independent import snapshot.
    """
    return await run_import(file, user_id, device_name=device_name, import_id=import_id)


@app.post("/api/rekordbox/import/start", response_model=ImportStartResponse)
async def import_rekordbox_start(
    file: UploadFile = File(..., description="rekordbox exportLibrary.db file"),
    device_name: Optional[str] = Form(None, description="USB drive label (e.g. 'LUMA')"),
    import_id: Optional[str] = Form(None),
    user_id: str = Depends(get_current_user_id),
) -> ImportStartResponse:
    """
    Parse exportLibrary.db, persist it, and return the analysis manifest.

    Use this endpoint instead of POST /api/rekordbox/import when you intend to
    follow up with ANLZ file uploads via the analysis-batch endpoint.  The
    response includes the expected ANLZ paths so the client knows which files
    to upload next.
    """
    return await start_analysis_import(file, user_id, device_name=device_name, import_id=import_id)


@app.post("/api/rekordbox/import/bundle", response_model=CompleteResponse)
async def import_rekordbox_bundle(
    file: UploadFile = File(
        ..., description="ZIP archive containing exportLibrary.db and ANLZ files"
    ),
    import_id: Optional[str] = Form(None),
    user_id: str = Depends(get_current_user_id),
) -> CompleteResponse:
    """
    Accept a ZIP bundle containing exportLibrary.db and ANLZ analysis files.

    Runs the full import pipeline in a single request: library metadata and
    analysis data are both parsed and persisted.  ANLZ files not present in
    the ZIP are counted as missing_required in the response.
    """
    return await import_bundle(file, user_id, import_id=import_id)


@app.post(
    "/api/rekordbox/import/{import_id}/analysis-batch",
    response_model=BatchUploadResponse,
)
async def rekordbox_analysis_batch(
    import_id: str,
    files: List[UploadFile] = File(..., description="ANLZ analysis files (.DAT, .EXT, .2EX)"),
    user_id: str = Depends(get_current_user_id),
) -> BatchUploadResponse:
    """
    Upload a batch of ANLZ analysis files for an existing import.

    Each file's name must be the canonical ANLZ path from the manifest returned
    by the /start endpoint (e.g. PIONEER/USBANLZ/P001/ANLZ0000.DAT).  Paths
    are validated for traversal attacks and matched against the import manifest.
    Idempotent: re-uploading a file with the same SHA returns already_received.
    """
    return await process_analysis_batch(import_id, user_id, files)


@app.post(
    "/api/rekordbox/import/{import_id}/complete",
    response_model=CompleteResponse,
)
async def rekordbox_analysis_complete(
    import_id: str,
    body: Optional[CompleteRequest] = None,
    user_id: str = Depends(get_current_user_id),
) -> CompleteResponse:
    """
    Parse all uploaded ANLZ assets and persist the analysis results.

    When body.affected_track_ids is provided, only those tracks are reparsed
    (selective reprocessing for resume-analysis sessions). Omit the body or pass
    an empty/null list to reparse all tracks.
    """
    affected_track_ids = body.affected_track_ids if body else None
    return await complete_analysis_import(import_id, user_id, affected_track_ids=affected_track_ids)


@app.get(
    "/api/rekordbox/import/{import_id}/analysis-status",
    response_model=AnalysisStatusResponse,
)
async def rekordbox_analysis_status(
    import_id: str,
    user_id: str = Depends(get_current_user_id),
) -> AnalysisStatusResponse:
    """
    Return the current analysis status for an import.

    Reports upload progress, parse counts, and which required DAT files have
    not yet been received.
    """
    return await get_analysis_status(import_id, user_id)


@app.post(
    "/api/rekordbox/import/{import_id}/related-tracks",
    response_model=RelatedTracksImportResponse,
)
async def rekordbox_import_related_tracks(
    import_id: str,
    payload: RelatedTracksPayload,
    user_id: str = Depends(get_current_user_id),
) -> RelatedTracksImportResponse:
    """
    Import desktop Rekordbox Related Tracks lists.

    Accepts a versioned JSON payload from the rekordbox-bridge CLI.
    Matches bridge tracks to rekordbox_tracks by master_content_id.
    Upserts lists and replaces memberships idempotently.
    """
    return await import_related_tracks(import_id, user_id, payload)
