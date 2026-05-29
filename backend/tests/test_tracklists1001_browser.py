"""
Tests for the 1001Tracklists browser scraper — pagination loop and deduplication.

All tests are fully offline: no Playwright browser is launched.  The tests
exercise ``_paginate_results`` directly by supplying a fake ``get_next``
callable, keeping Playwright as a pure integration concern.

The ``_RawPage`` internal carrier and ``_paginate_results`` are imported from
``browser_client`` — their underscore prefix marks them as implementation
details, but testing them directly is the right trade-off for covering the
loop logic without a live browser.
"""

from __future__ import annotations

import asyncio
import pathlib
from typing import Optional

import pytest

from app.discovery.scrapers.tracklists1001.browser_client import (
    _RawPage,
    _paginate_results,
    _poll_for_card_change,
)
from app.discovery.scrapers.tracklists1001.models import PageScrapeAudit


# ── Synthetic HTML builder ────────────────────────────────────────────────────

def _make_html(
    card_ids: list[str],
    *,
    has_next: bool = False,
    total: Optional[int] = None,
) -> str:
    """Build minimal valid search-result HTML understood by the existing parser."""
    cards = "\n".join(
        f'<div class="bItm action oItm" data-id="{cid}" id="{cid}">'
        f'  <div class="bCont"><div class="bTitle">'
        f'    <a href="/tracklist/{cid}/test.html">Set {cid}</a>'
        f'  </div></div>'
        f'</div>'
        for cid in card_ids
    )
    badge_html  = f'<span class="badge spL">{total}</span>' if total is not None else ""
    next_li_html = (
        '<li class="" onclick="submitForm(this, { form: \'searchForm\','
        ' page: 2, noAnker: true });"><a href="#">Next</a></li>'
        if has_next
        else '<li class="disabled"><a href="#">Next</a></li>'
    )
    return f"""<!DOCTYPE html>
<html><body>
<div id="csMiddle">
  <div class="bItmH">Results {badge_html}</div>
  {cards}
</div>
<ul class="pagination bs">
  <li class="disabled"><a href="#">Prev</a></li>
  <li class="active"><a href="#">1</a></li>
  {next_li_html}
</ul>
</body></html>"""


def _raw(card_ids: list[str], *, has_next: bool = False, total: Optional[int] = None, url: str = "") -> _RawPage:
    return _RawPage(html=_make_html(card_ids, has_next=has_next, total=total), url=url)


def _run(coro):
    """Execute an async coroutine synchronously (no pytest-asyncio dependency)."""
    return asyncio.run(coro)


# ── Fixture integration helper ────────────────────────────────────────────────

_FIXTURE_DIR = pathlib.Path(__file__).parent / "fixtures" / "1001tracklists"


def _load_fixture(filename: str) -> Optional[str]:
    p = _FIXTURE_DIR / filename
    return p.read_text(encoding="utf-8") if p.exists() else None


# ══════════════════════════════════════════════════════════════════════════════
# Pagination loop tests
# ══════════════════════════════════════════════════════════════════════════════

