"""
Orchestration service for 1001Tracklists artist-setlist discovery.

Job lifecycle
─────────────
1. Caller supplies an artist_id (trusted UUID from the DropDex catalog) and
   the authenticated user_id (from JWT, never from the request body).
2. resolve_artist  — fetches public.artists; raises ArtistNotFoundError
                     on unknown UUID; no DB row created yet.
3. create_scrape_job — inserts scrape_jobs (status=queued); returns job_id.
4. set_job_running — marks job running; records started_at.
5. create_search_run — inserts one artist_search_runs row for this execution.
6. scrape_artist_setlists — Playwright fetches rendered search pages; the
                             canonical artists.name is the only search term;
                             no freeform override from the caller is accepted.
7. insert_search_page — one artist_search_pages row per page in the audit trail.
8. upsert_set_result — artist_set_results upserted on (source, source_tracklist_id);
                        mutable fields (views, likes, artwork…) refresh on conflict.
9. link_result_to_artist — artist_set_result_artists link inserted if absent.
10. set_job_completed — stores page/result totals and completed_at.
11. On any exception after job creation: set_job_failed with a user-readable
    summary; full traceback logged server-side only.

Background-task compatibility
─────────────────────────────
run_discovery_for_artist is a reusable async function.  job_runner.py wraps it
for FastAPI BackgroundTasks.  No in-memory state couples these two layers, so
the execution logic can later move to a durable worker without changes here.
"""

from __future__ import annotations

import logging
from typing import Optional

from postgrest.exceptions import APIError

from app.config import settings
from app.discovery.models import (
    ArtistNotFoundError,
    ArtistRecord,
    DetailScrapeError,
    DiscoveryJobError,
    InvalidSetlistUrlError,
    JobStatus,
    ScrapeJobSummary,
    SetlistDetailResponse,
    SetResultNotFoundError,
)
from app.discovery.repository import DiscoveryRepository
from app.discovery.scrapers.tracklists1001.browser_client import (
    scrape_artist_setlists,
    scrape_setlist_detail,
    validate_setlist_url,
)

log = logging.getLogger(__name__)


def _make_repo() -> DiscoveryRepository:
    return DiscoveryRepository(settings.supabase_url, settings.supabase_secret_key)


async def run_discovery_for_artist(
    artist_id: str,
    user_id: str,
    *,
    job_id: Optional[str] = None,
    max_pages: Optional[int] = None,
    repo: Optional[DiscoveryRepository] = None,
) -> ScrapeJobSummary:
    """
    Create and execute a full artist-setlist discovery job end-to-end.

    Parameters
    ----------
    artist_id:
        UUID of an existing public.artists row.  Resolved to canonical name
        before any external request is made.  Raises ArtistNotFoundError if
        absent.
    user_id:
        Authenticated user from the Supabase JWT.  Stored in
        scrape_jobs.requested_by_user_id for audit; never influences the
        external search query.
    job_id:
        UUID of a pre-created scrape_jobs row (status=queued).  When supplied,
        ``create_scrape_job`` is skipped; the caller owns the row and is
        responsible for having created it already.  This is the path used by
        API routes that must return job_id in an immediate 202 response.
        When omitted, a new job row is created here (original behaviour).
    max_pages:
        Optional page ceiling.  Always bounded by
        settings.tracklists_scraper_max_pages.
    repo:
        DiscoveryRepository instance.  Inject a mock in tests; omit in
        production (a live instance is created from settings).

    Returns
    -------
    ScrapeJobSummary for the completed (or failed) job.

    Raises
    ------
    ArtistNotFoundError
        Raised *before* any DB row is created when artist_id is not in the
        catalog.  No orphan scrape_job row is left behind.
    DiscoveryJobError
        Raised *after* a job row has been created and marked failed when the
        scrape or persistence step fails.  The job_id is in the exception
        message.
    """
    if repo is None:
        repo = _make_repo()

    # ── 1. Resolve artist — fail fast before touching the DB ──────────────────
    artist: Optional[ArtistRecord] = repo.get_artist(artist_id)
    if artist is None:
        raise ArtistNotFoundError(
            f"Artist '{artist_id}' not found in the DropDex catalog"
        )

    # ── 2. Create job (queued) — skip if caller pre-created it ───────────────
    if job_id is None:
        job_id = repo.create_scrape_job(user_id, artist_id)
    log.info(
        "[discovery] Job %s created (queued) — artist=%s (%s) user=%s",
        job_id, artist.name, artist_id, user_id,
    )

    try:
        # ── 3. Mark running ───────────────────────────────────────────────────
        repo.set_job_running(job_id)

        # ── 4. Create search run ──────────────────────────────────────────────
        search_run_id = repo.create_search_run(job_id, artist_id, artist.name)
        log.info(
            "[discovery] Job %s running; search_run=%s; artist=%s",
            job_id, search_run_id, artist.name,
        )

        # ── 5. Run the Playwright scraper ─────────────────────────────────────
        #    Only the canonical artists.name is passed; the caller cannot inject
        #    an arbitrary search string via this code path.
        scrape_result = await scrape_artist_setlists(
            artist.name,
            max_pages=max_pages,
        )
        log.info(
            "[discovery] Job %s scrape returned — artist=%s results=%d pages=%d",
            job_id, artist.name, len(scrape_result.results), scrape_result.pages_scraped,
        )

        # ── 6. Persist per-page audit records ────────────────────────────────
        for audit in scrape_result.page_audit:
            repo.insert_search_page(search_run_id, audit)

        # ── 7. Upsert results and link to the searched-for artist ─────────────
        for result in scrape_result.results:
            set_result_id = repo.upsert_set_result(search_run_id, artist_id, result)
            repo.link_result_to_artist(set_result_id, artist_id, artist.name)

        # ── 8. Mark completed ─────────────────────────────────────────────────
        repo.set_job_completed(
            job_id,
            pages_scraped=scrape_result.pages_scraped,
            results_found=len(scrape_result.results),
            total_results_reported=scrape_result.reported_total_results,
        )
        log.info(
            "[discovery] Job %s completed — pages=%d results=%d reported_total=%s",
            job_id,
            scrape_result.pages_scraped,
            len(scrape_result.results),
            scrape_result.reported_total_results,
        )

    except ArtistNotFoundError:
        # Re-raise without marking failed — no job row was created for this path
        # (artist resolution happens before create_scrape_job, but guard anyway).
        raise

    except Exception as exc:
        # Log full technical detail; store only a controlled summary in the DB.
        if isinstance(exc, APIError) and getattr(exc, "code", None) == "42P10":
            log.error(
                "[discovery] Job %s — relationship upsert rejected (42P10). "
                "Confirm that artist_set_result_artists has a unique constraint/index on "
                "(set_result_id, artist_id).  Apply migration 040000 or run: "
                "CREATE UNIQUE INDEX IF NOT EXISTS "
                "artist_set_result_artists_set_result_artist_uidx "
                "ON public.artist_set_result_artists (set_result_id, artist_id);",
                job_id,
            )
        log.exception("[discovery] Job %s failed: %s", job_id, exc)
        _safe_set_failed(
            repo,
            job_id,
            "Discovery scrape encountered an error. Please try again.",
        )
        raise DiscoveryJobError(
            f"Job {job_id} failed: {type(exc).__name__}"
        ) from exc

    summary = repo.get_job_summary(job_id)
    if summary is None:
        # Extremely unlikely — job was just written.
        return ScrapeJobSummary(
            id=job_id,
            artist_id=artist_id,
            status=JobStatus.COMPLETED,
        )
    return summary


