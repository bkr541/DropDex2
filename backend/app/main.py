import logging

from fastapi import Depends, FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .auth import get_current_user_id
from .config import settings
from .discovery.routes import router as discovery_router
from .import_service import run_import
from .models import ImportResponse

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
