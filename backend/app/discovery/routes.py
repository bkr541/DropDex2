"""
FastAPI router for the DropDex artist-setlist discovery API.

Endpoints
─────────
GET  /api/discovery/artists/search                            – Search DropDex artist catalog
POST /api/discovery/artists/{artist_id}/setlists/scrape       – Queue a scrape job (202)
GET  /api/discovery/scrape-jobs/{job_id}                      – Poll job progress
GET  /api/discovery/artists/{artist_id}/setlists              – Retrieve stored setlists
GET  /api/discovery/setlists/{set_result_id}/tracks           – Retrieve saved set tracks
POST /api/discovery/setlists/{set_result_id}/tracks/scrape    – Scrape individual set tracks

All endpoints require a valid Supabase Bearer token.  user_id is always derived
from the JWT; it is never accepted from the request body or URL parameters.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from postgrest.exceptions import APIError

from app.auth import get_current_user_id
from app.config import settings
from app.discovery.job_runner import run_discovery_background
from app.discovery.models import (
    ArtistDetailResponse,
    ArtistSearchCandidate,
    DetailScrapeError,
    InvalidSetlistUrlError,
    ScrapeJobResponse,
    ScrapeStartResponse,
    SetlistDetailResponse,
    SetlistsPage,
    SetResultNotFoundError,
)
from app.discovery.repository import DiscoveryRepository
from app.discovery.service import get_setlist_tracks_response, run_setlist_detail_scrape

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/discovery", tags=["discovery"])

_MIN_QUERY_LEN = 2
_DEFAULT_LIMIT  = 20
_MAX_LIMIT      = 100
_SEARCH_LIMIT   = 20


def _make_repo() -> DiscoveryRepository:
    return DiscoveryRepository(settings.supabase_url, settings.supabase_secret_key)


# ── 1. Artist search ──────────────────────────────────────────────────────────

@router.get(
    "/artists/search",
    response_model=list[ArtistSearchCandidate],
    summary="Search DropDex artist catalog",
)
async def search_artists(
    q: str = Query(..., description="Artist name search query"),
    user_id: str = Depends(get_current_user_id),
) -> list[ArtistSearchCandidate]:
    """
    Search ``public.artists`` (and ``public.artist_aliases``) for matching
    records.  Returns up to 20 compact candidates.

    - Queries are trimmed and normalised before searching.
    - Queries shorter than 2 characters return an empty list rather than a
      broad full-table result.
    - This endpoint searches the DropDex catalog only; it does not call
      1001Tracklists.
    """
    q = q.strip()
    if len(q) < _MIN_QUERY_LEN:
        return []

    repo = _make_repo()
    return repo.search_artists(q, limit=_SEARCH_LIMIT)


# ── 2. Artist detail ─────────────────────────────────────────────────────────
# Registered AFTER /artists/search so FastAPI matches the literal "search"
# path first before the {artist_id} parameter.

@router.get(
    "/artists/{artist_id}",
    response_model=ArtistDetailResponse,
    summary="Get full artist detail for the Artist Page hero",
)
async def get_artist_detail(
    artist_id: str,
    user_id: str = Depends(get_current_user_id),
) -> ArtistDetailResponse:
    """
    Return full stored artist detail including canonical genres, stored setlist
    and track counts, source URL, and image.

    - Genres are the canonical ``artist_genres`` values — not scrape-derived
      ``music_styles`` from setlist rows.
    - Counts are live DB values; no scrape is triggered.
    - Returns ``404`` when the artist UUID is unknown.
    """
    repo = _make_repo()
    detail = repo.get_artist_detail(artist_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Artist not found")
    return detail


# ── 4. Start scrape ───────────────────────────────────────────────────────────

@router.post(
    "/artists/{artist_id}/setlists/scrape",
    response_model=ScrapeStartResponse,
    status_code=202,
    summary="Queue a 1001Tracklists setlist scrape for an artist",
)
async def start_scrape(
    artist_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
) -> ScrapeStartResponse:
    """
    Create a queued ``scrape_jobs`` record and start discovery in the
    background.  Returns ``202 Accepted`` immediately; poll the job-status
    endpoint to track progress.

    - ``artist_id`` must be an existing UUID in ``public.artists``.
    - The canonical artist name is resolved from the database; no freeform
      artist string is accepted in the request.
    - ``user_id`` is taken exclusively from the validated JWT.
    """
    repo = _make_repo()

    artist = repo.get_artist(artist_id)
    if artist is None:
        raise HTTPException(status_code=404, detail="Artist not found")

    try:
        job_id = repo.create_scrape_job(user_id, artist_id)
    except APIError as exc:
        log.error(
            "[routes] Failed to create scrape job — artist=%s code=%s message=%s",
            artist_id,
            getattr(exc, "code", "unknown"),
            getattr(exc, "message", str(exc)),
        )
        raise HTTPException(
            status_code=503,
            detail="Could not queue scrape job. The database may be unavailable or missing required columns. "
                   "Check that all migrations have been applied.",
        ) from exc

    log.info(
        "[routes] Scrape queued — job=%s artist=%s (%s) user=%s",
        job_id, artist.name, artist_id, user_id,
    )

    background_tasks.add_task(
        run_discovery_background,
        artist_id,
        user_id,
        job_id=job_id,
    )

    return ScrapeStartResponse(
        job_id=job_id,
        artist_id=artist_id,
        artist_name=artist.name,
        status="queued",
    )


# ── 5. Job status ─────────────────────────────────────────────────────────────

@router.get(
    "/scrape-jobs/{job_id}",
    response_model=ScrapeJobResponse,
    summary="Get scrape job status",
)
async def get_scrape_job(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
) -> ScrapeJobResponse:
    """
    Return the current status of a scrape job.

    A user may only retrieve jobs they requested.  Jobs belonging to other
    users return ``404`` (rather than ``403``) to avoid leaking job existence.
    """
    repo = _make_repo()
    job = repo.get_job_summary_for_user(job_id, user_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# ── 6. Retrieve saved setlists ────────────────────────────────────────────────

@router.get(
    "/artists/{artist_id}/setlists",
    response_model=SetlistsPage,
    summary="Retrieve stored discovery setlists for an artist",
)
async def get_setlists(
    artist_id: str,
    limit: int = Query(_DEFAULT_LIMIT, ge=1, le=_MAX_LIMIT, description="Page size (1–100)"),
    offset: int = Query(0, ge=0, description="Zero-based row offset"),
    user_id: str = Depends(get_current_user_id),
) -> SetlistsPage:
    """
    Return stored setlist results already present in DropDex for the given
    artist.  Does **not** trigger a new scrape — use the scrape endpoint for
    that.

    Results are ordered by ``set_date DESC NULLS LAST``.
    """
    repo = _make_repo()

    if repo.get_artist(artist_id) is None:
        raise HTTPException(status_code=404, detail="Artist not found")

    results, total = repo.get_set_results_paginated(artist_id, limit=limit, offset=offset)

    return SetlistsPage(
        artist_id=artist_id,
        total=total,
        limit=limit,
        offset=offset,
        results=results,
    )


# ── 7. Get stored set tracks ──────────────────────────────────────────────────

@router.get(
    "/setlists/{set_result_id}/tracks",
    response_model=SetlistDetailResponse,
    summary="Retrieve stored individual tracks for a saved setlist",
)
async def get_set_tracks(
    set_result_id: str,
    user_id: str = Depends(get_current_user_id),
) -> SetlistDetailResponse:
    """
    Return the saved set metadata and any individual track rows already stored
    for this setlist.

    - Does **not** trigger a new browser scrape.
    - When no tracks have been scraped yet, ``tracks`` is an empty list and
      ``setlist.detail_scrape_status`` will be ``"not_scraped"``.
    - Returns ``404`` if the set result UUID is not in the DropDex catalog.
    """
    try:
        return get_setlist_tracks_response(set_result_id)
    except SetResultNotFoundError:
        raise HTTPException(status_code=404, detail="Set result not found")


# ── 8. Scrape individual set tracks ───────────────────────────────────────────

@router.post(
    "/setlists/{set_result_id}/tracks/scrape",
    response_model=SetlistDetailResponse,
    summary="Scrape individual tracks for a saved setlist",
)
async def scrape_set_tracks(
    set_result_id: str,
    refresh: bool = Query(
        False,
        description=(
            "When false (default), return existing tracks without scraping if "
            "they are already saved.  When true, always re-scrape and replace "
            "stale rows."
        ),
    ),
    user_id: str = Depends(get_current_user_id),
) -> SetlistDetailResponse:
    """
    Fetch individual track rows from the 1001Tracklists setlist page identified
    by ``set_result_id``.

    **Why synchronous, not queued:**
    A detail scrape targets a single page and completes in 5–15 seconds.
    Artist-search scrapes are background tasks because they page through 50+
    result pages.  Adding a ``scrape_jobs`` polling loop for a single-page
    operation would add latency and complexity with no benefit.  The frontend
    awaits this POST directly.

    - The source URL is resolved from the stored record — the browser never
      receives a caller-supplied URL.
    - Returns ``404`` when the set result UUID is unknown.
    - Returns ``400`` when the stored URL fails the safe-domain validation
      (HTTPS, ``www.1001tracklists.com``, ``/tracklist/`` path prefix).
    - Returns ``503`` on browser or persistence failures.
    """
    try:
        return await run_setlist_detail_scrape(set_result_id, refresh=refresh)
    except SetResultNotFoundError:
        raise HTTPException(status_code=404, detail="Set result not found")
    except InvalidSetlistUrlError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Stored setlist URL is not supported: {exc}",
        )
    except DetailScrapeError as exc:
        log.error("[routes] Detail scrape failed for set=%s: %s", set_result_id, exc)
        detail_msg = (
            str(exc)
            if settings.environment == "development"
            else "Set detail scrape encountered an error. Please try again."
        )
        raise HTTPException(status_code=503, detail=detail_msg)
