"""
Tests for the setlist-detail scrape workflow.

Covers:
  TestUrlValidator               – validate_setlist_url rejects unsafe URLs
  TestGetSetTracksRoute          – GET /api/discovery/setlists/{id}/tracks
  TestScrapeSetTracksRoute       – POST /api/discovery/setlists/{id}/tracks/scrape
  TestDetailService              – run_setlist_detail_scrape orchestration logic
  TestGetSetlistTracksResponse   – get_setlist_tracks_response read-only path

All external I/O is mocked — no Playwright, no Supabase calls.
"""

from __future__ import annotations

import asyncio
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.config import settings
from app.main import app
from app.discovery.models import (
    DetailScrapeError,
    InvalidSetlistUrlError,
    SetlistDetailResponse,
    SetlistDetailSummary,
    SetResultNotFoundError,
    SetTrackRecord,
)
from app.discovery.repository import DiscoveryRepository
from app.discovery.scrapers.tracklists1001.browser_client import validate_setlist_url
from app.discovery.scrapers.tracklists1001.detail_parser import ParsedTrackPosition
from app.discovery.service import get_setlist_tracks_response, run_setlist_detail_scrape

client = TestClient(app, raise_server_exceptions=False)

# ── Shared constants ──────────────────────────────────────────────────────────

_SET_RESULT_ID = "11111111-0000-0000-0000-000000000001"
_USER_ID       = "bbbbbbbb-0000-0000-0000-000000000002"
_VALID_URL     = "https://www.1001tracklists.com/tracklist/abc123/test-set.html"

_SUMMARY = SetlistDetailSummary(
    id=_SET_RESULT_ID,
    title="ILLENIUM @ Test Venue",
    source_url=_VALID_URL,
    set_date="2026-05-02",
    artwork_url=None,
    duration_seconds=None,
    track_count=15,
    parsed_track_count=None,
    detail_scrape_status="not_scraped",
    detail_scraped_at=None,
    detail_scrape_error=None,
    has_timed_cues=None,
)

_SUMMARY_COMPLETED = SetlistDetailSummary(
    id=_SET_RESULT_ID,
    title="ILLENIUM @ Test Venue",
    source_url=_VALID_URL,
    set_date="2026-05-02",
    detail_scrape_status="completed",
    detail_scraped_at="2026-05-27T10:00:00+00:00",
    detail_scrape_error=None,
    parsed_track_count=2,
    has_timed_cues=False,
    track_count=15,
)


def _make_track(seq: int, w: bool = False) -> SetTrackRecord:
    return SetTrackRecord(
        id=f"track-{seq:04d}-0000-0000-0000-000000000000",
        set_result_id=_SET_RESULT_ID,
        source="1001tracklists",
        source_position_id=f"pos{seq}",
        source_track_id=f"tid{seq}" if not w else None,
        sequence_index=seq,
        track_number=seq + 1 if not w else None,
        played_with_previous=w,
        cue_seconds=None,
        cue_text=None,
        title=f"Track {seq}" if not w else "Layered Track",
        artist_text="ILLENIUM",
        label_text=None,
        duration_seconds=200 + seq,
        duration_text=f"3:{30 + seq:02d}",
        source_track_url=f"https://www.1001tracklists.com/track/tid{seq}/test.html" if not w else None,
        artwork_url=None,
    )


def _make_parsed_track(seq: int, w: bool = False) -> ParsedTrackPosition:
    return ParsedTrackPosition(
        source_position_id=f"pos{seq}",
        source_track_id=f"tid{seq}" if not w else None,
        sequence_index=seq,
        track_number=seq + 1 if not w else None,
        played_with_previous=w,
        cue_seconds=None,
        cue_text=None,
        title=f"Track {seq}" if not w else "Layered Track",
        artist_text="ILLENIUM",
        label_text=None,
        duration_seconds=200 + seq,
        duration_text=f"3:{30 + seq:02d}",
        source_track_url=f"https://www.1001tracklists.com/track/tid{seq}/test.html" if not w else None,
        artwork_url=None,
        raw_track_json=None,
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
    summary: Optional[SetlistDetailSummary] = _SUMMARY,
    tracks: Optional[list[SetTrackRecord]] = None,
) -> MagicMock:
    mock = MagicMock(spec=DiscoveryRepository)
    mock.get_set_result_full.return_value = summary
    mock.get_set_tracks.return_value = tracks or []
    return mock


