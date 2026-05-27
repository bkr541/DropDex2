"""
Tests for the 1001Tracklists search-result page parser.

Fixtures used:
  php_result_illenium.html  — ILLENIUM search results (page 1, 569 total)
  php_result_crankdat.html  — GRiZ search results (page 1, 85 total).
                              NOTE: this fixture is sourced from a GRiZ search
                              page; it contains a "Levity & Crankdat & GRiZ"
                              co-headliner result, which satisfies the Crankdat
                              title and track-count assertions.  Replace with a
                              real Crankdat search page when available.

All tests are fully offline — no network calls, no Supabase writes.
"""

import pathlib
import re

import pytest

from app.discovery.scrapers.tracklists1001 import (
    parse_result_page,
    ParsedResultPage,
    ParsedSetlistResult,
)

# ── Fixture loading ───────────────────────────────────────────────────────────

FIXTURE_DIR = pathlib.Path(__file__).parent / "fixtures" / "1001tracklists"


def _load(filename: str) -> str:
    path = FIXTURE_DIR / filename
    if not path.exists():
        pytest.skip(f"Fixture not found: {path}")
    return path.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def illenium_page() -> ParsedResultPage:
    return parse_result_page(_load("php_result_illenium.html"))


@pytest.fixture(scope="module")
def crankdat_page() -> ParsedResultPage:
    return parse_result_page(_load("php_result_crankdat.html"))


# ── Synthetic HTML for safety tests ──────────────────────────────────────────

_SYNTHETIC_HTML = """<!DOCTYPE html>
<html><body>
<div id="csMiddle">
  <div class="bItmH">Results<span class="badge spL">2</span></div>
  <div class="bItm action oItm" data-id="good001" id="good001"
       onclick="window.open('/tracklist/good001/test.html','_self');">
    <img data-src="https://cdn.1001tracklists.com/img/art.jpg"
         src="/images/static/empty.png" class="artM">
    <div class="bCont">
      <div class="bTitle">
        <a href="/tracklist/good001/test.html">Good Tracklist</a>
      </div>
    </div>
    <div class="mediaRow iRow">
      <div class="badge views" title="tracklist views" data-count="42"></div>
      <div title="tracklist date"><i class="fa fa-calendar"></i>2026-01-15</div>
      <div class="tlUser" title="creator">
        <a href="/user/dj_test/index.html">dj_test</a>
      </div>
      <div title="IDed tracks / total tracks">
        <span class="greenTxt">all</span>/10
      </div>
      <div title="play time">1h 10m</div>
      <div title="musicstyle(s)"><i></i>Dubstep, Trap</div>
      <div class="noMob" title="tracklist creation date">2 days ago</div>
    </div>
  </div>
  <!-- malformed: data-id present but no title link -->
  <div class="bItm action oItm" data-id="bad001" id="bad001">
    <div class="bCont">
      <div class="bTitle"><!-- intentionally no <a> --></div>
    </div>
  </div>
  <!-- malformed: no data-id at all -->
  <div class="bItm action oItm">
    <div class="bCont">
      <div class="bTitle">
        <a href="/tracklist/noid/test.html">No Data-ID</a>
      </div>
    </div>
  </div>
</div>
<ul class="pagination bs">
  <li class="disabled"><a href="#">Prev</a></li>
  <li class="active"><a href="#">1</a></li>
  <li class="" onclick="submitForm(this, { form: 'searchForm', page: 2, noAnker: true });">
    <a href="#">Next</a>
  </li>
</ul>
</body></html>"""

_SYNTHETIC_NO_NEXT = _SYNTHETIC_HTML.replace(
    '<li class="" onclick="submitForm(this, { form: \'searchForm\', page: 2, noAnker: true });">',
    '<li class="disabled">',
)


# ══════════════════════════════════════════════════════════════════════════════
# ILLENIUM fixture tests
# ══════════════════════════════════════════════════════════════════════════════

