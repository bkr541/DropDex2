"""
Aggregated result models for the 1001Tracklists browser scraper.

These are distinct from the per-page parser models (ParsedSetlistResult,
ParsedResultPage) which represent a single HTML page.  These models aggregate
across a full multi-page scrape run.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from app.discovery.scrapers.tracklists1001.parser import ParsedSetlistResult


@dataclass
class PageScrapeAudit:
    """Lightweight per-page metadata recorded during a scrape run."""
    page_number: int
    url: str
    cards_parsed: int      # new (non-duplicate) cards added from this page
    has_next_page: bool


@dataclass
class ArtistSetlistScrapeResult:
    """Aggregated result of a full artist setlist scrape across all pages."""
    artist_name: str
    source: str
    reported_total_results: Optional[int]
    pages_scraped: int
    results_found: int
    results: list[ParsedSetlistResult] = field(default_factory=list)
    page_audit: list[PageScrapeAudit] = field(default_factory=list)