# ══════════════════════════════════════════════════════════════════════════════
# URL validator
# ══════════════════════════════════════════════════════════════════════════════

class TestUrlValidator:

    def test_valid_url_passes(self):
        validate_setlist_url(_VALID_URL)  # no exception

    def test_http_rejected(self):
        with pytest.raises(ValueError, match="HTTPS"):
            validate_setlist_url("http://www.1001tracklists.com/tracklist/abc/test.html")

    def test_wrong_host_rejected(self):
        with pytest.raises(ValueError, match="1001tracklists"):
            validate_setlist_url("https://evil.example.com/tracklist/abc/test.html")

    def test_subdomain_rejected(self):
        with pytest.raises(ValueError, match="1001tracklists"):
            validate_setlist_url("https://sub.1001tracklists.com/tracklist/abc/test.html")

    def test_wrong_path_rejected(self):
        with pytest.raises(ValueError, match="/tracklist/"):
            validate_setlist_url("https://www.1001tracklists.com/search/result.php")

    def test_artist_page_rejected(self):
        with pytest.raises(ValueError, match="/tracklist/"):
            validate_setlist_url("https://www.1001tracklists.com/artist/5gsmf3d/illenium/index.html")

    def test_empty_string_rejected(self):
        with pytest.raises(ValueError):
            validate_setlist_url("")

    def test_deep_tracklist_url_passes(self):
        validate_setlist_url(
            "https://www.1001tracklists.com/tracklist/2gugs001/"
            "wooli-crankdat-wankdat-ultra-miami-2026-03-29.html"
        )


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/discovery/setlists/{id}/tracks  (route tests)
# ══════════════════════════════════════════════════════════════════════════════