class TestIlleniumPage:
    def test_parses_without_error(self, illenium_page):
        assert isinstance(illenium_page, ParsedResultPage)

    def test_result_count(self, illenium_page):
        assert len(illenium_page.results) == 30

    def test_query_text(self, illenium_page):
        assert illenium_page.query_text is not None
        assert "illenium" in illenium_page.query_text.lower()

    def test_reported_total(self, illenium_page):
        assert illenium_page.reported_total_results == 569

    def test_current_page(self, illenium_page):
        assert illenium_page.current_page == 1

    def test_has_next_page(self, illenium_page):
        assert illenium_page.has_next_page is True
        assert illenium_page.next_page_number == 2

    def test_all_results_have_required_fields(self, illenium_page):
        for r in illenium_page.results:
            assert r.source_tracklist_id, f"Missing source_tracklist_id: {r!r}"
            assert r.title, f"Missing title: {r!r}"
            assert r.source_url, f"Missing source_url: {r!r}"

    def test_source_urls_are_absolute(self, illenium_page):
        for r in illenium_page.results:
            assert r.source_url.startswith("https://www.1001tracklists.com/tracklist/")

    def test_source_field_value(self, illenium_page):
        for r in illenium_page.results:
            assert r.source == "1001tracklists"

    def test_illenium_title_present(self, illenium_page):
        titles = [r.title.lower() for r in illenium_page.results]
        assert any("illenium" in t for t in titles)

    def test_completion_pct_all_ided(self, illenium_page):
        # Cards where ided_tracks == total_tracks should have 100.0
        for r in illenium_page.results:
            if r.ided_tracks is not None and r.total_tracks is not None:
                if r.ided_tracks == r.total_tracks and r.total_tracks > 0:
                    assert r.completion_pct == 100.0

    def test_completion_pct_partial(self, illenium_page):
        # Find the 53/54 card (ILLENIUM @ Night 3, Sphere) and verify pct
        partial = [
            r for r in illenium_page.results
            if r.ided_tracks is not None
            and r.total_tracks is not None
            and r.ided_tracks != r.total_tracks
        ]
        assert partial, "Expected at least one card with partial track ID coverage"
        for r in partial:
            expected = round(r.ided_tracks / r.total_tracks * 100, 2)
            assert r.completion_pct == expected, (
                f"{r.title!r}: pct {r.completion_pct} != {expected}"
            )

    def test_completion_pct_none_when_total_zero(self, illenium_page):
        for r in illenium_page.results:
            if r.total_tracks is not None and r.total_tracks == 0:
                assert r.completion_pct is None

    def test_views_populated(self, illenium_page):
        with_views = [r for r in illenium_page.results if r.views is not None]
        assert len(with_views) > 0

    def test_music_styles_list(self, illenium_page):
        with_styles = [r for r in illenium_page.results if r.music_styles]
        assert len(with_styles) > 0
        for r in with_styles:
            assert isinstance(r.music_styles, list)
            assert all(isinstance(s, str) for s in r.music_styles)

    def test_source_tracklist_id_in_source_url(self, illenium_page):
        for r in illenium_page.results:
            assert r.source_tracklist_id in r.source_url

    def test_set_date_iso_format(self, illenium_page):
        iso = re.compile(r"^\d{4}-\d{2}-\d{2}$")
        for r in illenium_page.results:
            if r.set_date is not None:
                assert iso.match(r.set_date), f"Bad date format: {r.set_date!r}"

    def test_raw_result_json_serializable(self, illenium_page):
        import json
        for r in illenium_page.results:
            # Should not raise
            json.dumps(r.raw_result_json)


# ══════════════════════════════════════════════════════════════════════════════
# Crankdat fixture tests
# (fixture sourced from GRiZ search page; contains a Crankdat co-headliner)
# ══════════════════════════════════════════════════════════════════════════════

class TestCrankdatPage:
    def test_parses_without_error(self, crankdat_page):
        assert isinstance(crankdat_page, ParsedResultPage)

    def test_result_count(self, crankdat_page):
        assert len(crankdat_page.results) == 30

    def test_reported_total_present(self, crankdat_page):
        assert crankdat_page.reported_total_results is not None
        assert crankdat_page.reported_total_results > 0

    def test_has_next_page(self, crankdat_page):
        assert crankdat_page.has_next_page is True
        assert crankdat_page.next_page_number == 2

    def test_all_results_have_required_fields(self, crankdat_page):
        for r in crankdat_page.results:
            assert r.source_tracklist_id, f"Missing source_tracklist_id: {r!r}"
            assert r.title, f"Missing title: {r!r}"
            assert r.source_url, f"Missing source_url: {r!r}"

    def test_source_urls_are_absolute(self, crankdat_page):
        for r in crankdat_page.results:
            assert r.source_url.startswith("https://www.1001tracklists.com/tracklist/")

    def test_crankdat_title_present(self, crankdat_page):
        """At least one result in this fixture features Crankdat in the title."""
        titles = [r.title.lower() for r in crankdat_page.results]
        assert any("crankdat" in t for t in titles), (
            "Expected at least one result mentioning 'crankdat'. "
            "Available titles: " + str([r.title for r in crankdat_page.results[:5]])
        )

    def test_crankdat_result_track_counts(self, crankdat_page):
        """The Crankdat co-headliner card has valid track-count data."""
        crankdat_results = [
            r for r in crankdat_page.results if "crankdat" in r.title.lower()
        ]
        assert crankdat_results, "Crankdat result unexpectedly absent"
        r = crankdat_results[0]
        assert r.ided_tracks is not None, "ided_tracks should be an integer"
        assert r.total_tracks is not None, "total_tracks should be an integer"
        assert r.total_tracks > 0
        assert r.completion_pct is not None
        assert 0 < r.completion_pct <= 100

    def test_completion_pct_calculation(self, crankdat_page):
        crankdat_results = [
            r for r in crankdat_page.results if "crankdat" in r.title.lower()
        ]
        r = crankdat_results[0]
        expected = round(r.ided_tracks / r.total_tracks * 100, 2)
        assert r.completion_pct == expected


