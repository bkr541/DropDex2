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


# ── Typed exceptions ──────────────────────────────────────────────────────────

class ArtistNotFoundError(ValueError):
    """Raised when a requested artist UUID is absent from public.artists."""


class DiscoveryJobError(RuntimeError):
    """Raised when a scrape job fails after creation (job is marked failed in DB)."""