def _safe_set_failed(
    repo: DiscoveryRepository,
    job_id: str,
    message: str,
) -> None:
    """Mark the job failed without masking the original exception if this call fails."""
    try:
        repo.set_job_failed(job_id, message)
    except Exception:
        log.exception(
            "[discovery] Could not mark job %s as failed — DB may be unavailable",
            job_id,
        )


# ── Set-detail workflow ───────────────────────────────────────────────────────

def get_setlist_tracks_response(
    set_result_id: str,
    *,
    repo: Optional[DiscoveryRepository] = None,
) -> SetlistDetailResponse:
    """
    Read-only path: load the stored set summary and track rows without scraping.

    Used by GET /api/discovery/setlists/{set_result_id}/tracks.

    Raises
    ------
    SetResultNotFoundError
        When set_result_id is not present in artist_set_results.
    """
    if repo is None:
        repo = _make_repo()

    summary = repo.get_set_result_full(set_result_id)
    if summary is None:
        raise SetResultNotFoundError(
            f"Set result '{set_result_id}' not found in the DropDex catalog"
        )

    tracks = repo.get_set_tracks(set_result_id)
    return SetlistDetailResponse(setlist=summary, tracks=tracks)


async def run_setlist_detail_scrape(
    set_result_id: str,
    *,
    refresh: bool = False,
    repo: Optional[DiscoveryRepository] = None,
) -> SetlistDetailResponse:
    """
    Scrape, parse and persist individual track rows for a saved setlist result.

    Why this is a direct (synchronous-to-the-caller) endpoint rather than a
    background job:
    - A detail scrape targets ONE page, completing in ~5–15 seconds.
    - Artist-search scrapes use background + polling because they can span 50+
      pages and run for minutes.  That overhead is wrong here.
    - The frontend can await this POST directly and immediately render tracks.

    Parameters
    ----------
    set_result_id:
        UUID of an existing public.artist_set_results row.
    refresh:
        When False (default): return stored tracks if they exist; only scrape
        when no tracks have been saved for this set yet.
        When True: always re-scrape and replace stale rows.
    repo:
        DiscoveryRepository instance.  Inject a mock in tests.

    Returns
    -------
    SetlistDetailResponse with set metadata and ordered tracks.

    Raises
    ------
    SetResultNotFoundError
        When set_result_id is not in artist_set_results.
    InvalidSetlistUrlError
        When the stored source_url fails the safe-URL validation check.
    DetailScrapeError
        When scraping or persistence fails (detail_scrape_status set to 'failed').
    """
    if repo is None:
        repo = _make_repo()

    # ── 1. Load the set result ────────────────────────────────────────────────
    summary = repo.get_set_result_full(set_result_id)
    if summary is None:
        raise SetResultNotFoundError(
            f"Set result '{set_result_id}' not found in the DropDex catalog"
        )

    # ── 2. Return cached tracks when refresh is not requested ─────────────────
    existing_tracks = repo.get_set_tracks(set_result_id)
    if existing_tracks and not refresh:
        log.info(
            "[detail] set=%s has %d cached tracks; returning without scraping",
            set_result_id,
            len(existing_tracks),
        )
        return SetlistDetailResponse(setlist=summary, tracks=existing_tracks)

    # ── 3. Validate stored source URL before handing it to Playwright ─────────
    try:
        validate_setlist_url(summary.source_url)
    except ValueError as exc:
        log.error(
            "[detail] set=%s stored source_url failed validation: %s",
            set_result_id,
            exc,
        )
        raise InvalidSetlistUrlError(str(exc)) from exc

    # ── 4. Mark running ───────────────────────────────────────────────────────
    repo.set_detail_running(set_result_id)

    # ── 5. Scrape the detail page ─────────────────────────────────────────────
    try:
        detail = await scrape_setlist_detail(summary.source_url)
    except Exception as exc:
        log.exception(
            "[detail] set=%s scrape failed at %s: %s",
            set_result_id,
            summary.source_url,
            exc,
        )
        _safe_set_detail_failed(
            repo,
            set_result_id,
            "Set detail scrape failed. Please try again.",
        )
        raise DetailScrapeError(
            f"Detail scrape for set {set_result_id} failed: {type(exc).__name__}"
        ) from exc

    # ── 5b. Reject zero-track results when the setlist metadata says tracks exist ─
    # A scraper that returns 0 rows while the source reports N tracks is not a
    # successful scrape — it indicates the page did not fully render, a DOM selector
    # changed, or a challenge/bot-block page was served.  Marking these as
    # "completed" with parsed_track_count=0 permanently hides the set from users.
    expected_track_count = summary.track_count or 0
    parsed_track_count = len(detail.tracks)
    if expected_track_count > 0 and parsed_track_count == 0:
        error_msg = (
            f"Detail scrape returned 0 parsed tracks, but the setlist metadata "
            f"expected approximately {expected_track_count} tracks. "
            "The 1001Tracklists page may not have fully rendered, the DOM selector "
            "may have changed, or the scraper received a blocked/challenge page. "
            "Use Refresh to try again."
        )
        log.warning(
            "[detail] set=%s zero-track scrape — expected=%d tracks, parsed=0. "
            "source_url=%s. Marking as failed.",
            set_result_id,
            expected_track_count,
            summary.source_url,
        )
        _safe_set_detail_failed(repo, set_result_id, error_msg)
        raise DetailScrapeError(error_msg)

    # ── 6. Persist tracks ─────────────────────────────────────────────────────
    try:
        if refresh:
            keep_ids = {t.source_position_id for t in detail.tracks}
            repo.delete_stale_set_tracks(set_result_id, keep_ids)

        repo.upsert_set_tracks(set_result_id, detail.tracks)
        repo.set_detail_completed(
            set_result_id,
            parsed_track_count=len(detail.tracks),
            has_timed_cues=detail.has_timed_cues,
            source_numeric_tracklist_id=detail.source_numeric_tracklist_id,
            raw_detail_metadata_json=detail.raw_metadata_json,
        )
        log.info(
            "[detail] set=%s completed — tracks=%d timed_cues=%s",
            set_result_id,
            len(detail.tracks),
            detail.has_timed_cues,
        )
    except Exception as exc:
        log.exception(
            "[detail] set=%s persistence failed: %s",
            set_result_id,
            exc,
        )
        _safe_set_detail_failed(
            repo,
            set_result_id,
            "Failed to save set tracks. Please try again.",
        )
        raise DetailScrapeError(
            f"Track persistence for set {set_result_id} failed: {type(exc).__name__}"
        ) from exc

    # ── 7. Build and return the fresh response ────────────────────────────────
    fresh_summary = repo.get_set_result_full(set_result_id)
    saved_tracks = repo.get_set_tracks(set_result_id)
    return SetlistDetailResponse(
        setlist=fresh_summary or summary,
        tracks=saved_tracks,
    )


def _safe_set_detail_failed(
    repo: DiscoveryRepository,
    set_result_id: str,
    message: str,
) -> None:
    """Mark the detail scrape failed; suppress secondary DB errors."""
    try:
        repo.set_detail_failed(set_result_id, message)
    except Exception:
        log.exception(
            "[detail] Could not mark set %s detail as failed — DB may be unavailable",
            set_result_id,
        )
