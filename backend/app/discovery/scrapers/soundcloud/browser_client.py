"""Render SoundCloud search with Playwright, then parse the HTML with Selectolax."""

from urllib.parse import urlencode

from playwright.async_api import TimeoutError as PWTimeoutError, async_playwright

from app.config import settings

from . import selectors as S
from .parser import parse_track_titles


async def scrape_artist_track_titles(artist_name: str, *, limit: int = 20) -> list[str]:
    """Use an ordinary browser session; no SoundCloud API credentials or cookies."""
    limit = min(max(limit, 1), 20)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=settings.tracklists_scraper_headless)
        try:
            context = await browser.new_context()
            page = await context.new_page()
            page.set_default_timeout(settings.tracklists_scraper_navigation_timeout_ms)
            response = await page.goto(
                f"{S.SEARCH_URL}?{urlencode({'q': artist_name})}",
                wait_until="domcontentloaded",
            )
            if response is not None and response.status >= 400:
                raise RuntimeError(f"SoundCloud search returned HTTP {response.status}")
            await page.wait_for_selector(S.TRACK_LINK)

            # Search initially renders 10 tracks. Scroll the list to request
            # more through the site's own UI, keeping the MVP bounded.
            for _ in range(3):
                titles = parse_track_titles(await page.content(), limit=limit)
                if len(titles) >= limit:
                    return titles
                count = await page.locator(S.TRACK_LINK).count()
                await page.locator(S.RESULT_ITEM).last.scroll_into_view_if_needed()
                try:
                    await page.wait_for_function(
                        "({selector, count}) => document.querySelectorAll(selector).length > count",
                        arg={"selector": S.TRACK_LINK, "count": count},
                        timeout=5_000,
                    )
                except PWTimeoutError:
                    break

            titles = parse_track_titles(await page.content(), limit=limit)
            if not titles:
                raise RuntimeError("SoundCloud search did not contain parseable track titles")
            return titles
        finally:
            await browser.close()
