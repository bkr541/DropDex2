"""SoundCloud track search for the user's favorite artists, backed by the same browser/HTML workflow as 1001Tracklists."""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from app.auth import get_current_user_id
from app.config import settings
from app.discovery.scrapers.soundcloud.browser_client import scrape_artist_track_titles

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/discovery/soundcloud", tags=["discovery"])

TOP_ARTIST_COUNT = 5


class FavoriteArtist(BaseModel):
    id: str
    name: str


async def fetch_top_favorite_artists(user_id: str) -> list[FavoriteArtist]:
    """The user's first five saved favorite artists, in their saved `position` order."""
    async with httpx.AsyncClient(timeout=10.0) as http:
        response = await http.get(
            f"{settings.supabase_url.rstrip('/')}/rest/v1/user_artists",
            params={
                "select": "artist_id,position,artist:artists(id,name)",
                "user_id": f"eq.{user_id}",
                "order": "position.asc",
                "limit": str(TOP_ARTIST_COUNT),
            },
            headers={"apikey": settings.supabase_secret_key, "Authorization": f"Bearer {settings.supabase_secret_key}"},
        )
        response.raise_for_status()
    artists: list[FavoriteArtist] = []
    for row in response.json():
        artist = row.get("artist") or {}
        if artist.get("id") and artist.get("name"):
            artists.append(FavoriteArtist(id=str(artist["id"]), name=str(artist["name"])))
    return artists[:TOP_ARTIST_COUNT]


@router.get("/favorite-artists", response_model=list[FavoriteArtist])
async def get_favorite_artists(
    response: Response,
    user_id: str = Depends(get_current_user_id),
) -> list[FavoriteArtist]:
    response.headers["Cache-Control"] = "no-store"
    try:
        return await fetch_top_favorite_artists(user_id)
    except Exception as exc:
        log.exception("Loading favorite artists failed")
        raise HTTPException(503, "Your favorite artists could not be loaded. Please try again.") from exc


@router.get("/artists/{artist_id}/tracks", response_model=list[str])
async def get_artist_track_titles(
    artist_id: str,
    response: Response,
    user_id: str = Depends(get_current_user_id),
) -> list[str]:
    """Scrape up to 20 public search titles for one of the caller's top five favorite artists, without storing track content.

    The name searched comes from the database, never from the request, so this cannot be used to search arbitrary text.
    """
    response.headers["Cache-Control"] = "no-store"
    try:
        favorites = await fetch_top_favorite_artists(user_id)
    except Exception as exc:
        log.exception("Loading favorite artists failed")
        raise HTTPException(503, "Your favorite artists could not be loaded. Please try again.") from exc
    artist = next((item for item in favorites if item.id == artist_id), None)
    if artist is None:
        raise HTTPException(404, "That artist is not one of your top favorite artists.")
    try:
        return await scrape_artist_track_titles(artist.name, limit=20)
    except Exception as exc:
        log.exception("SoundCloud browser search failed")
        raise HTTPException(503, "SoundCloud search could not load. Please try again.") from exc
