import logging
from typing import List, Optional

from fastapi import Depends, FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError

from .analysis_import_service import (
    complete_analysis_import,
    get_analysis_status,
    process_analysis_batch,
    start_analysis_import,
)
from .auth import get_current_user_id
from .bundle_import_service import import_bundle
from .config import settings
from .discovery.routes import router as discovery_router
from .import_service import run_import
from .models import (
    AnalysisStatusResponse,
    BatchUploadResponse,
    CompleteRequest,
    CompleteResponse,
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


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/api/rekordbox/import", response_model=ImportResponse)
async def import_rekordbox(
    file: UploadFile = File(..., description="rekordbox exportLibrary.db file"),
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
    return await run_import(file, user_id)


@app.post("/api/rekordbox/import/start", response_model=ImportStartResponse)
async def import_rekordbox_start(
    file: UploadFile = File(..., description="rekordbox exportLibrary.db file"),
    user_id: str = Depends(get_current_user_id),
) -> ImportStartResponse:
    """
    Parse exportLibrary.db, persist it, and return the analysis manifest.

    Use this endpoint instead of POST /api/rekordbox/import when you intend to
    follow up with ANLZ file uploads via the analysis-batch endpoint.  The
    response includes the expected ANLZ paths so the client knows which files
    to upload next.
    """
    return await start_analysis_import(file, user_id)


@app.post("/api/rekordbox/import/bundle", response_model=CompleteResponse)
async def import_rekordbox_bundle(
    file: UploadFile = File(..., description="ZIP archive containing exportLibrary.db and ANLZ files"),
    user_id: str = Depends(get_current_user_id),
) -> CompleteResponse:
    """
    Accept a ZIP bundle containing exportLibrary.db and ANLZ analysis files.

    Runs the full import pipeline in a single request: library metadata and
    analysis data are both parsed and persisted.  ANLZ files not present in
    the ZIP are counted as missing_required in the response.
    """
    return await import_bundle(file, user_id)


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