class TestPaginationLoop:

    def test_deduplication_across_pages(self):
        """IDs shared between page 1 and page 2 must appear only once."""
        pages = [
            _raw(["a", "b", "c"], has_next=True),
            _raw(["b", "c", "d"], has_next=False),
        ]

        async def _inner():
            call_log = []

            async def get_next(n: int) -> Optional[_RawPage]:
                call_log.append(n)
                idx = n - 1   # page 2 → index 1, page 3 → index 2, …
                return pages[idx] if idx < len(pages) else None

            results, total, audits = await _paginate_results(pages[0], get_next, max_pages=10)
            assert len(results) == 4, f"Expected 4 unique IDs, got {[r.source_tracklist_id for r in results]}"
            ids = [r.source_tracklist_id for r in results]
            assert ids == ["a", "b", "c", "d"]
            assert call_log == [2], "get_next should be called exactly once (page 2)"
            assert len(audits) == 2

        _run(_inner())

    def test_stops_when_no_next_page(self):
        """Single page with has_next=False must stop without calling get_next."""
        page1 = _raw(["x", "y"], has_next=False)

        async def _inner():
            called = []

            async def get_next(n: int) -> Optional[_RawPage]:
                called.append(n)
                return None

            results, _, audits = await _paginate_results(page1, get_next, max_pages=10)
            assert len(results) == 2
            assert called == [], "get_next must NOT be called when has_next is False"
            assert len(audits) == 1
            assert audits[0].has_next_page is False

        _run(_inner())

    def test_stops_when_all_duplicates(self):
        """If page N yields zero new IDs, pagination must stop (loop guard)."""
        page1  = _raw(["a", "b"], has_next=True)
        page2  = _raw(["a", "b"], has_next=True)   # same IDs — all duplicates

        async def _inner():
            async def get_next(n: int) -> Optional[_RawPage]:
                return page2 if n == 2 else None

            results, _, audits = await _paginate_results(page1, get_next, max_pages=10)
            assert len(results) == 2, "No extra results from duplicate page"
            assert len(audits) == 2, "Audit entry recorded even for duplicate page"
            assert audits[1].cards_parsed == 0

        _run(_inner())

    def test_respects_max_pages(self):
        """Pagination must stop after max_pages regardless of has_next."""
        always_next = _raw(["p"], has_next=True)

        async def _inner():
            call_count = [0]

            async def get_next(n: int) -> Optional[_RawPage]:
                call_count[0] += 1
                return _raw([f"id_{n}"], has_next=True)

            results, _, audits = await _paginate_results(always_next, get_next, max_pages=3)
            assert len(audits) == 3, f"Expected 3 pages, got {len(audits)}"
            assert call_count[0] == 2, "get_next called for pages 2 and 3 only"

        _run(_inner())

    def test_graceful_stop_on_navigation_error(self):
        """Navigation exception must return collected results without re-raising."""
        page1 = _raw(["a", "b"], has_next=True)

        async def _inner():
            async def get_next(n: int) -> Optional[_RawPage]:
                raise RuntimeError("simulated timeout")

            results, _, audits = await _paginate_results(page1, get_next, max_pages=10)
            assert len(results) == 2, "Results from page 1 must be preserved"
            assert len(audits) == 1, "Audit entry for page 1 must be preserved"

        _run(_inner())

    def test_get_next_returns_none_stops_pagination(self):
        """If get_next returns None, the loop ends cleanly."""
        page1 = _raw(["a", "b"], has_next=True)

        async def _inner():
            async def get_next(n: int) -> Optional[_RawPage]:
                return None

            results, _, audits = await _paginate_results(page1, get_next, max_pages=10)
            assert len(results) == 2
            assert len(audits) == 1

        _run(_inner())

    def test_audit_metadata_per_page(self):
        """PageScrapeAudit fields must reflect each page's parsed state."""
        url1 = "https://www.1001tracklists.com/search/result.php?p=Test"
        url2 = "https://www.1001tracklists.com/search/result.php?p=Test&page=2"
        page1 = _RawPage(html=_make_html(["a", "b", "c"], has_next=True),  url=url1)
        page2 = _RawPage(html=_make_html(["d", "e"],      has_next=False), url=url2)

        async def _inner():
            async def get_next(n: int) -> Optional[_RawPage]:
                return page2 if n == 2 else None

            _, _, audits = await _paginate_results(page1, get_next, max_pages=10)
            assert len(audits) == 2
            a1, a2 = audits
            assert a1.page_number == 1
            assert a1.url == url1
            assert a1.cards_parsed == 3
            assert a1.has_next_page is True
            assert a2.page_number == 2
            assert a2.url == url2
            assert a2.cards_parsed == 2
            assert a2.has_next_page is False

        _run(_inner())

    def test_reported_total_from_first_page(self):
        """reported_total_results is extracted from the first parseable badge."""
        page1 = _raw(["a"], has_next=False, total=42)

        async def _inner():
            async def get_next(_n):
                return None

            _, total, _ = await _paginate_results(page1, get_next, max_pages=10)
            assert total == 42

        _run(_inner())

    def test_three_page_full_run(self):
        """Multi-page run with unique IDs on every page accumulates correctly."""
        pages = [
            _raw(["a1", "a2", "a3"], has_next=True,  total=9),
            _raw(["b1", "b2", "b3"], has_next=True),
            _raw(["c1", "c2", "c3"], has_next=False),
        ]

        async def _inner():
            async def get_next(n: int) -> Optional[_RawPage]:
                idx = n - 1   # page 2 → index 1, page 3 → index 2
                return pages[idx] if idx < len(pages) else None

            results, total, audits = await _paginate_results(pages[0], get_next, max_pages=10)
            assert len(results) == 9
            assert total == 9
            assert len(audits) == 3
            assert audits[2].has_next_page is False

        _run(_inner())

    def test_empty_first_page_no_next(self):
        """Empty first page (no cards) stops immediately."""
        page1 = _raw([], has_next=False)

        async def _inner():
            async def get_next(_n):
                return None

            results, _, audits = await _paginate_results(page1, get_next, max_pages=10)
            assert results == []
            assert len(audits) == 1
            assert audits[0].cards_parsed == 0

        _run(_inner())

    def test_max_pages_one_stops_after_first_page(self):
        """max_pages=1 must return exactly one page even when has_next is True."""
        page1 = _raw(["a", "b"], has_next=True)

        async def _inner():
            async def get_next(_n):
                pytest.fail("get_next must not be called when max_pages=1")

            results, _, audits = await _paginate_results(page1, get_next, max_pages=1)
            assert len(results) == 2
            assert len(audits) == 1

        _run(_inner())


