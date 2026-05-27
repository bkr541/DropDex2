"""
Supabase-backed repository for the DropDex discovery layer.

All methods use the service-role key (bypasses RLS), which is correct for
the shared discovery catalog.  No user-owned data is written here; the
requesting user ID is stored only in scrape_jobs.requested_by_user_id as
an audit trail.

Exact column names follow the live schema documented in:
  supabase/migrations/20260527030000_create_discovery_scrape_job_support.sql
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Optional

from supabase import Client, create_client

from app.discovery.models import (
    ArtistRecord,
    ArtistSearchCandidate,
    SavedSetlistResult,
    ScrapeJobResponse,
    ScrapeJobSummary,
    JobStatus,
)
from app.discovery.scrapers.tracklists1001.models import PageScrapeAudit
from app.discovery.scrapers.tracklists1001.parser import ParsedSetlistResult

log = logging.getLogger(__name__)

_SOURCE = "1001tracklists"


def _normalize(text: str) -> str:
    """Lower-case, whitespace-collapsed form used for deduplication fields."""
    return re.sub(r"\s+", " ", text.lower()).strip()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class DiscoveryRepository:
    """
    Thin data-access layer over public.* discovery tables.

    Instantiate with the Supabase project URL and service-role key.
    Each method executes one or two synchronous PostgREST calls and returns
    typed values; callers are responsible for async/threading if needed.
    """

    def __init__(self, supabase_url: str, supabase_key: str) -> None:
        self._client: Client = create_client(supabase_url, supabase_key)

    # ── Artists ───────────────────────────────────────────────────────────────

    def search_artists(
        self,
        query: str,
        limit: int = 20,
    ) -> list[ArtistSearchCandidate]:
        """
        Search public.artists by normalized name, then backfill with alias matches.

        Returns up to `limit` ArtistSearchCandidate objects, deduped by artist id.
        Queries shorter than 2 characters after normalisation return an empty list.
        """
        normalized = _normalize(query)
        if len(normalized) < 2:
            return []

        pattern = f"%{normalized}%"

        # Primary search: artists table
        resp = (
            self._client.table("artists")
            .select("id, name, normalized_name, profile_image_url")
            .ilike("normalized_name", pattern)
            .limit(limit)
            .execute()
        )

        seen_ids: set[str] = set()
        candidates: list[ArtistSearchCandidate] = []
        for row in resp.data:
            aid = str(row["id"])
            candidates.append(ArtistSearchCandidate(
                id=aid,
                name=row["name"],
                normalized_name=row.get("normalized_name"),
                profile_image_url=row.get("profile_image_url"),
            ))
            seen_ids.add(aid)

        # Backfill from aliases if we haven't reached the limit
        remaining = limit - len(candidates)
        if remaining > 0:
            alias_resp = (
                self._client.table("artist_aliases")
                .select("alias_text, normalized_alias, artists(id, name, normalized_name, profile_image_url)")
                .ilike("normalized_alias", pattern)
                .limit(remaining + 5)
                .execute()
            )
            for row in alias_resp.data:
                artist_row = row.get("artists") or {}
                aid = str(artist_row.get("id", ""))
                if not aid or aid in seen_ids:
                    continue
                candidates.append(ArtistSearchCandidate(
                    id=aid,
                    name=artist_row.get("name", ""),
                    normalized_name=artist_row.get("normalized_name"),
                    matched_alias=row.get("alias_text"),
                    profile_image_url=artist_row.get("profile_image_url"),
                ))
                seen_ids.add(aid)
                if len(candidates) >= limit:
                    break

        return candidates

    def get_artist(self, artist_id: str) -> Optional[ArtistRecord]:
        """Return the canonical artist record, or None if the UUID is unknown."""
        resp = (
            self._client.table("artists")
            .select("id, name, normalized_name, source, source_artist_url")
            .eq("id", artist_id)
            .execute()
        )
        if not resp.data:
            return None
        row = resp.data[0]
        return ArtistRecord(
            id=str(row["id"]),
            name=row["name"],
            normalized_name=row.get("normalized_name"),
            source=row.get("source"),
            source_artist_url=row.get("source_artist_url"),
        )

    # ── Scrape jobs ───────────────────────────────────────────────────────────

    def create_scrape_job(self, user_id: str, artist_id: str) -> str:
        """Insert a new scrape_jobs row with status=queued. Returns the new job UUID."""
        resp = (
            self._client.table("scrape_jobs")
            .insert({
                "requested_by_user_id": user_id,
                "artist_id": artist_id,
                "job_type": "artist_setlist_discovery",
                "source": _SOURCE,
                "status": JobStatus.QUEUED.value,
            })
            .execute()
        )
        return str(resp.data[0]["id"])

    def set_job_running(self, job_id: str) -> None:
        """Transition job to running and record the start timestamp."""
        self._client.table("scrape_jobs").update({
            "status": JobStatus.RUNNING.value,
            "started_at": _now_iso(),
        }).eq("id", job_id).execute()

    def set_job_completed(
        self,
        job_id: str,
        *,
        pages_scraped: int,
        results_found: int,
        total_results_reported: Optional[int],
    ) -> None:
        self._client.table("scrape_jobs").update({
            "status": JobStatus.COMPLETED.value,
            "pages_scraped": pages_scraped,
            "results_found": results_found,
            "total_results_reported": total_results_reported,
            "completed_at": _now_iso(),
        }).eq("id", job_id).execute()

    def set_job_failed(self, job_id: str, error_message: str) -> None:
        """Mark the job failed with a user-readable (non-technical) message."""
        self._client.table("scrape_jobs").update({
            "status": JobStatus.FAILED.value,
            "error_message": error_message,
            "completed_at": _now_iso(),
        }).eq("id", job_id).execute()

    def get_job_summary(self, job_id: str) -> Optional[ScrapeJobSummary]:
        """Fetch a single scrape_jobs row as a typed summary."""
        resp = (
            self._client.table("scrape_jobs")
            .select(
                "id, artist_id, status, pages_scraped, results_found, "
                "total_results_reported, error_message, created_at, "
                "started_at, completed_at"
            )
            .eq("id", job_id)
            .execute()
        )
        if not resp.data:
            return None
        row = resp.data[0]
        return ScrapeJobSummary(
            id=str(row["id"]),
            artist_id=str(row["artist_id"]),
            status=JobStatus(row["status"]),
            pages_scraped=row.get("pages_scraped") or 0,
            results_found=row.get("results_found") or 0,
            total_results_reported=row.get("total_results_reported"),
            error_message=row.get("error_message"),
            created_at=row.get("created_at"),
            started_at=row.get("started_at"),
            completed_at=row.get("completed_at"),
        )

    # ── Search runs ───────────────────────────────────────────────────────────

    def create_search_run(
        self,
        job_id: str,
        artist_id: str,
        search_query: str,
    ) -> str:
        """
        Insert one artist_search_runs row representing this scrape execution.

        Returns the new search-run UUID used to link pages and results.
        source_url and total_results are left NULL here; per-page details
        are captured in artist_search_pages rows linked to this run.
        """
        resp = (
            self._client.table("artist_search_runs")
            .insert({
                "artist_id": artist_id,
                "scrape_job_id": job_id,
                "search_query": search_query,
                "source": _SOURCE,
                "scraped_at": _now_iso(),
            })
            .execute()
        )
        return str(resp.data[0]["id"])

    # ── Search pages ──────────────────────────────────────────────────────────

    def insert_search_page(
        self,
        search_run_id: str,
        audit: PageScrapeAudit,
    ) -> None:
        """
        Upsert one artist_search_pages row for a parsed result page.

        The unique constraint on (search_run_id, page_number) means repeated
        scrape executions with the same run ID will update rather than duplicate.
        """
        self._client.table("artist_search_pages").upsert(
            {
                "search_run_id": search_run_id,
                "page_number": audit.page_number,
                "result_count": audit.cards_parsed,
                "source_url": audit.url or None,
                "scraped_at": _now_iso(),
                "raw_metadata_json": {
                    "page_number": audit.page_number,
                    "cards_parsed": audit.cards_parsed,
                    "has_next_page": audit.has_next_page,
                    "url": audit.url,
                },
            },
            on_conflict="search_run_id,page_number",
        ).execute()

    # ── Set results ───────────────────────────────────────────────────────────

    def upsert_set_result(
        self,
        search_run_id: str,
        artist_id: str,
        result: ParsedSetlistResult,
    ) -> str:
        """
        Insert or update an artist_set_results row for a scraped setlist entry.

        If the row is NEW (no existing row for source + source_tracklist_id):
            Insert with all mutable fields PLUS provenance fields (artist_id,
            search_run_id).  artist_id records which artist's scrape first
            discovered this result; it is never overwritten.

        If the row already EXISTS:
            Update only the mutable metadata fields (title, views, completion
            counts, artwork, etc.).  artist_id is intentionally excluded from
            the update so that a later scrape for a different artist cannot
            erase the original provenance.

        The artist → setlist relationship for the scraping artist is always
        written separately via link_result_to_artist; do not rely on
        artist_set_results.artist_id for retrieval.

        Returns the row UUID (newly inserted or existing after update).
        """
        mutable_fields: dict = {
            "source_url": result.source_url,
            "title": result.title,
            "normalized_title": _normalize(result.title),
            "set_date": result.set_date,
            "artwork_url": result.artwork_url,
            "ided_tracks": result.ided_tracks,
            "total_tracks": result.total_tracks,
            "completion_pct": (
                float(result.completion_pct)
                if result.completion_pct is not None
                else None
            ),
            "duration_text": result.duration_text,
            "duration_seconds": result.duration_seconds,
            "music_styles": result.music_styles or [],
            "listen_sources": result.listen_sources or [],
            "views": result.views,
            "likes": result.likes,
            "creator_username": result.creator_username,
            "creator_profile_url": result.creator_profile_url,
            "created_age_text": result.created_age_text,
            "updated_age_text": result.updated_age_text,
            "raw_result_json": result.raw_result_json,
        }

        existing = (
            self._client.table("artist_set_results")
            .select("id")
            .eq("source", result.source)
            .eq("source_tracklist_id", result.source_tracklist_id)
            .execute()
        )

        if existing.data:
            # Row exists — refresh mutable metadata but preserve provenance.
            row_id = str(existing.data[0]["id"])
            self._client.table("artist_set_results").update(
                mutable_fields
            ).eq("id", row_id).execute()
            return row_id

        # New row — record provenance alongside mutable fields.
        insert_data = {
            **mutable_fields,
            "source": result.source,
            "source_tracklist_id": result.source_tracklist_id,
            "artist_id": artist_id,
            "search_run_id": search_run_id,
        }
        resp = (
            self._client.table("artist_set_results")
            .insert(insert_data)
            .execute()
        )
        return str(resp.data[0]["id"])

    def link_result_to_artist(
        self,
        set_result_id: str,
        artist_id: str,
        artist_name: str,
    ) -> None:
        """
        Ensure a row exists in artist_set_result_artists linking this result to
        the searched-for artist.

        Uses upsert with ON CONFLICT (set_result_id, artist_id) DO NOTHING so
        that repeated calls for the same pair are idempotent in a single round
        trip.  The unique index
        artist_set_result_artists_set_result_artist_uidx (added in migration
        040000) makes this safe.
        """
        self._client.table("artist_set_result_artists").upsert(
            {
                "set_result_id": set_result_id,
                "artist_id": artist_id,
                "display_name": artist_name,
                "normalized_name": _normalize(artist_name),
            },
            on_conflict="set_result_id,artist_id",
            ignore_duplicates=True,
        ).execute()

    def get_job_summary_for_user(
        self,
        job_id: str,
        user_id: str,
    ) -> Optional[ScrapeJobResponse]:
        """
        Fetch a scrape job visible to the requesting user.

        Filters on both job id and requested_by_user_id so unauthorised callers
        receive the same None result as an absent job (no existence leak).
        Joins artists(name) to populate artist_name without a second round-trip.
        """
        resp = (
            self._client.table("scrape_jobs")
            .select(
                "id, artist_id, source, status, pages_scraped, results_found, "
                "total_results_reported, error_message, created_at, "
                "started_at, completed_at, artists(name)"
            )
            .eq("id", job_id)
            .eq("requested_by_user_id", user_id)
            .execute()
        )
        if not resp.data:
            return None
        row = resp.data[0]
        artist_info = row.get("artists") or {}
        status = JobStatus(row["status"])
        return ScrapeJobResponse(
            job_id=str(row["id"]),
            artist_id=str(row["artist_id"]),
            artist_name=artist_info.get("name"),
            source=row.get("source", "1001tracklists"),
            status=status,
            pages_scraped=row.get("pages_scraped") or 0,
            results_found=row.get("results_found") or 0,
            total_results_reported=row.get("total_results_reported"),
            error_message=row.get("error_message") if status == JobStatus.FAILED else None,
            created_at=row.get("created_at"),
            started_at=row.get("started_at"),
            completed_at=row.get("completed_at"),
        )

    # ── Result reads ──────────────────────────────────────────────────────────

    def get_set_results(self, artist_id: str) -> list[SavedSetlistResult]:
        """
        Fetch saved setlist results for an artist, newest set first.
        NULL set_dates sort to the end.

        Queries through artist_set_result_artists (the authoritative junction)
        so that collaborative sets appear for every linked artist regardless of
        which artist's scrape first created the shared result row.
        """
        junction_resp = (
            self._client.table("artist_set_result_artists")
            .select("set_result_id")
            .eq("artist_id", artist_id)
            .execute()
        )
        set_result_ids = [r["set_result_id"] for r in junction_resp.data]
        if not set_result_ids:
            return []

        resp = (
            self._client.table("artist_set_results")
            .select(
                "id, source_tracklist_id, source_url, title, set_date, "
                "ided_tracks, total_tracks, completion_pct, views, likes, "
                "music_styles, artwork_url, creator_username, "
                "creator_profile_url, duration_text, duration_seconds"
            )
            .in_("id", set_result_ids)
            .order("set_date", desc=True, nullsfirst=False)
            .execute()
        )
        return self._rows_to_setlist_results(resp.data)

    def get_set_results_paginated(
        self,
        artist_id: str,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[SavedSetlistResult], int]:
        """
        Fetch a page of setlist results for an artist, newest set first.

        Returns (results, total_count) where total_count is the full junction
        row count for the artist regardless of the requested page window.

        Step 1: resolve all set_result_ids for this artist via the junction.
        Step 2: paginate the actual result rows ordered by set_date DESC.

        This two-query approach guarantees that collaborative sets — discovered
        originally under a different artist — still appear for this artist once
        link_result_to_artist has been called for them.
        """
        junction_resp = (
            self._client.table("artist_set_result_artists")
            .select("set_result_id")
            .eq("artist_id", artist_id)
            .execute()
        )
        set_result_ids = [r["set_result_id"] for r in junction_resp.data]
        if not set_result_ids:
            return [], 0

        resp = (
            self._client.table("artist_set_results")
            .select(
                "id, source_tracklist_id, source_url, title, set_date, "
                "ided_tracks, total_tracks, completion_pct, views, likes, "
                "music_styles, listen_sources, artwork_url, creator_username, "
                "creator_profile_url, duration_text, duration_seconds, updated_at",
                count="exact",
            )
            .in_("id", set_result_ids)
            .order("set_date", desc=True, nullsfirst=False)
            .range(offset, offset + limit - 1)
            .execute()
        )
        total = resp.count or 0
        return self._rows_to_setlist_results(resp.data), total

    @staticmethod
    def _rows_to_setlist_results(rows: list[dict]) -> list[SavedSetlistResult]:
        results = []
        for row in rows:
            results.append(SavedSetlistResult(
                id=str(row["id"]),
                source_tracklist_id=row["source_tracklist_id"],
                source_url=row["source_url"],
                title=row["title"],
                set_date=row.get("set_date"),
                ided_tracks=row.get("ided_tracks"),
                total_tracks=row.get("total_tracks"),
                completion_pct=row.get("completion_pct"),
                views=row.get("views"),
                likes=row.get("likes"),
                music_styles=row.get("music_styles"),
                listen_sources=row.get("listen_sources"),
                artwork_url=row.get("artwork_url"),
                creator_username=row.get("creator_username"),
                creator_profile_url=row.get("creator_profile_url"),
                duration_text=row.get("duration_text"),
                duration_seconds=row.get("duration_seconds"),
                updated_at=row.get("updated_at"),
            ))
        return results
