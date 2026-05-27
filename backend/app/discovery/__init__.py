"""
DropDex discovery package.

Public API surface for the artist-setlist discovery feature.
"""

from app.discovery.models import (
    ArtistNotFoundError,
    ArtistRecord,
    ArtistSearchCandidate,
    DiscoveryJobError,
    DiscoveryRunResult,
    JobStatus,
    SavedSetlistResult,
    ScrapeJobResponse,
    ScrapeJobSummary,
    ScrapeStartResponse,
    SetlistsPage,
)
from app.discovery.service import run_discovery_for_artist

__all__ = [
    # models
    "ArtistNotFoundError",
    "ArtistRecord",
    "ArtistSearchCandidate",
    "DiscoveryJobError",
    "DiscoveryRunResult",
    "JobStatus",
    "SavedSetlistResult",
    "ScrapeJobResponse",
    "ScrapeJobSummary",
    "ScrapeStartResponse",
    "SetlistsPage",
    # service entry point
    "run_discovery_for_artist",
]