class TestGetSetTracksRoute:

    def test_requires_authentication(self):
        resp = client.get(f"/api/discovery/setlists/{_SET_RESULT_ID}/tracks")
        assert resp.status_code == 422

    def test_returns_404_when_set_not_found(self):
        with patch("app.discovery.routes.get_setlist_tracks_response") as mock_fn:
            mock_fn.side_effect = SetResultNotFoundError("not found")
            resp = client.get(
                f"/api/discovery/setlists/{_SET_RESULT_ID}/tracks",
                headers=_auth(),
            )
        assert resp.status_code == 404

    def test_returns_200_with_empty_tracks_when_not_yet_scraped(self):
        with patch("app.discovery.routes.get_setlist_tracks_response") as mock_fn:
            mock_fn.return_value = SetlistDetailResponse(
                setlist=_SUMMARY,
                tracks=[],
            )
            resp = client.get(
                f"/api/discovery/setlists/{_SET_RESULT_ID}/tracks",
                headers=_auth(),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["tracks"] == []
        assert body["setlist"]["detail_scrape_status"] == "not_scraped"

    def test_returns_saved_tracks_in_sequence_order(self):
        saved = [_make_track(0), _make_track(1, w=True), _make_track(2)]
        with patch("app.discovery.routes.get_setlist_tracks_response") as mock_fn:
            mock_fn.return_value = SetlistDetailResponse(
                setlist=_SUMMARY_COMPLETED,
                tracks=saved,
            )
            resp = client.get(
                f"/api/discovery/setlists/{_SET_RESULT_ID}/tracks",
                headers=_auth(),
            )
        assert resp.status_code == 200
        body = resp.json()
        indices = [t["sequence_index"] for t in body["tracks"]]
        assert indices == [0, 1, 2]

    def test_w_row_has_played_with_previous_true(self):
        tracks = [_make_track(0), _make_track(1, w=True)]
        with patch("app.discovery.routes.get_setlist_tracks_response") as mock_fn:
            mock_fn.return_value = SetlistDetailResponse(
                setlist=_SUMMARY_COMPLETED, tracks=tracks
            )
            resp = client.get(
                f"/api/discovery/setlists/{_SET_RESULT_ID}/tracks",
                headers=_auth(),
            )
        assert resp.status_code == 200
        w_track = resp.json()["tracks"][1]
        assert w_track["played_with_previous"] is True
        assert w_track["track_number"] is None

    def test_setlist_metadata_in_response(self):
        with patch("app.discovery.routes.get_setlist_tracks_response") as mock_fn:
            mock_fn.return_value = SetlistDetailResponse(
                setlist=_SUMMARY_COMPLETED, tracks=[]
            )
            resp = client.get(
                f"/api/discovery/setlists/{_SET_RESULT_ID}/tracks",
                headers=_auth(),
            )
        assert resp.status_code == 200
        sl = resp.json()["setlist"]
        assert sl["id"] == _SET_RESULT_ID
        assert sl["detail_scrape_status"] == "completed"
        assert sl["detail_scrape_error"] is None


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/discovery/setlists/{id}/tracks/scrape  (route tests)
# ══════════════════════════════════════════════════════════════════════════════

class TestScrapeSetTracksRoute:

    def test_requires_authentication(self):
        resp = client.post(
            f"/api/discovery/setlists/{_SET_RESULT_ID}/tracks/scrape"
        )
        assert resp.status_code == 422

    def test_returns_404_when_set_not_found(self):
        with patch("app.discovery.routes.run_setlist_detail_scrape") as mock_fn:
            mock_fn.side_effect = SetResultNotFoundError("not found")
            resp = client.post(
                f"/api/discovery/setlists/{_SET_RESULT_ID}/tracks/scrape",
                headers=_auth(),
            )
        assert resp.status_code == 404

    def test_returns_400_on_invalid_url(self):
        with patch("app.discovery.routes.run_setlist_detail_scrape") as mock_fn:
            mock_fn.side_effect = InvalidSetlistUrlError("bad host")
            resp = client.post(
                f"/api/discovery/setlists/{_SET_RESULT_ID}/tracks/scrape",
                headers=_auth(),
            )
        assert resp.status_code == 400
        assert "supported" in resp.json()["detail"].lower()

    def test_returns_503_on_scrape_failure(self):
        with patch("app.discovery.routes.run_setlist_detail_scrape") as mock_fn:
            mock_fn.side_effect = DetailScrapeError("playwright timed out")
            resp = client.post(
                f"/api/discovery/setlists/{_SET_RESULT_ID}/tracks/scrape",
                headers=_auth(),
            )
        assert resp.status_code == 503

    def test_returns_200_with_tracks_on_success(self):
        saved = [_make_track(0), _make_track(1)]
        expected = SetlistDetailResponse(setlist=_SUMMARY_COMPLETED, tracks=saved)
        with patch("app.discovery.routes.run_setlist_detail_scrape") as mock_fn:
            mock_fn.return_value = expected
            resp = client.post(
                f"/api/discovery/setlists/{_SET_RESULT_ID}/tracks/scrape",
                headers=_auth(),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["tracks"]) == 2
        assert body["setlist"]["detail_scrape_status"] == "completed"

    def test_refresh_query_param_forwarded(self):
        """refresh=true should be passed through to run_setlist_detail_scrape."""
        with patch("app.discovery.routes.run_setlist_detail_scrape") as mock_fn:
            mock_fn.return_value = SetlistDetailResponse(
                setlist=_SUMMARY_COMPLETED, tracks=[]
            )
            client.post(
                f"/api/discovery/setlists/{_SET_RESULT_ID}/tracks/scrape?refresh=true",
                headers=_auth(),
            )
        # Verify the service was called with refresh=True
        mock_fn.assert_called_once()
        _, kwargs = mock_fn.call_args
        assert kwargs.get("refresh") is True

    def test_default_refresh_is_false(self):
        with patch("app.discovery.routes.run_setlist_detail_scrape") as mock_fn:
            mock_fn.return_value = SetlistDetailResponse(
                setlist=_SUMMARY_COMPLETED, tracks=[]
            )
            client.post(
                f"/api/discovery/setlists/{_SET_RESULT_ID}/tracks/scrape",
                headers=_auth(),
            )
        _, kwargs = mock_fn.call_args
        assert kwargs.get("refresh") is False


# ══════════════════════════════════════════════════════════════════════════════
# get_setlist_tracks_response  (service read-only path)
# ══════════════════════════════════════════════════════════════════════════════

class TestGetSetlistTracksResponse:

    def test_raises_when_set_not_found(self):
        repo = _mock_repo(summary=None)
        with pytest.raises(SetResultNotFoundError):
            get_setlist_tracks_response(_SET_RESULT_ID, repo=repo)

    def test_returns_response_with_empty_tracks(self):
        repo = _mock_repo(summary=_SUMMARY, tracks=[])
        result = get_setlist_tracks_response(_SET_RESULT_ID, repo=repo)
        assert isinstance(result, SetlistDetailResponse)
        assert result.tracks == []
        assert result.setlist.id == _SET_RESULT_ID

    def test_returns_response_with_saved_tracks(self):
        tracks = [_make_track(0), _make_track(1)]
        repo = _mock_repo(summary=_SUMMARY_COMPLETED, tracks=tracks)
        result = get_setlist_tracks_response(_SET_RESULT_ID, repo=repo)
        assert len(result.tracks) == 2
        assert result.tracks[0].sequence_index == 0
        assert result.tracks[1].sequence_index == 1

    def test_no_db_writes_on_read(self):
        repo = _mock_repo(tracks=[_make_track(0)])
        get_setlist_tracks_response(_SET_RESULT_ID, repo=repo)
        repo.set_detail_running.assert_not_called()
        repo.upsert_set_tracks.assert_not_called()
        repo.set_detail_completed.assert_not_called()


# ══════════════════════════════════════════════════════════════════════════════
# run_setlist_detail_scrape  (service orchestration)
# ══════════════════════════════════════════════════════════════════════════════

class TestDetailService:

    # ── Set-not-found ─────────────────────────────────────────────────────────

    def test_raises_when_set_not_found(self):
        repo = _mock_repo(summary=None)
        with pytest.raises(SetResultNotFoundError):
            asyncio.run(
                run_setlist_detail_scrape(_SET_RESULT_ID, repo=repo)
            )

    # ── Cached path (refresh=False, tracks exist) ─────────────────────────────

    def test_cached_tracks_returned_without_scraping(self):
        existing = [_make_track(0), _make_track(1)]
        repo = _mock_repo(summary=_SUMMARY_COMPLETED, tracks=existing)
        with patch(
            "app.discovery.service.scrape_setlist_detail", new_callable=AsyncMock
        ) as mock_scrape:
            result = asyncio.run(
                run_setlist_detail_scrape(_SET_RESULT_ID, refresh=False, repo=repo)
            )
        mock_scrape.assert_not_called()
        assert len(result.tracks) == 2

    def test_scrapes_when_no_cached_tracks_even_if_refresh_false(self):
        """Empty cached tracks must trigger a scrape regardless of refresh flag."""
        repo = _mock_repo(summary=_SUMMARY, tracks=[])
        parsed_tracks = [_make_parsed_track(0), _make_parsed_track(1)]

        from app.discovery.scrapers.tracklists1001.detail_parser import ParsedTracklistDetail
        parsed_detail = ParsedTracklistDetail(
            source_numeric_tracklist_id="999",
            title="Test",
            canonical_url=_VALID_URL,
            declared_position_count=2,
            tracks=parsed_tracks,
            has_timed_cues=False,
        )

        # After completion, repo returns the completed summary and saved tracks
        repo.get_set_result_full.side_effect = [
            _SUMMARY,           # initial load
            _SUMMARY_COMPLETED, # after set_detail_completed
        ]
        repo.get_set_tracks.side_effect = [
            [],                            # cached check → empty
            [_make_track(0), _make_track(1)],  # final read
        ]

        with patch(
            "app.discovery.service.scrape_setlist_detail",
            new_callable=AsyncMock,
            return_value=parsed_detail,
        ):
            result = asyncio.run(
                run_setlist_detail_scrape(_SET_RESULT_ID, refresh=False, repo=repo)
            )

        repo.upsert_set_tracks.assert_called_once()
        assert len(result.tracks) == 2

    # ── Invalid URL ───────────────────────────────────────────────────────────

    def test_raises_invalid_url_for_bad_source_url(self):
        bad_summary = SetlistDetailSummary(
            id=_SET_RESULT_ID,
            title="Bad",
            source_url="https://evil.com/tracklist/abc/test.html",
            detail_scrape_status="not_scraped",
        )
        repo = _mock_repo(summary=bad_summary, tracks=[])
        with pytest.raises(InvalidSetlistUrlError):
            asyncio.run(
                run_setlist_detail_scrape(_SET_RESULT_ID, repo=repo)
            )
        # Status must NOT be set to running before URL validation fails
        repo.set_detail_running.assert_not_called()

    # ── Scrape failure ────────────────────────────────────────────────────────

    def test_marks_failed_on_scrape_error(self):
        repo = _mock_repo(summary=_SUMMARY, tracks=[])
        with patch(
            "app.discovery.service.scrape_setlist_detail",
            new_callable=AsyncMock,
            side_effect=RuntimeError("playwright timeout"),
        ):
            with pytest.raises(DetailScrapeError):
                asyncio.run(
                    run_setlist_detail_scrape(_SET_RESULT_ID, repo=repo)
                )
        repo.set_detail_running.assert_called_once()
        repo.set_detail_failed.assert_called_once_with(
            _SET_RESULT_ID, "Set detail scrape failed. Please try again."
        )

    def test_marks_failed_on_persistence_error(self):
        repo = _mock_repo(summary=_SUMMARY, tracks=[])
        repo.upsert_set_tracks.side_effect = Exception("DB unavailable")
        parsed_tracks = [_make_parsed_track(0)]

        from app.discovery.scrapers.tracklists1001.detail_parser import ParsedTracklistDetail
        detail = ParsedTracklistDetail(
            source_numeric_tracklist_id="1",
            title="T",
            canonical_url=_VALID_URL,
            declared_position_count=1,
            tracks=parsed_tracks,
            has_timed_cues=False,
        )
        with patch(
            "app.discovery.service.scrape_setlist_detail",
            new_callable=AsyncMock,
            return_value=detail,
        ):
            with pytest.raises(DetailScrapeError):
                asyncio.run(
                    run_setlist_detail_scrape(_SET_RESULT_ID, repo=repo)
                )
        repo.set_detail_failed.assert_called_once()

    # ── Refresh = True ────────────────────────────────────────────────────────

    def test_refresh_deletes_stale_rows(self):
        """On refresh=True, delete_stale_set_tracks must be called."""
        existing = [_make_track(0)]
        repo = _mock_repo(summary=_SUMMARY_COMPLETED, tracks=existing)

        # new parse has only pos1 — pos0 is now stale
        new_parsed = [_make_parsed_track(1)]
        from app.discovery.scrapers.tracklists1001.detail_parser import ParsedTracklistDetail
        detail = ParsedTracklistDetail(
            source_numeric_tracklist_id="1",
            title="T",
            canonical_url=_VALID_URL,
            declared_position_count=1,
            tracks=new_parsed,
            has_timed_cues=False,
        )

        repo.get_set_result_full.side_effect = [
            _SUMMARY_COMPLETED,
            _SUMMARY_COMPLETED,
        ]
        repo.get_set_tracks.side_effect = [
            existing,                # refresh bypasses cache check
            [_make_track(1)],        # final read
        ]
        # When refresh=True, cached tracks are present but we skip the cache
        # The service reads existing tracks first, then scrapes because refresh=True

        with patch(
            "app.discovery.service.scrape_setlist_detail",
            new_callable=AsyncMock,
            return_value=detail,
        ):
            result = asyncio.run(
                run_setlist_detail_scrape(_SET_RESULT_ID, refresh=True, repo=repo)
            )

        repo.delete_stale_set_tracks.assert_called_once_with(
            _SET_RESULT_ID, {"pos1"}
        )
        repo.upsert_set_tracks.assert_called_once()

    def test_refresh_no_duplicate_rows(self):
        """Upserting the same positions on repeat refresh must not duplicate rows."""
        existing = [_make_track(0), _make_track(1)]
        repo = _mock_repo(summary=_SUMMARY_COMPLETED, tracks=existing)

        parsed = [_make_parsed_track(0), _make_parsed_track(1)]
        from app.discovery.scrapers.tracklists1001.detail_parser import ParsedTracklistDetail
        detail = ParsedTracklistDetail(
            source_numeric_tracklist_id="1",
            title="T",
            canonical_url=_VALID_URL,
            declared_position_count=2,
            tracks=parsed,
            has_timed_cues=False,
        )

        repo.get_set_result_full.side_effect = [_SUMMARY_COMPLETED, _SUMMARY_COMPLETED]
        repo.get_set_tracks.side_effect = [existing, existing]

        with patch(
            "app.discovery.service.scrape_setlist_detail",
            new_callable=AsyncMock,
            return_value=detail,
        ):
            asyncio.run(
                run_setlist_detail_scrape(_SET_RESULT_ID, refresh=True, repo=repo)
            )

        # upsert called once with both rows (no separate insert per row)
        repo.upsert_set_tracks.assert_called_once()
        call_tracks = repo.upsert_set_tracks.call_args[0][1]
        assert len(call_tracks) == 2

    # ── Status lifecycle ──────────────────────────────────────────────────────

    def test_marks_running_before_scrape(self):
        repo = _mock_repo(summary=_SUMMARY, tracks=[])

        from app.discovery.scrapers.tracklists1001.detail_parser import ParsedTracklistDetail
        detail = ParsedTracklistDetail(
            source_numeric_tracklist_id="1",
            title="T",
            canonical_url=_VALID_URL,
            declared_position_count=0,
            tracks=[],
            has_timed_cues=False,
        )
        repo.get_set_result_full.return_value = _SUMMARY_COMPLETED
        repo.get_set_tracks.return_value = []

        call_order = []
        repo.set_detail_running.side_effect = lambda *a, **k: call_order.append("running")
        repo.upsert_set_tracks.side_effect = lambda *a, **k: call_order.append("upsert")

        with patch(
            "app.discovery.service.scrape_setlist_detail",
            new_callable=AsyncMock,
            return_value=detail,
        ):
            asyncio.run(
                run_setlist_detail_scrape(_SET_RESULT_ID, repo=repo)
            )

        assert call_order.index("running") < call_order.index("upsert")

    def test_marks_completed_after_successful_save(self):
        repo = _mock_repo(summary=_SUMMARY, tracks=[])
        parsed = [_make_parsed_track(0)]
        from app.discovery.scrapers.tracklists1001.detail_parser import ParsedTracklistDetail
        detail = ParsedTracklistDetail(
            source_numeric_tracklist_id="999",
            title="T",
            canonical_url=_VALID_URL,
            declared_position_count=1,
            tracks=parsed,
            has_timed_cues=False,
        )
        repo.get_set_result_full.return_value = _SUMMARY_COMPLETED
        repo.get_set_tracks.side_effect = [[], [_make_track(0)]]

        with patch(
            "app.discovery.service.scrape_setlist_detail",
            new_callable=AsyncMock,
            return_value=detail,
        ):
            asyncio.run(
                run_setlist_detail_scrape(_SET_RESULT_ID, repo=repo)
            )

        repo.set_detail_completed.assert_called_once()
        kwargs = repo.set_detail_completed.call_args[1]
        assert kwargs["parsed_track_count"] == 1
        assert kwargs["has_timed_cues"] is False
        assert kwargs["source_numeric_tracklist_id"] == "999"

    # ── Track correctness ─────────────────────────────────────────────────────

    def test_untimed_tracks_have_null_cue(self):
        """Tracks without visible cue time must have cue_seconds=None, not 0."""
        track = _make_track(0)
        assert track.cue_seconds is None
        assert track.cue_text is None

    def test_w_rows_have_played_with_previous_true(self):
        track = _make_track(1, w=True)
        assert track.played_with_previous is True
        assert track.track_number is None

    def test_track_ordering_via_sequence_index(self):
        tracks = [_make_track(2), _make_track(0), _make_track(1)]
        # Simulate what the repo returns (already ordered by DB)
        repo = _mock_repo(summary=_SUMMARY_COMPLETED, tracks=sorted(tracks, key=lambda t: t.sequence_index))
        result = get_setlist_tracks_response(_SET_RESULT_ID, repo=repo)
        indices = [t.sequence_index for t in result.tracks]
        assert indices == [0, 1, 2]


# ══════════════════════════════════════════════════════════════════════════════
# Regression: existing discovery endpoints still work
# ══════════════════════════════════════════════════════════════════════════════

class TestExistingEndpointsUnaffected:

    def test_artist_search_still_works(self):
        with patch("app.discovery.routes.DiscoveryRepository") as MockRepo:
            mock_instance = MockRepo.return_value
            mock_instance.search_artists.return_value = []
            resp = client.get(
                "/api/discovery/artists/search?q=illenium",
                headers=_auth(),
            )
        assert resp.status_code == 200

    def test_health_check_still_works(self):
        resp = client.get("/health")
        assert resp.status_code == 200
