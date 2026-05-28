"""
Playwright-based browser scraper for 1001Tracklists artist search results.

Search flow
-----------
1. Navigate to https://www.1001tracklists.com/search/result.php
2. Fill ``main_search`` with the supplied canonical artist name.
3. Set ``search_selection`` to "9" (Tracklists).
4. Attempt to set the sort-order field to "p" (performance/set date); silently
   skip if the control is absent.
5. Submit via Enter; wait for networkidle + result cards to appear.
6. Extract full page HTML → pass to the existing HTML parser.
7. Repeat for subsequent pages by clicking the enabled Next pagination button
   and waiting for networkidle.
8. Stop when: Next is disabled, get_next returns None, no new IDs arrive,
   max_pages is reached, or a navigation exception occurs.
9. Close browser cleanly on both success and failure.

No hardcoded ``acc`` token.  No captured cookies.  No direct AJAX URL
construction.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional
from urllib.parse import urlparse

from playwright.async_api import Page, TimeoutError as PWTimeoutError, async_playwright
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import settings
from app.discovery.scrapers.tracklists1001 import selectors as S
from app.discovery.scrapers.tracklists1001.detail_parser import ParsedTracklistDetail, parse_tracklist_detail
from app.discovery.scrapers.tracklists1001.detail_selectors import TRACK_ROW as _DETAIL_TRACK_ROW
from app.discovery.scrapers.tracklists1001.models import ArtistSetlistScrapeResult, PageScrapeAudit
from app.discovery.scrapers.tracklists1001.parser import ParsedSetlistResult, parse_result_page

log = logging.getLogger(__name__)

_SEARCH_URL  = "https://www.1001tracklists.com/search/result.php"
_SORT_FIELD  = "sf"
_SORT_PERF   = "p"   # sort by set / performance date


# ── Internal page-data carrier ────────────────────────────────────────────────

@dataclass
class _RawPage:
    """Minimal container holding rendered page HTML and its URL."""
    html: str
    url: str = ""


# ── Public entry point ────────────────────────────────────────────────────────

async def scrape_artist_setlists(
    artist_name: str,
    *,
    max_pages: Optional[int] = None,
) -> ArtistSetlistScrapeResult:
    """
    Submit a Tracklists search on 1001Tracklists and paginate through results.

    Parameters
    ----------
    artist_name:
        Canonical display name from trusted backend data (e.g. "ILLENIUM").
        Must not originate from raw, unvalidated frontend input.
    max_pages:
        Optional caller-supplied ceiling.  Always capped by
        ``settings.tracklists_scraper_max_pages``.
    """
    effective_max = min(
        max_pages if max_pages is not None else settings.tracklists_scraper_max_pages,
        settings.tracklists_scraper_max_pages,
    )

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=settings.tracklists_scraper_headless)
        context = await browser.new_context()
        page    = await context.new_page()
        page.set_default_timeout(settings.tracklists_scraper_navigation_timeout_ms)
        try:
            first_page = await _load_first_page(page, artist_name)

            async def _get_next(page_num: int) -> Optional[_RawPage]:  # noqa: ARG001
                # page_num unused — browser state is the source of truth.
                return await _navigate_next_page(
                    page,
                    delay_ms=settings.tracklists_scraper_delay_ms,
                    timeout_ms=settings.tracklists_scraper_navigation_timeout_ms,
                )

            results, total, audits = await _paginate_results(
                first_page, _get_next, effective_max
            )
        finally:
            await browser.close()

    return ArtistSetlistScrapeResult(
        artist_name=artist_name,
        source=S.SOURCE_NAME,
        reported_total_results=total,
        pages_scraped=len(audits),
        results_found=len(results),
        results=results,
        page_audit=audits,
    )


# ── Browser navigation helpers ────────────────────────────────────────────────

async def _load_first_page(page: Page, artist_name: str) -> _RawPage:
    """Navigate to the search form, fill it, submit, and return rendered HTML."""
    await page.goto(_SEARCH_URL, wait_until="domcontentloaded")
    await page.fill('input[name="main_search"]', artist_name)
    await page.select_option('select[name="search_selection"]', "9")

    # Sort by performance date when the control is available; ignore otherwise.
    try:
        await page.select_option(
            f'select[name="{_SORT_FIELD}"]', _SORT_PERF, timeout=3_000
        )
    except Exception:
        log.debug("Sort-order control absent or not selectable; using default")

    # Enter-key submit is the most reliable trigger regardless of form encoding.
    await page.press('input[name="main_search"]', "Enter")
    await page.wait_for_load_state("networkidle")
    await page.wait_for_selector(
        S.CARD, timeout=settings.tracklists_scraper_navigation_timeout_ms
    )
    return _RawPage(html=await page.content(), url=page.url)


@retry(
    stop=stop_after_attempt(2),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    retry=retry_if_exception_type(PWTimeoutError),
    reraise=True,
)
async def _navigate_next_page(
    page: Page,
    *,
    delay_ms: int,
    timeout_ms: int,
) -> Optional[_RawPage]:
    """
    Click the enabled Next pagination button and return the refreshed page HTML.

    Returns ``None`` when no enabled Next button is present (caller stops).
    Retries once on ``PWTimeoutError`` via the tenacity decorator; the retry is
    safe because a timeout here means the DOM did not update — the browser
    state is unchanged and clicking Next again is correct.
    """
    await asyncio.sleep(delay_ms / 1000)

    next_li = page.locator("ul.pagination.bs li").filter(has_text="Next").first
    if not await next_li.count():
        return None

    classes = (await next_li.get_attribute("class")) or ""
    if "disabled" in classes:
        return None

    await next_li.click()
    await page.wait_for_load_state("networkidle", timeout=timeout_ms)
    await page.wait_for_selector(S.CARD, timeout=timeout_ms)
    return _RawPage(html=await page.content(), url=page.url)


# ── Core pagination loop (testable without Playwright) ───────────────────────

async def _paginate_results(
    first_page: _RawPage,
    get_next: Callable[[int], Awaitable[Optional[_RawPage]]],
    max_pages: int,
) -> tuple[list[ParsedSetlistResult], Optional[int], list[PageScrapeAudit]]:
    """
    Parse pages and accumulate deduplicated results.

    This function has no Playwright imports and is fully testable by passing a
    fake ``get_next`` callable that returns pre-built ``_RawPage`` objects.

    ``get_next(page_num)`` is called for pages 2, 3, … in sequence.
    - Returns ``None``  → stop (navigation exhausted).
    - Raises an exception → stop with a warning; partial results are returned.
    """
    seen_ids: set[str] = set()
    all_results: list[ParsedSetlistResult] = []
    audits: list[PageScrapeAudit] = []
    reported_total: Optional[int] = None

    current_page = first_page
    page_num     = 1

    while True:
        parsed = parse_result_page(current_page.html)

        if reported_total is None and parsed.reported_total_results is not None:
            reported_total = parsed.reported_total_results

        new_results = [
            r for r in parsed.results
            if r.source_tracklist_id not in seen_ids
        ]
        for r in new_results:
            seen_ids.add(r.source_tracklist_id)
            all_results.append(r)

        audits.append(PageScrapeAudit(
            page_number=page_num,
            url=current_page.url,
            cards_parsed=len(new_results),
            has_next_page=parsed.has_next_page,
        ))

        log.info(
            "[1001tl] page=%d new=%d total_collected=%d has_next=%s",
            page_num, len(new_results), len(all_results), parsed.has_next_page,
        )

        # ── Stop conditions ───────────────────────────────────────────────────
        if not parsed.has_next_page:
            break
        if not new_results:
            log.warning(
                "[1001tl] Page %d yielded no new IDs; stopping to avoid loop",
                page_num,
            )
            break
        if page_num >= max_pages:
            log.info("[1001tl] max_pages=%d reached; stopping", max_pages)
            break

        # ── Advance to next page ──────────────────────────────────────────────
        page_num += 1
        try:
            next_raw = await get_next(page_num)
        except Exception as exc:
            log.warning(
                "[1001tl] Navigation to page %d failed (%s); returning partial results",
                page_num, exc,
            )
            break

        if next_raw is None:
            log.info("[1001tl] get_next returned None for page %d; stopping", page_num)
            break

        current_page = next_raw

    return all_results, reported_total, audits


# ── Setlist detail scraper ────────────────────────────────────────────────────

_ALLOWED_HOST   = "www.1001tracklists.com"
_REQUIRED_SCHEME = "https"
_REQUIRED_PATH_PREFIX = "/tracklist/"


def validate_setlist_url(url: str) -> None:
    """
    Confirm the URL is a safe 1001Tracklists setlist page before navigating.

    Raises ValueError with a descriptive reason string on any violation so the
    caller can surface a clean 400 response without leaking internal detail.

    Accepted form:
      https://www.1001tracklists.com/tracklist/<slug>/<name>.html
    """
    try:
        parts = urlparse(url)
    except Exception as exc:
        raise ValueError(f"Unparseable URL: {exc}") from exc

    if parts.scheme != _REQUIRED_SCHEME:
        raise ValueError(
            f"Setlist URL must use HTTPS (got scheme '{parts.scheme}')"
        )
    if parts.netloc != _ALLOWED_HOST:
        raise ValueError(
            f"Setlist URL must point to {_ALLOWED_HOST} (got '{parts.netloc}')"
        )
    if not parts.path.startswith(_REQUIRED_PATH_PREFIX):
        raise ValueError(
            f"Setlist URL path must start with '{_REQUIRED_PATH_PREFIX}' "
            f"(got '{parts.path}')"
        )


async def scrape_setlist_detail(source_url: str) -> ParsedTracklistDetail:
    """
    Navigate to a single 1001Tracklists setlist detail page with Playwright,
    wait for the track rows to render, extract the full HTML and parse it.

    Parameters
    ----------
    source_url:
        The stored ``artist_set_results.source_url`` value.  Must already have
        passed ``validate_setlist_url``; callers should validate before calling
        this function.

    Returns
    -------
    ParsedTracklistDetail from the detail parser.

    Raises
    ------
    ValueError
        When the URL fails validation (callers should treat this as a 400).
    PWTimeoutError
        When the page fails to load or track rows never appear within the
        configured timeout.
    """
    validate_setlist_url(source_url)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=settings.tracklists_scraper_headless)
        context = await browser.new_context()
        page = await context.new_page()
        page.set_default_timeout(settings.tracklists_scraper_navigation_timeout_ms)
        try:
            log.info("[1001tl-detail] Navigating to %s", source_url)
            await page.goto(source_url, wait_until="domcontentloaded")
            await page.wait_for_load_state("networkidle")

            # Wait for at least one track row to appear.  If none appear within
            # the timeout, the page may be private, removed, or structure-changed.
            try:
                await page.wait_for_selector(
                    _DETAIL_TRACK_ROW,
                    timeout=settings.tracklists_scraper_navigation_timeout_ms,
                )
            except PWTimeoutError:
                log.warning(
                    "[1001tl-detail] No track rows found at %s within timeout; "
                    "parsing anyway (may return empty list)",
                    source_url,
                )

            html = await page.content()
        finally:
            await browser.close()

    detail = parse_tracklist_detail(html)
    log.info(
        "[1001tl-detail] Parsed %d tracks from %s (timed_cues=%s)",
        len(detail.tracks),
        source_url,
        detail.has_timed_cues,
    )
    return detail