# ══════════════════════════════════════════════════════════════════════════════
# Integration: pagination loop + real HTML parser (fixture-backed)
# ══════════════════════════════════════════════════════════════════════════════

class TestPaginationWithRealFixture:

    def test_illenium_fixture_single_page(self):
        """One real ILLENIUM fixture page flows through _paginate_results correctly."""
        html = _load_fixture("php_result_illenium.html")
        if html is None:
            pytest.skip("Fixture php_result_illenium.html not available")

        first = _RawPage(html=html, url="https://www.1001tracklists.com/search/result.php?p=illenium")

        async def _inner():
            async def get_next(_n):
                return None   # only process page 1

            results, total, audits = await _paginate_results(first, get_next, max_pages=50)
            assert len(results) == 30
            assert total == 569
            assert len(audits) == 1
            # has_next_page is True from fixture, but get_next returned None → stopped cleanly
            assert audits[0].has_next_page is True

        _run(_inner())

    def test_crankdat_fixture_dedup_noop(self):
        """GRiZ/Crankdat fixture page: no duplicates on a single page."""
        html = _load_fixture("php_result_crankdat.html")
        if html is None:
            pytest.skip("Fixture php_result_crankdat.html not available")

        async def _inner():
            async def get_next(_n):
                return None

            results, total, audits = await _paginate_results(
                _RawPage(html=html), get_next, max_pages=50
            )
            assert len(results) == 30
            assert total is not None and total > 0
            # All IDs must be unique — dedup must be a no-op on a single page
            ids = [r.source_tracklist_id for r in results]
            assert len(ids) == len(set(ids))

        _run(_inner())


# ══════════════════════════════════════════════════════════════════════════════
# _poll_for_card_change unit tests
# ══════════════════════════════════════════════════════════════════════════════

class TestPollForCardChange:
    """
    Direct unit tests for the DOM-transition polling helper.

    All tests use tiny timeouts / poll intervals so the suite runs fast.
    """

    def test_returns_true_when_id_eventually_changes(self):
        """
        Simulates Test 3: stale ID returned for first two polls, then new ID.
        The poller must not accept the stale content and must return True
        once the new ID appears.
        """
        call_count = [0]

        async def _inner():
            async def get_id() -> Optional[str]:
                call_count[0] += 1
                # First two polls still return the old (stale) page-1 card ID.
                if call_count[0] < 3:
                    return "stale_001"
                return "page2_001"   # page-2 content visible on 3rd poll

            result = await _poll_for_card_change(
                get_id, "stale_001", timeout_ms=5_000, poll_interval_ms=10
            )
            assert result is True, "Must return True when ID changes"
            assert call_count[0] >= 3, "Must have polled at least 3 times"

        _run(_inner())

    def test_returns_false_on_timeout_id_never_changes(self):
        """
        Simulates Test 4: page-1 content never replaced before timeout.
        The poller must return False without looping indefinitely.
        """
        async def _inner():
            async def get_id() -> Optional[str]:
                return "stale_001"   # always stale — DOM never transitions

            result = await _poll_for_card_change(
                get_id, "stale_001", timeout_ms=80, poll_interval_ms=10
            )
            assert result is False, "Must return False when timeout expires"

        _run(_inner())

    def test_returns_true_immediately_when_already_changed(self):
        """No polling needed when the first check already shows a new ID."""
        async def _inner():
            async def get_id() -> Optional[str]:
                return "page2_001"   # ID is already different

            result = await _poll_for_card_change(
                get_id, "stale_001", timeout_ms=1_000, poll_interval_ms=10
            )
            assert result is True

        _run(_inner())

    def test_none_does_not_count_as_a_change(self):
        """
        None means no cards are in the DOM yet (mid-transition).
        The poller must keep waiting until a real new ID appears.
        """
        call_count = [0]

        async def _inner():
            async def get_id() -> Optional[str]:
                call_count[0] += 1
                if call_count[0] < 3:
                    return None       # cards temporarily absent
                return "page2_001"

            result = await _poll_for_card_change(
                get_id, "stale_001", timeout_ms=5_000, poll_interval_ms=10
            )
            assert result is True
            assert call_count[0] >= 3, "Must keep polling through None responses"

        _run(_inner())

    def test_returns_false_when_always_none_and_timeout(self):
        """No cards ever appear (e.g., challenge page) → timeout → False."""
        async def _inner():
            async def get_id() -> Optional[str]:
                return None

            result = await _poll_for_card_change(
                get_id, "stale_001", timeout_ms=80, poll_interval_ms=10
            )
            assert result is False

        _run(_inner())


