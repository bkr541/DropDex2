"""
Tests for the DropDex discovery persistence and orchestration layer.

All external I/O is mocked:
  - Supabase calls:   DiscoveryRepository injected as a MagicMock
  - Playwright scraping: app.discovery.service.scrape_artist_setlists patched

No network connections, no DB writes, no browser launches.

Two test groups:
  TestDiscoveryService   — orchestration logic in service.py
  TestDiscoveryRepository — data-access methods in repository.py (verify
                            the Supabase Python client is called correctly)
"""

from __future__ import annotations

import asyncio
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

from app.discovery.models import (
    ArtistNotFoundError,
    ArtistRecord,
    DiscoveryJobError,
    JobStatus,
    ScrapeJobSummary,
)
from app.discovery.repository import DiscoveryRepository
from app.discovery.service import run_discovery_for_artist
from app.discovery.scrapers.tracklists1001.models import (
    ArtistSetlistScrapeResult,
    PageScrapeAudit,
)
from app.discovery.scrapers.tracklists1001.parser import ParsedSetlistResult


# ── Fixtures / helpers ────────────────────────────────────────────────────────

_ARTIST_ID  = "aaaaaaaa-0000-0000-0000-000000000001"
_USER_ID    = "bbbbbbbb-0000-0000-0000-000000000002"
_JOB_ID     = "cccccccc-0000-0000-0000-000000000003"
_RUN_ID     = "dddddddd-0000-0000-0000-000000000004"
_RESULT_ID1 = "eeeeeeee-0000-0000-0000-000000000005"
_RESULT_ID2 = "ffffffff-0000-0000-0000-000000000006"

_ARTIST = ArtistRecord(
    id=_ARTIST_ID,
    name="ILLENIUM",
    normalized_name="illenium",
    source="1001tracklists",
)

_JOB_SUMMARY_QUEUED = ScrapeJobSummary(
    id=_JOB_ID,
    artist_id=_ARTIST_ID,
    status=JobStatus.QUEUED,
)

_JOB_SUMMARY_COMPLETED = ScrapeJobSummary(
    id=_JOB_ID,
    artist_id=_ARTIST_ID,
    status=JobStatus.COMPLETED,
    pages_scraped=1,
    results_found=2,
    total_results_reported=10,
)

_JOB_SUMMARY_FAILED = ScrapeJobSummary(
    id=_JOB_ID,
    artist_id=_ARTIST_ID,
    status=JobStatus.FAILED,
    error_message="Discovery scrape encountered an error. Please try again.",
)


def _make_parsed_result(tracklist_id: str) -> ParsedSetlistResult:
    return ParsedSetlistResult(
        source="1001tracklists",
        source_tracklist_id=tracklist_id,
        source_url=f"https://www.1001tracklists.com/tracklist/{tracklist_id}/test.html",
        title=f"ILLENIUM @ Venue {tracklist_id}",
        set_date="2026-01-15",
        ided_tracks=20,
        total_tracks=20,
        completion_pct=100.0,
        views=500,
    )


def _make_scrape_result(
    tracklist_ids: list[str],
    pages: int = 1,
) -> ArtistSetlistScrapeResult:
    results = [_make_parsed_result(tid) for tid in tracklist_ids]
    audits  = [
        PageScrapeAudit(
            page_number=i + 1,
            url=f"https://www.1001tracklists.com/search/result.php?page={i + 1}",
            cards_parsed=len(tracklist_ids) if i == 0 else 0,
            has_next_page=(i < pages - 1),
        )
        for i in range(pages)
    ]
    return ArtistSetlistScrapeResult(
        artist_name="ILLENIUM",
        source="1001tracklists",
        reported_total_results=10,
        pages_scraped=pages,
        results_found=len(results),
        results=results,
        page_audit=audits,
    )


def _make_mock_repo(
    *,
    artist: Optional[ArtistRecord] = _ARTIST,
    job_summary: ScrapeJobSummary = _JOB_SUMMARY_COMPLETED,
) -> MagicMock:
    """Return a pre-configured MagicMock(spec=DiscoveryRepository)."""
    mock = MagicMock(spec=DiscoveryRepository)
    mock.get_artist.return_value = artist
    mock.create_scrape_job.return_value = _JOB_ID
    mock.create_search_run.return_value = _RUN_ID
    mock.upsert_set_result.side_effect = [_RESULT_ID1, _RESULT_ID2, _RESULT_ID1, _RESULT_ID2]
    mock.get_job_summary.return_value = job_summary
    return mock


