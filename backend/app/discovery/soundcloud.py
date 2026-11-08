"""Profile MVP backed by the same browser/HTML workflow as 1001Tracklists."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth import get_current_user_id
from app.discovery.scrapers.soundcloud.browser_client import scrape_artist_track_titles

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/discovery/soundcloud", tags=["discovery"])


@router.get("/illenium/tracks", response_model=list[str])
async def get_illenium_track_titles(
    response: Response,
    user_id: str = Depends(get_current_user_id),
) -> list[str]:
    """Scrape up to 20 public search titles without storing track content."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return await scrape_artist_track_titles("ILLENIUM", limit=20)
    except Exception as exc:
        log.exception("SoundCloud browser search failed")
        raise HTTPException(
            503, "SoundCloud search could not load. Please try again.",
        ) from exc