# ══════════════════════════════════════════════════════════════════════════════
# Synthetic HTML — safety and edge cases
# ══════════════════════════════════════════════════════════════════════════════

class TestParserSafety:
    def test_malformed_cards_skipped(self):
        """Cards with no data-id or no title link must be skipped, not crash."""
        page = parse_result_page(_SYNTHETIC_HTML)
        # Only the valid card (good001) should be returned
        assert len(page.results) == 1
        assert page.results[0].source_tracklist_id == "good001"
        assert page.results[0].title == "Good Tracklist"

    def test_valid_card_fields_from_synthetic(self):
        page = parse_result_page(_SYNTHETIC_HTML)
        r = page.results[0]
        assert r.source == "1001tracklists"
        assert r.source_url == "https://www.1001tracklists.com/tracklist/good001/test.html"
        assert r.artwork_url == "https://cdn.1001tracklists.com/img/art.jpg"
        assert r.set_date == "2026-01-15"
        assert r.creator_username == "dj_test"
        assert r.creator_profile_url == "https://www.1001tracklists.com/user/dj_test/index.html"
        assert r.ided_tracks == 10
        assert r.total_tracks == 10
        assert r.completion_pct == 100.0
        assert r.duration_text == "1h 10m"
        assert r.duration_seconds == 4200
        assert "Dubstep" in r.music_styles
        assert "Trap" in r.music_styles
        assert r.created_age_text == "2 days ago"

    def test_has_next_page_from_synthetic(self):
        page = parse_result_page(_SYNTHETIC_HTML)
        assert page.has_next_page is True
        assert page.next_page_number == 2

    def test_no_next_page_when_disabled(self):
        page = parse_result_page(_SYNTHETIC_NO_NEXT)
        assert page.has_next_page is False
        assert page.next_page_number is None

    def test_empty_html_does_not_raise(self):
        page = parse_result_page("")
        assert isinstance(page, ParsedResultPage)
        assert page.results == []

    def test_empty_page_no_next(self):
        page = parse_result_page("")
        assert page.has_next_page is False

    def test_duration_parsing_variants(self):
        """Duration strings used in real pages all convert correctly."""
        from app.discovery.scrapers.tracklists1001.parser import _parse_duration_secs
        assert _parse_duration_secs("1h 31m") == 5460
        assert _parse_duration_secs("18m")    == 1080
        assert _parse_duration_secs("1h")     == 3600
        assert _parse_duration_secs("59m")    == 3540
        assert _parse_duration_secs("2h 9m")  == 7740
        assert _parse_duration_secs("")       is None
        assert _parse_duration_secs("no time") is None

    def test_track_count_variants(self):
        """All track-count formats used in real pages parse correctly."""
        from app.discovery.scrapers.tracklists1001.parser import _parse_tracks
        assert _parse_tracks("all/19")  == (19, 19)
        assert _parse_tracks("53/54")   == (53, 54)
        assert _parse_tracks("/19")     == (None, 19)
        assert _parse_tracks("")        == (None, None)
        assert _parse_tracks(None)      == (None, None)

    def test_abs_url_conversion(self):
        from app.discovery.scrapers.tracklists1001.parser import _abs_url
        assert _abs_url("/tracklist/abc/test.html") == (
            "https://www.1001tracklists.com/tracklist/abc/test.html"
        )
        assert _abs_url("https://i1.sndcdn.com/art.jpg") == "https://i1.sndcdn.com/art.jpg"
        assert _abs_url("/images/static/empty.png") is None
        assert _abs_url("") is None
        assert _abs_url(None) is None
