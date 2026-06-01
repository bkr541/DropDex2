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
import hashlib
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable, Optional
from urllib.parse import urlparse

from playwright.async_api import Page, TimeoutError as PWTimeoutError, async_playwright
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import settings
from app.discovery.scrapers.tracklists1001 import selectors as S
from app.discovery.scrapers.tracklists1001.detail_parser import ParsedTracklistDetail, parse_tracklist_detail
from app.discovery.scrapers.tracklists1001.detail_selectors import (
    DIAGNOSTIC_SELECTORS as _DIAGNOSTIC_SELECTORS,
    TRACK_ROW as _DETAIL_TRACK_ROW,
)
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


# ── Pagination transition helper ──────────────────────────────────────────────

async def _poll_for_card_change(
    get_first_card_id: Callable[[], Awaitable[Optional[str]]],
    stale_id: str,
    *,
    timeout_ms: int,
    poll_interval_ms: int = 200,
) -> bool:
    """
    Poll ``get_first_card_id`` until it returns an ID that differs from
    ``stale_id``, confirming the result DOM has transitioned to a new page.

    Returning ``None`` from ``get_first_card_id`` means no cards are visible
    yet (mid-transition); we keep waiting.

    Returns ``True`` when a new card ID is observed; ``False`` when
    ``timeout_ms`` expires without the ID changing.

    This function is intentionally free of Playwright imports so it can be
    tested with plain async callables.
    """
    deadline = time.monotonic() + timeout_ms / 1000
    while True:
        current_id = await get_first_card_id()
        if current_id is not None and current_id != stale_id:
            return True
        if time.monotonic() >= deadline:
            return False
        await asyncio.sleep(poll_interval_ms / 1000)


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

    The 1001Tracklists search page uses a JavaScript ``submitForm()`` call for
    pagination.  After the click the existing result cards remain in the DOM
    while the XHR response arrives and the JS re-renders the list.
    ``wait_for_selector(S.CARD)`` alone is therefore unsafe: it resolves
    immediately against the *old* cards, causing the scraper to capture stale
    page-1 content as page 2.

    Fix: capture the first card's ``data-id`` before clicking, then poll via
    ``_poll_for_card_change`` until that ID is replaced by a new value.  If the
    DOM does not transition within ``timeout_ms``, a ``PWTimeoutError`` is
    raised so the tenacity decorator can retry the full click + wait sequence
    once before giving up.
    """
    await asyncio.sleep(delay_ms / 1000)

    next_li = page.locator("ul.pagination.bs li").filter(has_text="Next").first
    if not await next_li.count():
        return None

    classes = (await next_li.get_attribute("class")) or ""
    if "disabled" in classes:
        return None

    # Snapshot the first result card's ID before triggering navigation.
    stale_id: Optional[str] = None
    first_card = page.locator(S.CARD).first
    if await first_card.count() > 0:
        stale_id = await first_card.get_attribute("data-id")
        log.debug("[1001tl] pre-click first card id=%r", stale_id)

    await next_li.click()
    await page.wait_for_load_state("networkidle", timeout=timeout_ms)

    if stale_id:
        # Poll until the first visible card has a different data-id, confirming
        # that page 2's content has replaced page 1's content in the DOM.
        async def _get_first_id() -> Optional[str]:
            c = page.locator(S.CARD).first
            if not await c.count():
                return None
            return await c.get_attribute("data-id")

        changed = await _poll_for_card_change(
            _get_first_id,
            stale_id,
            timeout_ms=timeout_ms,
        )
        if not changed:
            log.warning(
                "[1001tl] DOM transition timed out: first card still %r after "
                "%d ms — raising PWTimeoutError for tenacity retry.",
                stale_id,
                timeout_ms,
            )
            raise PWTimeoutError(
                f"Next-page DOM did not transition away from stale card '{stale_id}'"
            )
        log.debug("[1001tl] DOM transitioned away from stale card %r", stale_id)
    else:
        # No pre-existing cards (unusual) — fall back to waiting for any card.
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
            sample_parsed = [r.source_tracklist_id for r in parsed.results[:5]]
            sample_seen   = sorted(seen_ids)[:5]
            log.warning(
                "[1001tl] page=%d zero new IDs — probable stale-page read. "
                "url=%r page_card_count=%d sample_parsed_ids=%s "
                "sample_seen_ids=%s has_next=%s reported_total=%s "
                "collected_so_far=%d. Stopping pagination to avoid loop.",
                page_num,
                current_page.url,
                len(parsed.results),
                sample_parsed,
                sample_seen,
                parsed.has_next_page,
                reported_total,
                len(all_results),
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

# Resource types that serve no purpose for HTML parsing and may stall page load.
_BLOCKED_RESOURCE_TYPES: frozenset[str] = frozenset({"image", "media", "font"})

# Ad/analytics/tracker host fragments to block.  Matched as substrings of the
# request URL so partial domain matches work (e.g. "doubleclick" matches
# "stats.g.doubleclick.net").
_BLOCKED_AD_HOSTS: tuple[str, ...] = (
    "pub.network",
    "btloader",
    "amazon-adsystem",
    "googletagmanager",
    "google-analytics",
    "doubleclick",
    "googlesyndication",
    "confiant",
    "quantserve",
    "scorecardresearch",
    "facebook.com",
    "twitter.com",
    "tiktok.com",
    "adsystem",
    "adservice",
    "freestar",
    "yieldmo",
    "criteo",
    "taboola",
    "outbrain",
)


async def _block_nonessential_resources(route) -> None:
    """
    Playwright route handler that aborts ad/analytics/media requests before they
    are sent.  Called via ``page.route("**/*", _block_nonessential_resources)``
    before the first navigation so blocked requests never leave the machine.

    Aborted requests cannot stall the page-load pipeline, which is the most
    common reason detail scrapes time out (one slow ad CDN holds up the whole
    page-load event for 30+ seconds).
    """
    request = route.request
    url = request.url.lower()

    if request.resource_type in _BLOCKED_RESOURCE_TYPES:
        await route.abort()
        return

    if any(host in url for host in _BLOCKED_AD_HOSTS):
        await route.abort()
        return

    await route.continue_()


# Body-text and HTML fragments that identify a bot-challenge, forwarding, or
# block page served instead of the real setlist HTML.
# Checked against BOTH inner_text() and raw HTML source; some signals
# (e.g. "cf-turnstile-response") only appear in hidden inputs and are never
# included in visible body text.
_CHALLENGE_SIGNALS: list[str] = [
    "please wait, you will be forwarded to the requested page",
    "forwarded to the requested page",
    "cf-turnstile-response",
    "turnstile-container",
    "captcha",
    "verify you are human",
    "checking your browser",
    "cloudflare",
    "access denied",
    "enable javascript",
    "unusual traffic",
    "blocked",
    "forbidden",
    "rate limit",
    "robot",
]


def _detect_challenge_page(body_text: str, html: str) -> tuple[bool, list[str]]:
    """
    Return ``(is_challenge, matched_signals)`` by checking BOTH the visible body
    text and the raw HTML source.  Checking both is necessary because markers
    like ``cf-turnstile-response`` and ``turnstile-container`` live in hidden
    ``<input>`` elements that do not appear in ``inner_text()`` output.
    """
    combined = f"{body_text}\n{html}".lower()
    hits = [signal for signal in _CHALLENGE_SIGNALS if signal in combined]
    return bool(hits), hits


class TracklistChallengeError(Exception):
    """
    Raised when 1001Tracklists serves a Cloudflare Turnstile or forwarding
    interstitial instead of the setlist detail HTML, making track rows
    inaccessible to the scraper.
    """


# Debug output directory: <repo>/backend/tmp/debug-setlists/
_DEBUG_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent / "tmp" / "debug-setlists"


def _emit_debug_files(
    *,
    debug_id: Optional[str],
    source_url: str,
    final_url: str,
    page_title: Optional[str],
    html: str,
    screenshot_bytes: Optional[bytes],
    selector_counts: dict[str, int],
    challenge_detected: bool,
    challenge_signals: list[str],
    body_text_preview: str,
    parsed_track_count: int,
    response_status: Optional[int],
    tl_pos_count_value: Optional[str],
    error: Optional[str],
) -> None:
    """
    Write debug artefacts (HTML, screenshot, JSON metadata) to _DEBUG_DIR so a
    developer can inspect the exact page state when the scraper finds zero tracks.
    """
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    if debug_id:
        file_stem = debug_id
    else:
        url_hash = hashlib.sha1(source_url.encode()).hexdigest()[:8]
        file_stem = f"{ts}_{url_hash}"

    try:
        _DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        log.warning("[1001tl-detail] Could not create debug dir %s: %s", _DEBUG_DIR, exc)
        return

    html_path = _DEBUG_DIR / f"{file_stem}.html"
    png_path  = _DEBUG_DIR / f"{file_stem}.png"
    json_path = _DEBUG_DIR / f"{file_stem}.json"

    try:
        html_path.write_text(html, encoding="utf-8")
    except Exception as exc:
        log.warning("[1001tl-detail] Could not write debug HTML: %s", exc)

    if screenshot_bytes:
        try:
            png_path.write_bytes(screenshot_bytes)
        except Exception as exc:
            log.warning("[1001tl-detail] Could not write debug screenshot: %s", exc)

    metadata = {
        "source_url":          source_url,
        "final_url":           final_url,
        "page_title":          page_title,
        "response_status":     response_status,
        "tl_pos_count":        tl_pos_count_value,
        "attempted_selectors": selector_counts,
        "challenge_detected":  challenge_detected,
        "challenge_signals":   challenge_signals,
        "body_text_preview":   body_text_preview,
        "parsed_track_count":  parsed_track_count,
        "timestamp":           ts,
        "error":               error,
    }
    try:
        json_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    except Exception as exc:
        log.warning("[1001tl-detail] Could not write debug JSON: %s", exc)

    log.warning(
        "[1001tl-detail] zero rows detected\n"
        "  source_url=%s\n"
        "  final_url=%s\n"
        "  page_title=%r\n"
        "  response_status=%s\n"
        "  tl_pos_count=%s\n"
        "  selector_counts=%s\n"
        "  challenge_detected=%s  challenge_signals=%s\n"
        "  body_text_preview=%r\n"
        "  debug_html=%s\n"
        "  debug_screenshot=%s\n"
        "  debug_json=%s",
        source_url, final_url, page_title,
        response_status,
        tl_pos_count_value,
        selector_counts,
        challenge_detected, challenge_signals,
        body_text_preview[:500],
        html_path,
        png_path if screenshot_bytes else "(none)",
        json_path,
    )
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


async def scrape_setlist_detail(
    source_url: str,
    debug_id: Optional[str] = None,
) -> ParsedTracklistDetail:
    """
    Navigate to a single 1001Tracklists setlist detail page with Playwright,
    wait for the track rows to render, extract the full HTML and parse it.

    Navigation strategy
    -------------------
    1. Block ads/analytics/media before the first request so stalled CDN
       resources cannot hold up the page-load pipeline.
    2. Navigate with ``domcontentloaded`` — the track rows are server-rendered
       HTML and present as soon as the document arrives.  Waiting for ``load``
       can take 30+ seconds because 1001TL loads many ad/analytics scripts.
    3. Immediately check for the Cloudflare Turnstile / forwarding-page
       interstitial (visible text "forwarded to the requested page").  If found,
       submit the bypass form; the form already contains the ``bChk`` token
       computed by Cloudflare's own JS, which is often accepted server-side
       without the Turnstile token.
    4. Wait briefly for networkidle (3 s grace); ignore timeout.
    5. Wait for ``.tlpItem`` with a targeted timeout.  If not found, scroll and
       retry before giving up.
    6. Collect diagnostics and screenshot inside the Playwright context so debug
       artefacts can be written to disk after parsing if zero tracks are found.

    Parameters
    ----------
    source_url:
        The stored ``artist_set_results.source_url`` value.  Must already have
        passed ``validate_setlist_url``; callers should validate before calling
        this function.
    debug_id:
        Optional identifier (e.g. set_result_id UUID) used as the filename stem
        for debug artefacts written to backend/tmp/debug-setlists/ when zero
        tracks are found.  When omitted a timestamp+URL-hash is used instead.

    Returns
    -------
    ParsedTracklistDetail from the detail parser.

    Raises
    ------
    ValueError
        When the URL fails validation (callers should treat this as a 400).
    PWTimeoutError
        When initial page navigation fails within the configured timeout.
    """
    validate_setlist_url(source_url)

    # Variables captured inside the Playwright context; used for debug output
    # after the browser is closed.
    html = ""
    screenshot_bytes: Optional[bytes] = None
    final_url = source_url
    page_title: Optional[str] = None
    selector_found = False
    challenge_detected = False
    challenge_signals: list[str] = []
    selector_counts: dict[str, int] = {}
    body_text_preview = ""
    response_status: Optional[int] = None
    tl_pos_count_value: Optional[str] = None

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=settings.tracklists_scraper_headless,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/130.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
            locale="en-US",
        )
        # Suppress navigator.webdriver so Cloudflare does not classify this
        # request as a headless bot during its JS-level fingerprinting check.
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        page = await context.new_page()
        page.set_default_timeout(settings.tracklists_scraper_navigation_timeout_ms)

        # ── Step 1: Block ads/analytics/media before the first request ─────────
        await page.route("**/*", _block_nonessential_resources)

        try:
            log.info("[1001tl-detail] Navigating to %s", source_url)
            response = await page.goto(
                source_url,
                wait_until="domcontentloaded",
                timeout=settings.tracklists_detail_nav_timeout_ms,
            )
            if response is not None:
                response_status = response.status

            # ── Step 2: Early challenge detection ──────────────────────────────
            # Run immediately after domcontentloaded — before waiting 20 s for
            # .tlpItem.  Checks BOTH visible body text and raw HTML so that
            # hidden-input markers (cf-turnstile-response, turnstile-container)
            # are caught even when they are absent from inner_text() output.
            try:
                body_text = await page.inner_text("body")
                body_text_preview = body_text[:1000]
            except Exception:
                body_text = ""
                body_text_preview = ""

            early_html = await page.content()
            challenge_detected, challenge_signals = _detect_challenge_page(body_text, early_html)

            if challenge_detected:
                log.warning(
                    "[1001tl-detail] Challenge/interstitial page detected at %s; "
                    "signals=%s; failing fast",
                    source_url,
                    challenge_signals,
                )
                # Collect diagnostics and fail immediately.  Submitting the
                # Turnstile form without a valid token is unreliable and not
                # attempted here.  Use the manual HTML import fallback instead.
                final_url = page.url
                try:
                    page_title = await page.title()
                except Exception:
                    pass
                try:
                    pos_input = page.locator('input[name="tl_pos_count"]')
                    if await pos_input.count() > 0:
                        tl_pos_count_value = await pos_input.get_attribute("value")
                except Exception:
                    pass
                for sel in _DIAGNOSTIC_SELECTORS:
                    try:
                        selector_counts[sel] = await page.locator(sel).count()
                    except Exception:
                        selector_counts[sel] = -1
                try:
                    screenshot_bytes = await page.screenshot(full_page=False)
                except Exception as exc:
                    log.debug("[1001tl-detail] Screenshot failed: %s", exc)
                html = await page.content()

                _emit_debug_files(
                    debug_id=debug_id,
                    source_url=source_url,
                    final_url=final_url,
                    page_title=page_title,
                    html=html,
                    screenshot_bytes=screenshot_bytes,
                    selector_counts=selector_counts,
                    challenge_detected=True,
                    challenge_signals=challenge_signals,
                    body_text_preview=body_text_preview,
                    parsed_track_count=0,
                    response_status=response_status,
                    tl_pos_count_value=tl_pos_count_value,
                    error="Challenge page — track rows not accessible",
                )
                raise TracklistChallengeError(
                    "1001Tracklists returned a challenge/forwarding page instead of "
                    "the setlist detail HTML. Track rows were not accessible to the "
                    "scraper. Try again later or open the source page manually."
                )

            # ── Step 3: Normal flow (no challenge) ────────────────────────────
            # Brief networkidle grace — ad/analytics scripts keep the network busy;
            # treat timeout as normal and proceed to the selector wait.
            try:
                await page.wait_for_load_state(
                    "networkidle",
                    timeout=settings.tracklists_detail_network_idle_timeout_ms,
                )
            except PWTimeoutError:
                log.debug(
                    "[1001tl-detail] networkidle timed out after %d ms; "
                    "proceeding to selector wait",
                    settings.tracklists_detail_network_idle_timeout_ms,
                )

            # ── Step 4: Wait for track rows ────────────────────────────────────
            if not selector_found:
                try:
                    await page.wait_for_selector(
                        _DETAIL_TRACK_ROW,
                        timeout=settings.tracklists_detail_selector_timeout_ms,
                    )
                    selector_found = True
                except PWTimeoutError:
                    log.debug(
                        "[1001tl-detail] .tlpItem not found within %d ms; "
                        "trying scroll fallback",
                        settings.tracklists_detail_selector_timeout_ms,
                    )
                    # Scroll to trigger any lazy-rendered track rows, then recheck.
                    await page.wait_for_timeout(750)
                    await page.mouse.wheel(0, 1200)
                    await page.wait_for_timeout(750)
                    tlp_count = await page.locator(_DETAIL_TRACK_ROW).count()
                    if tlp_count == 0:
                        await page.mouse.wheel(0, 2400)
                        await page.wait_for_timeout(750)
                        tlp_count = await page.locator(_DETAIL_TRACK_ROW).count()
                    if tlp_count > 0:
                        selector_found = True
                    else:
                        log.warning(
                            "[1001tl-detail] .tlpItem still absent after scroll at %s; "
                            "capturing debug artefacts",
                            source_url,
                        )

            # ── Step 5: Collect diagnostics ────────────────────────────────────
            final_url = page.url
            try:
                page_title = await page.title()
            except Exception:
                pass
            try:
                pos_input = page.locator('input[name="tl_pos_count"]')
                if await pos_input.count() > 0:
                    tl_pos_count_value = await pos_input.get_attribute("value")
            except Exception:
                pass
            for sel in _DIAGNOSTIC_SELECTORS:
                try:
                    selector_counts[sel] = await page.locator(sel).count()
                except Exception:
                    selector_counts[sel] = -1

            # Re-run challenge detection on the final page state so the debug
            # JSON accurately reflects whether a challenge page is present after
            # all navigation attempts.  Checks both body text and raw HTML.
            try:
                body_text_final = await page.inner_text("body")
                body_text_preview = body_text_final[:1000]
            except Exception:
                body_text_final = body_text
            html = await page.content()
            challenge_detected, challenge_signals = _detect_challenge_page(body_text_final, html)

            try:
                screenshot_bytes = await page.screenshot(full_page=False)
            except Exception as exc:
                log.debug("[1001tl-detail] Screenshot failed: %s", exc)

        finally:
            await browser.close()

    detail = parse_tracklist_detail(html)
    log.info(
        "[1001tl-detail] Parsed %d tracks from %s "
        "(timed_cues=%s selector_found=%s status=%s tl_pos_count=%s)",
        len(detail.tracks),
        source_url,
        detail.has_timed_cues,
        selector_found,
        response_status,
        tl_pos_count_value,
    )

    if not detail.tracks:
        _emit_debug_files(
            debug_id=debug_id,
            source_url=source_url,
            final_url=final_url,
            page_title=page_title,
            html=html,
            screenshot_bytes=screenshot_bytes,
            selector_counts=selector_counts,
            challenge_detected=challenge_detected,
            challenge_signals=challenge_signals,
            body_text_preview=body_text_preview,
            parsed_track_count=0,
            response_status=response_status,
            tl_pos_count_value=tl_pos_count_value,
            error=None,
        )

    return detail
