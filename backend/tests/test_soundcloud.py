from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user_id
from app.discovery import soundcloud
from app.discovery.scrapers.soundcloud import browser_client
from app.discovery.scrapers.soundcloud.parser import parse_track_titles


# Minimal markup matching the live rendered SoundCloud search structure.
SEARCH_HTML = """
<div class="searchList"><ul>
  <li class="searchList__item"><div class="searchItem__trackItem">
    <a class="soundTitle__username" href="/illeniumofficial">ILLENIUM</a>
    <a class="soundTitle__title" href="/illeniumofficial/forever"><span>Forever &amp; Always</span></a>
  </div></li>
  <li class="searchList__item"><div class="searchItem__trackItem">
    <a class="soundTitle__title" href="/illeniumofficial/forever">Duplicate link</a>
  </div></li>
  <li class="searchList__item"><div class="searchItem__trackItem">
    <a class="soundTitle__title" href="/another-uploader/forever">Forever &amp; Always</a>
  </div></li>
  <li class="searchList__item"><div class="searchItem__trackItem">
    <a class="soundTitle__title" href="/illeniumofficial/say-it"> Flume - Say It <span>(Illenium Remix)</span> </a>
  </div></li>
</ul></div>
<a class="soundTitle__title" href="/unrelated/player">Player title outside search</a>
"""


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(soundcloud.router)
    app.dependency_overrides[get_current_user_id] = lambda: "user-id"
    return TestClient(app)


def test_parser_preserves_order_and_distinct_tracks_with_the_same_title():
    assert parse_track_titles(SEARCH_HTML) == [
        "Forever & Always", "Forever & Always", "Flume - Say It (Illenium Remix)",
    ]
    assert parse_track_titles(SEARCH_HTML, limit=1) == ["Forever & Always"]


def test_parser_ignores_missing_titles_and_unrelated_content():
    assert parse_track_titles('<a href="/artist/track">Not a search result</a>') == []
    assert parse_track_titles(SEARCH_HTML.replace('class="soundTitle__title"', 'class="other"')) == []


def test_fixed_search_returns_only_titles(client, monkeypatch):
    scrape = AsyncMock(return_value=["Forever", "In My Arms"])
    monkeypatch.setattr(soundcloud, "scrape_artist_track_titles", scrape)
    response = client.get("/api/discovery/soundcloud/illenium/tracks?q=another-artist")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == ["Forever", "In My Arms"]
    scrape.assert_awaited_once_with("ILLENIUM", limit=20)


def test_browser_errors_are_sanitized(client, monkeypatch):
    monkeypatch.setattr(soundcloud, "scrape_artist_track_titles", AsyncMock(side_effect=RuntimeError("internal details")))
    response = client.get("/api/discovery/soundcloud/illenium/tracks")
    assert response.status_code == 503
    assert "could not load" in response.json()["detail"]
    assert "internal details" not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("navigation_fails", [False, True])
async def test_browser_uses_public_search_and_closes_on_success_or_failure(monkeypatch, navigation_fails):
    page = MagicMock()
    page.goto = AsyncMock(return_value=SimpleNamespace(status=200))
    page.wait_for_selector = AsyncMock()
    page.content = AsyncMock(return_value=SEARCH_HTML)
    if navigation_fails:
        page.goto.side_effect = RuntimeError("navigation failed")
    context = SimpleNamespace(new_page=AsyncMock(return_value=page))
    browser = SimpleNamespace(new_context=AsyncMock(return_value=context), close=AsyncMock())
    pw = SimpleNamespace(chromium=SimpleNamespace(launch=AsyncMock(return_value=browser)))
    manager = MagicMock()
    manager.__aenter__ = AsyncMock(return_value=pw)
    manager.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(browser_client, "async_playwright", lambda: manager)

    if navigation_fails:
        with pytest.raises(RuntimeError, match="navigation failed"):
            await browser_client.scrape_artist_track_titles("ILLENIUM", limit=2)
    else:
        assert await browser_client.scrape_artist_track_titles("ILLENIUM", limit=2) == ["Forever & Always", "Forever & Always"]
        page.goto.assert_awaited_once_with(
            "https://soundcloud.com/search/sounds?q=ILLENIUM", wait_until="domcontentloaded",
        )
        page.wait_for_selector.assert_awaited_once_with(browser_client.S.TRACK_LINK)
    browser.close.assert_awaited_once()


def test_route_requires_dropdex_authentication():
    app = FastAPI()
    app.include_router(soundcloud.router)
    response = TestClient(app).get(
        "/api/discovery/soundcloud/illenium/tracks", headers={"Authorization": "invalid"},
    )
    assert response.status_code == 401