# ══════════════════════════════════════════════════════════════════════════════
# Additional _paginate_results tests for multi-page / stale-fallback scenarios
# ══════════════════════════════════════════════════════════════════════════════

class TestPaginationMultiPageAndStaleFallback:

    def test_two_pages_total_exceeds_30(self):
        """
        Test 2: Two pages of unique setlists (30 + 15) → 45 unique results.
        Confirms pagination does not stop after page 1 when there is a
        valid page 2 with new IDs.
        """
        page1_ids = [f"p1_{i:03d}" for i in range(30)]
        page2_ids = [f"p2_{i:03d}" for i in range(15)]

        page1 = _raw(page1_ids, has_next=True, total=45)
        page2 = _raw(page2_ids, has_next=False)

        async def _inner():
            async def get_next(n: int) -> Optional[_RawPage]:
                return page2 if n == 2 else None

            results, total, audits = await _paginate_results(page1, get_next, max_pages=10)

            assert len(results) == 45, f"Expected 45 unique results, got {len(results)}"
            assert total == 45
            assert len(audits) == 2
            assert audits[0].cards_parsed == 30
            assert audits[1].cards_parsed == 15
            assert not audits[1].has_next_page

        _run(_inner())

    def test_stale_page_fallback_stops_cleanly(self):
        """
        Test 3 (fallback layer): If _navigate_next_page's DOM-wait fails and
        stale HTML still reaches _paginate_results, the dedup guard must stop
        cleanly without consuming duplicate results.

        This simulates the original bug scenario at the logic level.
        """
        page1_ids = [f"id_{i:03d}" for i in range(30)]
        page1 = _raw(page1_ids, has_next=True, total=90)
        page2_stale = _raw(page1_ids, has_next=True)   # exact same 30 IDs — stale

        async def _inner():
            call_log: list[int] = []

            async def get_next(n: int) -> Optional[_RawPage]:
                call_log.append(n)
                return page2_stale   # always returns stale content

            results, _, audits = await _paginate_results(page1, get_next, max_pages=10)

            # Dedup guard must fire on page 2 and stop immediately.
            assert len(results) == 30, "No extra results from stale page"
            assert call_log == [2], "Must try page 2 then stop"
            assert len(audits) == 2
            assert audits[1].cards_parsed == 0, "Stale page contributes 0 new results"

        _run(_inner())

    def test_partial_overlap_page_still_advances(self):
        """
        Test 5: Page 2 contains some duplicate IDs plus genuinely new ones.
        Pagination must NOT stop because of the duplicates — it must keep going
        and collect the new unique IDs.
        """
        page1_ids = ["a", "b", "c"]
        page2_ids = ["b", "c", "d", "e"]    # b, c are duplicates; d, e are new

        page1 = _raw(page1_ids, has_next=True)
        page2 = _raw(page2_ids, has_next=False)

        async def _inner():
            async def get_next(n: int) -> Optional[_RawPage]:
                return page2 if n == 2 else None

            results, _, audits = await _paginate_results(page1, get_next, max_pages=10)

            ids = [r.source_tracklist_id for r in results]
            assert ids == ["a", "b", "c", "d", "e"], f"Got {ids}"
            assert len(results) == 5
            assert audits[1].cards_parsed == 2  # only d and e are new

        _run(_inner())

    def test_max_pages_stops_before_all_content_collected(self):
        """
        Test 6: max_pages ceiling is respected even when more pages exist.
        Stop condition is logged as limit-reached, not a pagination failure.
        """
        pages = [_raw([f"p{pg}_{i}" for i in range(5)], has_next=True) for pg in range(10)]

        async def _inner():
            async def get_next(n: int) -> Optional[_RawPage]:
                idx = n - 1
                return pages[idx] if idx < len(pages) else None

            results, _, audits = await _paginate_results(pages[0], get_next, max_pages=3)

            assert len(audits) == 3, f"Expected 3 pages scraped, got {len(audits)}"
            assert len(results) == 15  # 5 IDs × 3 pages

        _run(_inner())

    def test_page_never_changes_get_next_returns_none_stops_cleanly(self):
        """
        Test 4 at _paginate_results level: if get_next raises (simulating a
        timed-out DOM transition that exhausted tenacity retries), partial
        results are preserved and the loop stops without re-raising.
        """
        page1 = _raw([f"id_{i}" for i in range(30)], has_next=True, total=90)

        async def _inner():
            async def get_next(n: int) -> Optional[_RawPage]:
                raise RuntimeError("DOM transition timed out after all retries")

            results, _, audits = await _paginate_results(page1, get_next, max_pages=10)

            assert len(results) == 30, "Page-1 results must be preserved"
            assert len(audits) == 1,   "Only page 1 should have an audit entry"

        _run(_inner())