def _run(coro):
    return asyncio.run(coro)


# ══════════════════════════════════════════════════════════════════════════════
# Service orchestration tests
# ══════════════════════════════════════════════════════════════════════════════

class TestDiscoveryService:

    def test_valid_artist_resolves_canonical_name_and_calls_scraper(self):
        """Scraper must be called with artists.name, not any caller-supplied string."""
        mock_repo = _make_mock_repo()
        scrape_result = _make_scrape_result(["tl001", "tl002"])

        async def _inner():
            with patch(
                "app.discovery.service.scrape_artist_setlists",
                new_callable=AsyncMock,
                return_value=scrape_result,
            ) as mock_scrape:
                await run_discovery_for_artist(_ARTIST_ID, _USER_ID, repo=mock_repo)
                mock_scrape.assert_called_once_with("ILLENIUM", max_pages=None)

        _run(_inner())

    def test_unknown_artist_raises_and_does_not_create_job(self):
        """ArtistNotFoundError is raised before any DB row is written."""
        mock_repo = _make_mock_repo(artist=None)

        async def _inner():
            with patch("app.discovery.service.scrape_artist_setlists") as mock_scrape:
                with pytest.raises(ArtistNotFoundError):
                    await run_discovery_for_artist(_ARTIST_ID, _USER_ID, repo=mock_repo)
                mock_scrape.assert_not_called()
                mock_repo.create_scrape_job.assert_not_called()

        _run(_inner())

    def test_job_transitions_queued_running_completed(self):
        """Status transitions must happen in order: create→running→completed."""
        mock_repo = _make_mock_repo()
        scrape_result = _make_scrape_result(["tl001"])

        async def _inner():
            call_order = []
            mock_repo.create_scrape_job.side_effect = lambda *a, **kw: (
                call_order.append("create_queued") or _JOB_ID
            )
            mock_repo.set_job_running.side_effect = lambda *a, **kw: (
                call_order.append("set_running")
            )
            mock_repo.set_job_completed.side_effect = lambda *a, **kw: (
                call_order.append("set_completed")
            )
            with patch(
                "app.discovery.service.scrape_artist_setlists",
                new_callable=AsyncMock,
                return_value=scrape_result,
            ):
                await run_discovery_for_artist(_ARTIST_ID, _USER_ID, repo=mock_repo)

            assert call_order == ["create_queued", "set_running", "set_completed"], (
                f"Unexpected call order: {call_order}"
            )

        _run(_inner())

    def test_scraper_error_marks_job_failed(self):
        """An exception from the scraper must mark the job failed and raise DiscoveryJobError."""
        mock_repo = _make_mock_repo()

        async def _inner():
            with patch(
                "app.discovery.service.scrape_artist_setlists",
                new_callable=AsyncMock,
                side_effect=RuntimeError("Playwright navigation timeout"),
            ):
                with pytest.raises(DiscoveryJobError):
                    await run_discovery_for_artist(_ARTIST_ID, _USER_ID, repo=mock_repo)

            mock_repo.set_job_failed.assert_called_once()
            error_msg = mock_repo.set_job_failed.call_args[0][1]
            assert "Please try again" in error_msg
            # Internal Playwright detail must NOT appear in the DB error message
            assert "Playwright" not in error_msg
            assert "navigation timeout" not in error_msg

        _run(_inner())

    def test_set_job_completed_never_called_on_failure(self):
        """On scraper failure, completed must NOT be called (only failed)."""
        mock_repo = _make_mock_repo()

        async def _inner():
            with patch(
                "app.discovery.service.scrape_artist_setlists",
                new_callable=AsyncMock,
                side_effect=ValueError("bad html"),
            ):
                with pytest.raises(DiscoveryJobError):
                    await run_discovery_for_artist(_ARTIST_ID, _USER_ID, repo=mock_repo)

            mock_repo.set_job_completed.assert_not_called()
            mock_repo.set_job_failed.assert_called_once()

        _run(_inner())

    def test_upsert_called_for_each_result(self):
        """upsert_set_result must be called once per discovered result."""
        mock_repo = _make_mock_repo()
        scrape_result = _make_scrape_result(["tl001", "tl002"])

        async def _inner():
            with patch(
                "app.discovery.service.scrape_artist_setlists",
                new_callable=AsyncMock,
                return_value=scrape_result,
            ):
                await run_discovery_for_artist(_ARTIST_ID, _USER_ID, repo=mock_repo)

            assert mock_repo.upsert_set_result.call_count == 2

        _run(_inner())

    def test_upsert_called_again_on_second_run_same_results(self):
        """Running the service twice for the same artist calls upsert both times."""
        mock_repo = _make_mock_repo()
        scrape_result = _make_scrape_result(["tl001", "tl002"])

        async def _inner():
            with patch(
                "app.discovery.service.scrape_artist_setlists",
                new_callable=AsyncMock,
                return_value=scrape_result,
            ):
                await run_discovery_for_artist(_ARTIST_ID, _USER_ID, repo=mock_repo)
                await run_discovery_for_artist(_ARTIST_ID, _USER_ID, repo=mock_repo)

            # Each run calls upsert twice → 4 total
            assert mock_repo.upsert_set_result.call_count == 4

        _run(_inner())

    def test_artist_linked_to_each_discovered_result(self):
        """link_result_to_artist must be called once per result with the artist ID."""
        mock_repo = _make_mock_repo()
        scrape_result = _make_scrape_result(["tl001", "tl002"])

        async def _inner():
            with patch(
                "app.discovery.service.scrape_artist_setlists",
                new_callable=AsyncMock,
                return_value=scrape_result,
            ):
                await run_discovery_for_artist(_ARTIST_ID, _USER_ID, repo=mock_repo)

            assert mock_repo.link_result_to_artist.call_count == 2
            for c in mock_repo.link_result_to_artist.call_args_list:
                # Second positional arg must be the resolved artist_id
                assert c.args[1] == _ARTIST_ID
                # Third positional arg must be the canonical name from the DB
                assert c.args[2] == "ILLENIUM"

        _run(_inner())

    def test_user_id_stored_from_parameter_not_scrape_data(self):
        """
        The user_id passed to create_scrape_job must come from the caller parameter
        (i.e., the validated JWT), not from any field in the scrape result.
        """
        mock_repo = _make_mock_repo()
        scrape_result = _make_scrape_result(["tl001"])

        async def _inner():
            with patch(
                "app.discovery.service.scrape_artist_setlists",
                new_callable=AsyncMock,
                return_value=scrape_result,
            ):
                await run_discovery_for_artist(_ARTIST_ID, _USER_ID, repo=mock_repo)

            create_call = mock_repo.create_scrape_job.call_args
            # First arg is user_id
            assert create_call.args[0] == _USER_ID
            # Second arg is artist_id
            assert create_call.args[1] == _ARTIST_ID

        _run(_inner())

    def test_search_run_created_with_canonical_artist_name(self):
        """create_search_run must receive the DB-resolved name, never arbitrary input."""
        mock_repo = _make_mock_repo()
        scrape_result = _make_scrape_result(["tl001"])

        async def _inner():
            with patch(
                "app.discovery.service.scrape_artist_setlists",
                new_callable=AsyncMock,
                return_value=scrape_result,
            ):
                await run_discovery_for_artist(_ARTIST_ID, _USER_ID, repo=mock_repo)

            create_run_call = mock_repo.create_search_run.call_args
            assert create_run_call.args[2] == "ILLENIUM"

        _run(_inner())

    def test_page_audits_persisted(self):
        """insert_search_page must be called once per page_audit entry."""
        mock_repo = _make_mock_repo()
        scrape_result = _make_scrape_result(["tl001"], pages=3)

        async def _inner():
            with patch(
                "app.discovery.service.scrape_artist_setlists",
                new_callable=AsyncMock,
                return_value=scrape_result,
            ):
                await run_discovery_for_artist(_ARTIST_ID, _USER_ID, repo=mock_repo)

            assert mock_repo.insert_search_page.call_count == 3

        _run(_inner())

    def test_zero_result_scrape_marks_completed_not_failed(self):
        """A scrape that finds zero results is still a successful completion."""
        mock_repo = _make_mock_repo()
        empty_result = ArtistSetlistScrapeResult(
            artist_name="ILLENIUM",
            source="1001tracklists",
            reported_total_results=0,
            pages_scraped=1,
            results_found=0,
            results=[],
            page_audit=[
                PageScrapeAudit(
                    page_number=1,
                    url="https://example.com",
                    cards_parsed=0,
                    has_next_page=False,
                )
            ],
        )

        async def _inner():
            with patch(
                "app.discovery.service.scrape_artist_setlists",
                new_callable=AsyncMock,
                return_value=empty_result,
            ):
                await run_discovery_for_artist(_ARTIST_ID, _USER_ID, repo=mock_repo)

            mock_repo.set_job_completed.assert_called_once()
            mock_repo.set_job_failed.assert_not_called()

        _run(_inner())


