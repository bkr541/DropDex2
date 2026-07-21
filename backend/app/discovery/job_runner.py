"""
Minimal FastAPI-compatible background task entry point for discovery jobs.

Usage in a future API route
───────────────────────────
    from fastapi import BackgroundTasks, Depends
    from app.auth import get_current_user_id
    from app.discovery.job_runner import run_discovery_background
    from app.discovery.repository import DiscoveryRepository

    @router.post("/discovery/{artist_id}/start")
    async def start_discovery(
        artist_id: str,
        background_tasks: BackgroundTasks,
        user_id: str = Depends(get_current_user_id),
    ):
        repo = DiscoveryRepository(settings.supabase_url, settings.supabase_secret_key)
        artist = repo.get_artist(artist_id)
        if artist is None:
            raise HTTPException(404, "Artist not found")
        job_id = repo.create_scrape_job(user_id, artist_id)
        background_tasks.add_task(
            run_discovery_background, artist_id, user_id, artist.name, job_id
        )
        return {"job_id": job_id, "status": "queued"}

⚠️  Background-task durability note
─────────────────────────────────────
FastAPI in-process background tasks are sufficient for local / single-instance
development but are NOT durable across process restarts.  A job marked
"running" when the process exits cannot resume in place. DropDex now persists
heartbeats and a recurring reaper marks abandoned jobs failed so the UI can
offer a retry instead of polling forever.

For stronger production durability:
  - Run this in a durable worker (Celery, ARQ, or a Supabase Edge Function).
  - Requeue leased jobs after worker failure rather than failing them.
  - The service.run_discovery_for_artist function is worker-agnostic; only
    this file changes when adopting a durable queue.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.discovery.models import ArtistNotFoundError
from app.discovery.service import run_discovery_for_artist

log = logging.getLogger(__name__)


async def run_discovery_background(
    artist_id: str,
    user_id: str,
    *,
    job_id: Optional[str] = None,
) -> None:
    """
    Thin async wrapper for FastAPI BackgroundTasks.

    Runs the full discovery lifecycle.  All exceptions are caught and logged
    so a background task failure does not raise inside FastAPI's task runner.

    The job record is updated to "failed" by the service before this function
    returns, so callers can poll scrape_jobs.status for the outcome.

    Parameters
    ----------
    job_id:
        UUID of a pre-created scrape_jobs row.  When supplied it is forwarded
        to ``run_discovery_for_artist`` so the service skips the second
        ``create_scrape_job`` call.  API routes pass this to return the job_id
        in an immediate 202 response before the background task runs.
    """
    log.info("[job_runner] Background discovery started — artist=%s user=%s", artist_id, user_id)
    try:
        summary = await run_discovery_for_artist(artist_id, user_id, job_id=job_id)
        log.info(
            "[job_runner] Discovery complete — job=%s status=%s results=%d",
            summary.id,
            summary.status,
            summary.results_found,
        )
    except ArtistNotFoundError as exc:
        # Artist was deleted between validation and execution — no job was created.
        log.warning("[job_runner] Artist not found in background task: %s", exc)
    except Exception:
        # Job has already been marked failed by the service layer.
        log.exception(
            "[job_runner] Discovery background task failed — artist=%s user=%s",
            artist_id,
            user_id,
        )
