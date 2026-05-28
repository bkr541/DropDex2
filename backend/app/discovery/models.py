"""
Pydantic models for the DropDex discovery layer.

These models represent the typed API boundary between:
  - The Supabase-backed repository (raw dicts → typed records)
  - The orchestration service (internal state machine)
  - Future API routes (serialised responses)

They are separate from the scraper's parser models (ParsedSetlistResult,
ParsedResultPage) which represent a single HTML page.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel


class JobStatus(str, Enum):
    QUEUED    = "queued"
    RUNNING   = "running"
    COMPLETED = "completed"
    FAILED    = "failed"


class ArtistRecord(BaseModel):
    """Canonical artist entry resolved from public.artists."""
    id: str
    name: str
    normalized_name: Optional[str] = None
    source: Optional[str] = None
    source_artist_url: Optional[str] = None


class ScrapeJobSummary(BaseModel):
    """Summary of a public.scrape_jobs row, suitable for API responses."""
    id: str
    artist_id: str
    status: JobStatus
    pages_scraped: int = 0
    results_found: int = 0
    total_results_reported: Optional[int] = None
    error_message: Optional[str] = None
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class SavedSetlistResult(BaseModel):
    """A deduplicated setlist entry stored in public.artist_set_results."""
    id: str
    source_tracklist_id: str
    source_url: str
    title: str
    set_date: Optional[str] = None
    ided_tracks: Optional[int] = None
    total_tracks: Optional[int] = None
    completion_pct: Optional[float] = None
    views: Optional[int] = None
    likes: Optional[int] = None
    music_styles: Optional[list[str]] = None
    listen_sources: Optional[list[Any]] = None
    artwork_url: Optional[str] = None
    creator_username: Optional[str] = None
    creator_profile_url: Optional[str] = None
    duration_text: Optional[str] = None
    duration_seconds: Optional[int] = None
    updated_at: Optional[str] = None


class DiscoveryRunResult(BaseModel):
    """Full response model for a completed discovery run (for future route use)."""
    job: ScrapeJobSummary
    artist: ArtistRecord
    results: list[SavedSetlistResult]


# ── API response models ───────────────────────────────────────────────────────

class ArtistSearchCandidate(BaseModel):
    """Compact artist record returned by the artist search endpoint."""
    id: str
    name: str
    normalized_name: Optional[str] = None
    matched_alias: Optional[str] = None
    profile_image_url: Optional[str] = None


class ScrapeStartResponse(BaseModel):
    """Immediate 202 response when a scrape job is queued."""
    job_id: str
    artist_id: str
    artist_name: str
    status: str = "queued"


class ScrapeJobResponse(BaseModel):
    """Full scrape job detail returned by the job-status endpoint."""
    job_id: str
    artist_id: str
    artist_name: Optional[str] = None
    source: str
    status: JobStatus
    pages_scraped: int = 0
    results_found: int = 0
    total_results_reported: Optional[int] = None
    error_message: Optional[str] = None
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class SetlistsPage(BaseModel):
    """Paginated setlist result page returned by the setlists endpoint."""
    artist_id: str
    total: int
    limit: int
    offset: int
    results: list[SavedSetlistResult]


# ── Set-detail models ─────────────────────────────────────────────────────────

class SetTrackRecord(BaseModel):
    """One saved track row from public.artist_set_tracks."""
    id: str
    set_result_id: str
    source: str
    source_position_id: str
    source_track_id: Optional[str] = None
    sequence_index: int
    track_number: Optional[int] = None
    played_with_previous: bool
    cue_seconds: Optional[int] = None
    cue_text: Optional[str] = None
    title: Optional[str] = None
    artist_text: Optional[str] = None
    label_text: Optional[str] = None
    duration_seconds: Optional[int] = None
    duration_text: Optional[str] = None
    source_track_url: Optional[str] = None
    artwork_url: Optional[str] = None


class SetlistDetailSummary(BaseModel):
    """Set-level metadata returned alongside individual tracks."""
    id: str
    title: str
    source_url: str
    set_date: Optional[str] = None
    artwork_url: Optional[str] = None
    duration_seconds: Optional[int] = None
    track_count: Optional[int] = None          # total_tracks from the search scrape
    parsed_track_count: Optional[int] = None   # track rows saved after detail scrape
    detail_scrape_status: str
    detail_scraped_at: Optional[str] = None
    detail_scrape_error: Optional[str] = None
    has_timed_cues: Optional[bool] = None


class SetlistDetailResponse(BaseModel):
    """Response body for both the GET and POST detail-scrape endpoints."""
    setlist: SetlistDetailSummary
    tracks: list[SetTrackRecord]


# ── Artist detail ─────────────────────────────────────────────────────────────

class ArtistGenre(BaseModel):
    """One canonical genre entry linked via artist_genres → genres."""
    id: str
    name: str


class ArtistDetailResponse(BaseModel):
    """
    Full artist detail returned by GET /api/discovery/artists/{artist_id}.

    Genres come from the artist_genres junction, NOT from setlist music_styles.
    stored_setlist_count and stored_track_count are live DB counts.
    """
    id: str
    name: str
    normalized_name: Optional[str] = None
    aliases: list[str] = []
    source: Optional[str] = None
    source_artist_url: Optional[str] = None
    profile_image_url: Optional[str] = None
    genres: list[ArtistGenre] = []
    stored_setlist_count: int = 0
    stored_track_count: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ── Typed exceptions ──────────────────────────────────────────────────────────

class ArtistNotFoundError(ValueError):
    """Raised when a requested artist UUID is absent from public.artists."""


class DiscoveryJobError(RuntimeError):
    """Raised when a scrape job fails after creation (job is marked failed in DB)."""


class SetResultNotFoundError(ValueError):
    """Raised when a requested set_result_id is absent from artist_set_results."""


class InvalidSetlistUrlError(ValueError):
    """Raised when the stored source_url fails the safe-URL validation check."""


class DetailScrapeError(RuntimeError):
    """Raised when a detail-page scrape or persistence step fails."""