# ══════════════════════════════════════════════════════════════════════════════
# Repository tests — verify correct Supabase client method calls
# ══════════════════════════════════════════════════════════════════════════════

def _make_supabase_mock():
    """
    Build a mock Supabase client whose chained method calls return configurable data.

    Returns (mock_client, mock_table) where mock_table is the object returned
    by client.table(…).  Caller configures mock_table.select…execute.data etc.
    """
    mock_client  = MagicMock()
    mock_table   = MagicMock()
    mock_client.table.return_value = mock_table
    return mock_client, mock_table


class TestDiscoveryRepository:

    def _repo(self, mock_client) -> DiscoveryRepository:
        with patch("app.discovery.repository.create_client", return_value=mock_client):
            return DiscoveryRepository("https://example.supabase.co", "fake-key")

    # ── get_artist ────────────────────────────────────────────────────────────

    def test_get_artist_returns_record_on_match(self):
        mock_client, mock_table = _make_supabase_mock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = [
            {
                "id": _ARTIST_ID,
                "name": "ILLENIUM",
                "normalized_name": "illenium",
                "source": "1001tracklists",
                "source_artist_url": None,
            }
        ]
        repo = self._repo(mock_client)
        artist = repo.get_artist(_ARTIST_ID)

        assert artist is not None
        assert artist.name == "ILLENIUM"
        assert artist.id == _ARTIST_ID

    def test_get_artist_returns_none_on_no_match(self):
        mock_client, mock_table = _make_supabase_mock()
        mock_table.select.return_value.eq.return_value.execute.return_value.data = []
        repo = self._repo(mock_client)
        assert repo.get_artist(_ARTIST_ID) is None

    # ── create_scrape_job ─────────────────────────────────────────────────────

    def test_create_scrape_job_inserts_with_queued_status(self):
        mock_client, mock_table = _make_supabase_mock()
        mock_table.insert.return_value.execute.return_value.data = [{"id": _JOB_ID}]
        repo = self._repo(mock_client)

        job_id = repo.create_scrape_job(_USER_ID, _ARTIST_ID)

        assert job_id == _JOB_ID
        insert_call = mock_table.insert.call_args[0][0]
        assert insert_call["status"] == "queued"
        assert insert_call["requested_by_user_id"] == _USER_ID
        assert insert_call["artist_id"] == _ARTIST_ID

    # ── upsert_set_result — critical dedup assertion ──────────────────────────

    def test_upsert_set_result_uses_upsert_not_insert(self):
        """
        upsert_set_result must call .upsert(..., on_conflict="source,source_tracklist_id")
        and NOT .insert(…).  This verifies the deduplication contract.
        """
        mock_client, mock_table = _make_supabase_mock()
        mock_table.upsert.return_value.execute.return_value.data = [{"id": _RESULT_ID1}]
        repo = self._repo(mock_client)

        result = _make_parsed_result("tl001")
        returned_id = repo.upsert_set_result(_RUN_ID, _ARTIST_ID, result)

        mock_table.upsert.assert_called_once()
        mock_table.insert.assert_not_called()

        upsert_kwargs = mock_table.upsert.call_args[1]
        assert upsert_kwargs.get("on_conflict") == "source,source_tracklist_id", (
            "on_conflict must target exactly (source, source_tracklist_id)"
        )
        assert returned_id == _RESULT_ID1

    def test_upsert_set_result_payload_fields(self):
        """The upsert payload must include all required fields from the parsed result."""
        mock_client, mock_table = _make_supabase_mock()
        mock_table.upsert.return_value.execute.return_value.data = [{"id": _RESULT_ID1}]
        repo = self._repo(mock_client)

        result = _make_parsed_result("tl001")
        repo.upsert_set_result(_RUN_ID, _ARTIST_ID, result)

        payload = mock_table.upsert.call_args[0][0]
        assert payload["source"] == "1001tracklists"
        assert payload["source_tracklist_id"] == "tl001"
        assert payload["artist_id"] == _ARTIST_ID
        assert payload["search_run_id"] == _RUN_ID
        assert "normalized_title" in payload
        assert payload["views"] == 500

    # ── link_result_to_artist ──────────────────────────────────────────────────

    def test_link_result_to_artist_inserts_when_absent(self):
        mock_client, mock_table = _make_supabase_mock()
        # select returns no rows → insert should be called
        mock_table.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        mock_table.insert.return_value.execute.return_value.data = [{"id": "link-uuid"}]
        repo = self._repo(mock_client)

        repo.link_result_to_artist(_RESULT_ID1, _ARTIST_ID, "ILLENIUM")

        mock_table.insert.assert_called_once()
        insert_payload = mock_table.insert.call_args[0][0]
        assert insert_payload["set_result_id"] == _RESULT_ID1
        assert insert_payload["artist_id"] == _ARTIST_ID
        assert insert_payload["display_name"] == "ILLENIUM"
        assert insert_payload["normalized_name"] == "illenium"

    def test_link_result_to_artist_skips_insert_when_already_linked(self):
        """No duplicate insert when the artist–result link already exists."""
        mock_client, mock_table = _make_supabase_mock()
        # select returns an existing row
        mock_table.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"id": "existing-link-uuid"}
        ]
        repo = self._repo(mock_client)

        repo.link_result_to_artist(_RESULT_ID1, _ARTIST_ID, "ILLENIUM")

        mock_table.insert.assert_not_called()

    # ── set_job_running / completed / failed ──────────────────────────────────

    def test_set_job_running_calls_update_with_running_status(self):
        mock_client, mock_table = _make_supabase_mock()
        mock_table.update.return_value.eq.return_value.execute.return_value.data = []
        repo = self._repo(mock_client)

        repo.set_job_running(_JOB_ID)

        update_payload = mock_table.update.call_args[0][0]
        assert update_payload["status"] == "running"
        assert "started_at" in update_payload

    def test_set_job_completed_records_totals(self):
        mock_client, mock_table = _make_supabase_mock()
        mock_table.update.return_value.eq.return_value.execute.return_value.data = []
        repo = self._repo(mock_client)

        repo.set_job_completed(
            _JOB_ID, pages_scraped=3, results_found=60, total_results_reported=85
        )

        update_payload = mock_table.update.call_args[0][0]
        assert update_payload["status"] == "completed"
        assert update_payload["pages_scraped"] == 3
        assert update_payload["results_found"] == 60
        assert update_payload["total_results_reported"] == 85
        assert "completed_at" in update_payload

    def test_set_job_failed_stores_controlled_message(self):
        mock_client, mock_table = _make_supabase_mock()
        mock_table.update.return_value.eq.return_value.execute.return_value.data = []
        repo = self._repo(mock_client)

        repo.set_job_failed(_JOB_ID, "Discovery scrape encountered an error.")

        update_payload = mock_table.update.call_args[0][0]
        assert update_payload["status"] == "failed"
        assert update_payload["error_message"] == "Discovery scrape encountered an error."
        assert "completed_at" in update_payload


# ══════════════════════════════════════════════════════════════════════════════
# Security constraint tests
# ══════════════════════════════════════════════════════════════════════════════

class TestSecurityConstraints:

    def test_frontend_api_hooks_do_not_reference_1001tracklists_directly(self):
        """
        No file in src/lib/api/ or src/hooks/ may contain a direct reference
        to '1001tracklists.com'.  All scraping is delegated to the backend.
        """
        import pathlib

        repo_root = pathlib.Path(__file__).parent.parent.parent
        search_dirs = [
            repo_root / "src" / "lib" / "api",
            repo_root / "src" / "hooks",
        ]
        violations: list[str] = []
        for directory in search_dirs:
            if not directory.exists():
                continue
            for ts_file in directory.glob("*.ts"):
                text = ts_file.read_text(encoding="utf-8")
                if "1001tracklists.com" in text:
                    violations.append(str(ts_file.relative_to(repo_root)))

        assert not violations, (
            "Frontend fetch modules must never reference 1001tracklists.com directly. "
            f"Violations found in: {violations}"
        )
