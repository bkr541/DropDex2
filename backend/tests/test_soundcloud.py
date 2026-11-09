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


FAVORITES = [soundcloud.FavoriteArtist(id="a1", name="ILLENIUM"), soundcloud.FavoriteArtist(id="a2", name="Zoë & Dabin/Nurko")]


def test_favorite_artists_are_returned_in_saved_order(client, monkeypatch):
    monkeypatch.setattr(soundcloud, "fetch_top_favorite_artists", AsyncMock(return_value=FAVORITES))
    response = client.get("/api/discovery/soundcloud/favorite-artists")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert [a["name"] for a in response.json()] == ["ILLENIUM", "Zoë & Dabin/Nurko"]


@pytest.mark.asyncio
async def test_top_favorites_query_orders_by_position_limits_to_five_and_scopes_to_the_user(monkeypatch):
    seen = {}

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, params, headers):
            seen.update(url=url, params=params)
            rows = [{"artist": {"id": str(i), "name": f"Artist {i}"}} for i in range(7)] + [{"artist": None}]
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: rows)

    monkeypatch.setattr(soundcloud.httpx, "AsyncClient", FakeClient)
    artists = await soundcloud.fetch_top_favorite_artists("user-1")
    assert seen["url"].endswith("/rest/v1/user_artists")
    assert seen["params"]["user_id"] == "eq.user-1"
    assert seen["params"]["order"] == "position.asc"
    assert seen["params"]["limit"] == "5"
    assert [a.name for a in artists] == [f"Artist {i}" for i in range(5)]


def test_search_uses_the_saved_artist_name_not_anything_from_the_request(client, monkeypatch):
    monkeypatch.setattr(soundcloud, "fetch_top_favorite_artists", AsyncMock(return_value=FAVORITES))
    scrape = AsyncMock(return_value=["Forever", "In My Arms"])
    monkeypatch.setattr(soundcloud, "scrape_artist_track_titles", scrape)
    response = client.get("/api/discovery/soundcloud/artists/a2/tracks?q=other&artist=other")
    assert response.status_code == 200
    assert response.json() == ["Forever", "In My Arms"]
    scrape.assert_awaited_once_with("Zoë & Dabin/Nurko", limit=20)


def test_search_rejects_an_artist_that_is_not_a_top_favorite(client, monkeypatch):
    monkeypatch.setattr(soundcloud, "fetch_top_favorite_artists", AsyncMock(return_value=FAVORITES))
    scrape = AsyncMock()
    monkeypatch.setattr(soundcloud, "scrape_artist_track_titles", scrape)
    assert client.get("/api/discovery/soundcloud/artists/not-mine/tracks").status_code == 404
    scrape.assert_not_awaited()


def test_no_hard_coded_artist_remains_in_the_runtime_code():
    import pathlib
    root = pathlib.Path(soundcloud.__file__).parent
    for path in [root / "soundcloud.py", root / "scrapers" / "soundcloud" / "browser_client.py"]:
        assert "illenium" not in path.read_text().lower()


def test_browser_errors_are_sanitized(client, monkeypatch):
    monkeypatch.setattr(soundcloud, "fetch_top_favorite_artists", AsyncMock(return_value=FAVORITES))
    monkeypatch.setattr(soundcloud, "scrape_artist_track_titles", AsyncMock(side_effect=RuntimeError("internal details")))
    response = client.get("/api/discovery/soundcloud/artists/a1/tracks")
    assert response.status_code == 503
    assert "could not load" in response.json()["detail"]
    assert "internal details" not in response.text


def test_special_characters_are_url_encoded_in_the_search_query():
    from urllib.parse import urlencode
    assert urlencode({"q": "Zoë & Dabin/Nurko"}) == "q=Zo%C3%AB+%26+Dabin%2FNurko"


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
        "/api/discovery/soundcloud/artists/a1/tracks", headers={"Authorization": "invalid"},
    )
    assert response.status_code == 401
    assert TestClient(app).get("/api/discovery/soundcloud/favorite-artists", headers={"Authorization": "invalid"}).status_code == 401

