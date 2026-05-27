"""
Tests for the DropDex discovery API routes.

All external I/O is mocked:
  - DiscoveryRepository: patched so no Supabase calls are made.
  - run_discovery_background: patched as AsyncMock so no Playwright is launched.

Test groups
───────────
  TestArtistSearch           – GET  /api/discovery/artists/search
  TestStartScrape            – POST /api/discovery/artists/{id}/setlists/scrape
  TestScrapeJobStatus        – GET  /api/discovery/scrape-jobs/{id}
  TestGetSetlists            – GET  /api/discovery/artists/{id}/setlists
  TestRekordboxRegressions   – Existing import endpoint still works.
  TestCORSMethods            – CORS allows GET and POST.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt

# conftest.py sets env vars before any app import
from app.main import app
from app.config import settings
from app.discovery.models import (
    ArtistRecord,
    ArtistSearchCandidate,
    JobStatus,
    SavedSetlistResult,
    ScrapeJobResponse,
)
from app.discovery.repository import DiscoveryRepository

client = TestClient(app, raise_server_exceptions=False)

# ── Shared test fixtures ──────────────────────────────────────────────────────

_ARTIST_ID = "aaaaaaaa-0000-0000-0000-000000000001"
_JOB_ID    = "cccccccc-0000-0000-0000-000000000003"
_USER_ID   = "bbbbbbbb-0000-0000-0000-000000000002"

_ARTIST = ArtistRecord(
    id=_ARTIST_ID,
    name="ILLENIUM",
    normalized_name="illenium",
)

_JOB_RESPONSE = ScrapeJobResponse(
    job_id=_JOB_ID,
    artist_id=_ARTIST_ID,
    artist_name="ILLENIUM",
    source="1001tracklists",
    status=JobStatus.RUNNING,
    pages_scraped=2,
    results_found=40,
    total_results_reported=85,
)

_SETLIST = SavedSetlistResult(
    id="eeeeeeee-0000-0000-0000-000000000005",
    source_tracklist_id="tl001",
    source_url="https://www.1001tracklists.com/tracklist/tl001/test.html",
    title="ILLENIUM @ EDC 2026",
    set_date="2026-05-18",
    ided_tracks=20,
    total_tracks=20,
    completion_pct=100.0,
    views=5000,
)


def _make_token(user_id: str = _USER_ID) -> str:
    return jwt.encode(
        {"sub": user_id, "aud": "authenticated", "role": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )


def _auth(user_id: str = _USER_ID) -> dict:
    return {"Authorization": f"Bearer {_make_token(user_id)}"}


def _mock_repo(
    *,
    artist: ArtistRecord | None = _ARTIST,
    search_results: list[ArtistSearchCandidate] | None = None,
    job_id: str = _JOB_ID,
    job_response: ScrapeJobResponse | None = _JOB_RESPONSE,
    setlists: list[SavedSetlistResult] | None = None,
    setlists_total: int = 1,
) -> MagicMock:
    """Return a MagicMock(spec=DiscoveryRepository) pre-wired for common cases."""
    mock = MagicMock(spec=DiscoveryRepository)
    mock.get_artist.return_value = artist
    mock.search_artists.return_value = search_results or []
    mock.create_scrape_job.return_value = job_id
    mock.get_job_summary_for_user.return_value = job_response
    mock.get_set_results_paginated.return_value = (setlists or [_SETLIST], setlists_total)
    return mock


# ══════════════════════════════════════════════════════════════════════════════
# Artist search
# ══════════════════════════════════════════════════════════════════════════════

class TestArtistSearch:

    def test_requires_authentication(self):
        """Missing Authorization header → 422 (FastAPI required-header validation)."""
        resp = client.get("/api/discovery/artists/search?q=illenium")
        assert resp.status_code == 422

    def test_blank_query_returns_empty_list(self):
        """Empty or whitespace-only query returns 200 with an empty list."""
        with patch("app.discovery.routes.DiscoveryRepository"):
            resp = client.get("/api/discovery/artists/search?q=", headers=_auth())
        assert resp.status_code == 200
        assert resp.json() == []

    def test_single_character_query_returns_empty_list(self):
        """Query shorter than 2 chars returns 200 with an empty list (no broad table scan)."""
        with patch("app.discovery.routes.DiscoveryRepository"):
            resp = client.get("/api/discovery/artists/search?q=a", headers=_auth())
        assert resp.status_code == 200
        assert resp.json() == []

    def test_valid_query_returns_candidates(self):
        """Normal query proxies to repo.search_artists and returns shaped candidates."""
        candidates = [
            ArtistSearchCandidate(id=_ARTIST_ID, name="ILLENIUM", normalized_name="illenium"),
            ArtistSearchCandidate(
                id="ffffffff-0000-0000-0000-000000000001",
                name="ILLENIUM b2b Feed Me",
                normalized_name="illenium b2b feed me",
                matched_alias="illenium b2b",
            ),
        ]
        mock = _mock_repo(search_results=candidates)
        with patch("app.discovery.routes.DiscoveryRepository", return_value=mock):
            resp = client.get("/api/discovery/artists/search?q=illenium", headers=_auth())

        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 2
        assert body[0]["id"] == _ARTIST_ID
        assert body[0]["name"] == "ILLENIUM"
        assert body[0]["matched_alias"] is None
        assert body[1]["matched_alias"] == "illenium b2b"

    def test_query_is_trimmed_before_forwarding(self):
        """Leading/trailing whitespace is stripped before hitting the repo."""
        mock = _mock_repo(search_results=[])
        with patch("app.discovery.routes.DiscoveryRepository", return_value=mock):
            resp = client.get("/api/discovery/artists/search?q=+illenium+", headers=_auth())
        assert resp.status_code == 200
        # + in query strings is decoded as space; after strip it's "illenium" (len=7 ≥ 2)
        mock.search_artists.assert_called_once()

    def test_search_results_contain_canonical_ids(self):
        """Every returned candidate must carry a canonical artist id from the DB."""
        candidates = [
            ArtistSearchCandidate(id=_ARTIST_ID, name="ILLENIUM"),
        ]
        mock = _mock_repo(search_results=candidates)
        with patch("app.discovery.routes.DiscoveryRepository", return_value=mock):
            resp = client.get("/api/discovery/artists/search?q=illenium", headers=_auth())

        body = resp.json()
        for item in body:
            assert "id" in item and item["id"]
            assert "name" in item and item["name"]


# ══════════════════════════════════════════════════════════════════════════════
# Start scrape
# ══════════════════════════════════════════════════════════════════════════════

class TestStartScrape:

    def test_requires_authentication(self):
        resp = client.post(f"/api/discovery/artists/{_ARTIST_ID}/setlists/scrape")
        assert resp.status_code == 422

    def test_unknown_artist_returns_404(self):
        mock = _mock_repo(artist=None)
        with (
            patch("app.discovery.routes.DiscoveryRepository", return_value=mock),
            patch("app.discovery.routes.run_discovery_background", new_callable=AsyncMock),
        ):
            resp = client.post(
                f"/api/discovery/artists/{_ARTIST_ID}/setlists/scrape",
                headers=_auth(),
            )
        assert resp.status_code == 404

    def test_returns_202_with_job_info(self):
        mock = _mock_repo()
        with (
            patch("app.discovery.routes.DiscoveryRepository", return_value=mock),
            patch("app.discovery.routes.run_discovery_background", new_callable=AsyncMock),
        ):
            resp = client.post(
                f"/api/discovery/artists/{_ARTIST_ID}/setlists/scrape",
                headers=_auth(),
            )

        assert resp.status_code == 202
        body = resp.json()
        assert body["job_id"] == _JOB_ID
        assert body["artist_id"] == _ARTIST_ID
        assert body["artist_name"] == "ILLENIUM"
        assert body["status"] == "queued"

    def test_uses_artist_id_from_url_not_body(self):
        """
        No freeform artist name is accepted in the request.  The artist_id
        comes from the URL path; name is resolved from the database.
        Verify that create_scrape_job receives the URL artist_id.
        """
        mock = _mock_repo()
        with (
            patch("app.discovery.routes.DiscoveryRepository", return_value=mock),
            patch("app.discovery.routes.run_discovery_background", new_callable=AsyncMock),
        ):
            resp = client.post(
                f"/api/discovery/artists/{_ARTIST_ID}/setlists/scrape",
                headers=_auth(),
            )

        assert resp.status_code == 202
        call_args = mock.create_scrape_job.call_args
        assert call_args.args[1] == _ARTIST_ID, "artist_id must come from the URL path"

    def test_user_id_comes_from_jwt_not_body(self):
        """
        Verify the user_id passed to create_scrape_job is from the JWT,
        not any field submitted in the request.
        """
        mock = _mock_repo()
        with (
            patch("app.discovery.routes.DiscoveryRepository", return_value=mock),
            patch("app.discovery.routes.run_discovery_background", new_callable=AsyncMock),
        ):
            resp = client.post(
                f"/api/discovery/artists/{_ARTIST_ID}/setlists/scrape",
                headers=_auth(_USER_ID),
                # Attempted user_id injection in body — must be ignored
                json={"user_id": "evil-00000000-0000-0000-0000-000000000000"},
            )

        assert resp.status_code == 202
        call_args = mock.create_scrape_job.call_args
        assert call_args.args[0] == _USER_ID, "user_id must come from the JWT"

    def test_background_task_is_launched(self):
        """Background discovery task must be scheduled after job creation."""
        mock = _mock_repo()
        with (
            patch("app.discovery.routes.DiscoveryRepository", return_value=mock),
            patch(
                "app.discovery.routes.run_discovery_background",
                new_callable=AsyncMock,
            ) as mock_bg,
        ):
            resp = client.post(
                f"/api/discovery/artists/{_ARTIST_ID}/setlists/scrape",
                headers=_auth(),
            )

        assert resp.status_code == 202
        mock_bg.assert_called_once()
        bg_kwargs = mock_bg.call_args.kwargs
        assert bg_kwargs.get("job_id") == _JOB_ID

    def test_response_never_contains_arbitrary_artist_string(self):
        """
        The 202 response artist_name must come from the DB-resolved artist,
        not from any frontend-supplied value.
        """
        mock = _mock_repo()
        with (
            patch("app.discovery.routes.DiscoveryRepository", return_value=mock),
            patch("app.discovery.routes.run_discovery_background", new_callable=AsyncMock),
        ):
            resp = client.post(
                f"/api/discovery/artists/{_ARTIST_ID}/setlists/scrape",
                headers=_auth(),
            )

        body = resp.json()
        # The name must match what the mock repo resolved from the DB
        assert body["artist_name"] == _ARTIST.name


# ══════════════════════════════════════════════════════════════════════════════
# Scrape job status
# ══════════════════════════════════════════════════════════════════════════════

class TestScrapeJobStatus:

    def test_requires_authentication(self):
        resp = client.get(f"/api/discovery/scrape-jobs/{_JOB_ID}")
        assert resp.status_code == 422

    def test_unknown_job_returns_404(self):
        mock = _mock_repo(job_response=None)
        with patch("app.discovery.routes.DiscoveryRepository", return_value=mock):
            resp = client.get(
                f"/api/discovery/scrape-jobs/{_JOB_ID}",
                headers=_auth(),
            )
        assert resp.status_code == 404

    def test_job_owned_by_other_user_returns_404(self):
        """
        Ownership is enforced by get_job_summary_for_user filtering on
        requested_by_user_id.  If the job belongs to a different user the repo
        returns None → 404, never 403, to avoid leaking job existence.
        """
        mock = _mock_repo(job_response=None)
        with patch("app.discovery.routes.DiscoveryRepository", return_value=mock):
            resp = client.get(
                f"/api/discovery/scrape-jobs/{_JOB_ID}",
                headers=_auth("other-user-0000-0000-0000-000000000099"),
            )
        assert resp.status_code == 404

    def test_owned_job_returns_200_with_correct_shape(self):
        mock = _mock_repo()
        with patch("app.discovery.routes.DiscoveryRepository", return_value=mock):
            resp = client.get(
                f"/api/discovery/scrape-jobs/{_JOB_ID}",
                headers=_auth(),
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["job_id"] == _JOB_ID
        assert body["artist_id"] == _ARTIST_ID
        assert body["artist_name"] == "ILLENIUM"
        assert body["source"] == "1001tracklists"
        assert body["status"] == "running"
        assert body["pages_scraped"] == 2
        assert body["results_found"] == 40
        assert "created_at" in body
        assert "started_at" in body
        assert "completed_at" in body

    def test_failed_job_includes_error_message(self):
        failed_job = ScrapeJobResponse(
            job_id=_JOB_ID,
            artist_id=_ARTIST_ID,
            artist_name="ILLENIUM",
            source="1001tracklists",
            status=JobStatus.FAILED,
            error_message="Discovery scrape encountered an error. Please try again.",
        )
        mock = _mock_repo(job_response=failed_job)
        with patch("app.discovery.routes.DiscoveryRepository", return_value=mock):
            resp = client.get(
                f"/api/discovery/scrape-jobs/{_JOB_ID}",
                headers=_auth(),
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "failed"
        assert "Please try again" in body["error_message"]

    def test_repo_called_with_user_id_from_jwt(self):
        """Ownership check must pass the JWT user_id to the repo, not a param."""
        mock = _mock_repo()
        with patch("app.discovery.routes.DiscoveryRepository", return_value=mock):
            client.get(
                f"/api/discovery/scrape-jobs/{_JOB_ID}",
                headers=_auth(_USER_ID),
            )

        call_args = mock.get_job_summary_for_user.call_args
        assert call_args.args[0] == _JOB_ID
        assert call_args.args[1] == _USER_ID


# ══════════════════════════════════════════════════════════════════════════════
# Retrieve saved setlists
# ══════════════════════════════════════════════════════════════════════════════

class TestGetSetlists:

    def test_requires_authentication(self):
        resp = client.get(f"/api/discovery/artists/{_ARTIST_ID}/setlists")
        assert resp.status_code == 422

    def test_unknown_artist_returns_404(self):
        mock = _mock_repo(artist=None)
        with patch("app.discovery.routes.DiscoveryRepository", return_value=mock):
            resp = client.get(
                f"/api/discovery/artists/{_ARTIST_ID}/setlists",
                headers=_auth(),
            )
        assert resp.status_code == 404

    def test_returns_stored_results_without_scraping(self):
        """
        GET setlists must return persisted data only.
        run_discovery_background must NOT be called.
        """
        mock = _mock_repo()
        with (
            patch("app.discovery.routes.DiscoveryRepository", return_value=mock),
            patch(
                "app.discovery.routes.run_discovery_background",
                new_callable=AsyncMock,
            ) as mock_bg,
        ):
            resp = client.get(
                f"/api/discovery/artists/{_ARTIST_ID}/setlists",
                headers=_auth(),
            )

        assert resp.status_code == 200
        mock_bg.assert_not_called()

    def test_response_shape(self):
        mock = _mock_repo(setlists=[_SETLIST], setlists_total=1)
        with patch("app.discovery.routes.DiscoveryRepository", return_value=mock):
            resp = client.get(
                f"/api/discovery/artists/{_ARTIST_ID}/setlists",
                headers=_auth(),
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["artist_id"] == _ARTIST_ID
        assert body["total"] == 1
        assert body["limit"] == 20
        assert body["offset"] == 0
        assert len(body["results"]) == 1
        result = body["results"][0]
        assert result["source_tracklist_id"] == "tl001"
        assert result["title"] == "ILLENIUM @ EDC 2026"
        assert result["set_date"] == "2026-05-18"

    def test_pagination_params_forwarded_to_repo(self):
        mock = _mock_repo()
        with patch("app.discovery.routes.DiscoveryRepository", return_value=mock):
            resp = client.get(
                f"/api/discovery/artists/{_ARTIST_ID}/setlists?limit=10&offset=30",
                headers=_auth(),
            )

        assert resp.status_code == 200
        call_args = mock.get_set_results_paginated.call_args
        assert call_args.kwargs["limit"] == 10
        assert call_args.kwargs["offset"] == 30

    def test_limit_too_large_returns_422(self):
        with patch("app.discovery.routes.DiscoveryRepository"):
            resp = client.get(
                f"/api/discovery/artists/{_ARTIST_ID}/setlists?limit=200",
                headers=_auth(),
            )
        assert resp.status_code == 422

    def test_negative_offset_returns_422(self):
        with patch("app.discovery.routes.DiscoveryRepository"):
            resp = client.get(
                f"/api/discovery/artists/{_ARTIST_ID}/setlists?offset=-1",
                headers=_auth(),
            )
        assert resp.status_code == 422

    def test_result_fields_include_listen_sources_and_updated_at(self):
        """Response model must expose listen_sources and updated_at from the DB."""
        rich_setlist = SavedSetlistResult(
            id="eeeeeeee-0000-0000-0000-000000000005",
            source_tracklist_id="tl002",
            source_url="https://www.1001tracklists.com/tracklist/tl002/test.html",
            title="ILLENIUM @ Lollapalooza 2026",
            listen_sources=[{"name": "Soundcloud", "url": "https://soundcloud.com/test"}],
            updated_at="2026-05-20T12:00:00+00:00",
        )
        mock = _mock_repo(setlists=[rich_setlist], setlists_total=1)
        with patch("app.discovery.routes.DiscoveryRepository", return_value=mock):
            resp = client.get(
                f"/api/discovery/artists/{_ARTIST_ID}/setlists",
                headers=_auth(),
            )

        body = resp.json()
        result = body["results"][0]
        assert result["listen_sources"] is not None
        assert result["updated_at"] == "2026-05-20T12:00:00+00:00"


# ══════════════════════════════════════════════════════════════════════════════
# Regression: existing rekordbox import endpoint still works
# ══════════════════════════════════════════════════════════════════════════════

class TestRekordboxRegressions:

    def test_health_check_still_works(self):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_import_endpoint_requires_auth(self):
        resp = client.post(
            "/api/rekordbox/import",
            files={"file": ("exportLibrary.db", b"data", "application/octet-stream")},
        )
        assert resp.status_code == 422

    def test_import_endpoint_reachable_with_valid_token(self):
        """Import endpoint must still accept valid Bearer tokens after router addition."""
        with (
            patch("app.import_service.parse_library", side_effect=RuntimeError("parse")),
        ):
            resp = client.post(
                "/api/rekordbox/import",
                headers=_auth(),
                files={"file": ("exportLibrary.db", b"data", "application/octet-stream")},
            )
        # Parser failure → 422 or 500, but NOT 401/404/405 — the route is reachable
        assert resp.status_code in (422, 500)


# ══════════════════════════════════════════════════════════════════════════════
# CORS configuration
# ══════════════════════════════════════════════════════════════════════════════

class TestCORSMethods:

    def _preflight(self, method: str) -> int:
        resp = client.options(
            "/api/discovery/artists/search",
            headers={
                "Origin": settings.frontend_origin,
                "Access-Control-Request-Method": method,
                "Access-Control-Request-Headers": "Authorization",
            },
        )
        return resp.status_code

    def test_get_is_allowed_by_cors(self):
        assert self._preflight("GET") == 200

    def test_post_is_allowed_by_cors(self):
        assert self._preflight("POST") == 200

    def test_cors_header_present_on_discovery_get(self):
        mock = _mock_repo(search_results=[])
        with patch("app.discovery.routes.DiscoveryRepository", return_value=mock):
            resp = client.get(
                "/api/discovery/artists/search?q=test",
                headers={
                    "Authorization": f"Bearer {_make_token()}",
                    "Origin": settings.frontend_origin,
                },
            )
        assert "access-control-allow-origin" in resp.headers
