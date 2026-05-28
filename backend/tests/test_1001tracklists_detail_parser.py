"""
Tests for the 1001Tracklists setlist detail page parser.

Fixtures used:
  detail_wooli_crankdat.html  — Wooli & Crankdat @ Wankdat, Ultra Miami 2026-03-29
                                145 track positions, 79 w/ rows, timed cues present.
  detail_crankdat_illenium.html — Crankdat & ILLENIUM @ Get Cranked, Miami 2026-03-28
                                12 track positions, 4 w/ rows, no visible cues.
  detail_illenium_luna.html   — ILLENIUM @ Luna Stage, Empire Music Festival 2026-05-02
                                15 track positions, 7 w/ rows, no visible cues.

All tests are fully offline — no network calls, no Supabase writes.
"""

import pathlib

import pytest

from app.discovery.scrapers.tracklists1001 import (
    parse_tracklist_detail,
    ParsedTracklistDetail,
    ParsedTrackPosition,
)

# ── Fixture loading ───────────────────────────────────────────────────────────

FIXTURE_DIR = pathlib.Path(__file__).parent / "fixtures" / "1001tracklists"


def _load(filename: str) -> str:
    path = FIXTURE_DIR / filename
    if not path.exists():
        pytest.skip(f"Fixture not found: {path}")
    return path.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def wooli_detail() -> ParsedTracklistDetail:
    return parse_tracklist_detail(_load("detail_wooli_crankdat.html"))


@pytest.fixture(scope="module")
def crankdat_illenium_detail() -> ParsedTracklistDetail:
    return parse_tracklist_detail(_load("detail_crankdat_illenium.html"))


@pytest.fixture(scope="module")
def illenium_luna_detail() -> ParsedTracklistDetail:
    return parse_tracklist_detail(_load("detail_illenium_luna.html"))


# ── Wooli & Crankdat fixture tests ────────────────────────────────────────────

class TestWooliCrankdatDetail:
    """Wooli & Crankdat @ Ultra Miami — 145 tracks, timed cues, many w/ rows."""

    def test_title_extracted(self, wooli_detail: ParsedTracklistDetail):
        assert wooli_detail.title is not None
        assert "Wooli" in wooli_detail.title or "Crankdat" in wooli_detail.title

    def test_source_numeric_tracklist_id(self, wooli_detail: ParsedTracklistDetail):
        assert wooli_detail.source_numeric_tracklist_id == "639744"

    def test_track_count(self, wooli_detail: ParsedTracklistDetail):
        assert len(wooli_detail.tracks) == 145

    def test_declared_position_count(self, wooli_detail: ParsedTracklistDetail):
        assert wooli_detail.declared_position_count == 145

    def test_has_timed_cues(self, wooli_detail: ParsedTracklistDetail):
        assert wooli_detail.has_timed_cues is True

    def test_canonical_url(self, wooli_detail: ParsedTracklistDetail):
        assert wooli_detail.canonical_url is not None
        assert wooli_detail.canonical_url.startswith("https://www.1001tracklists.com")

    def test_raw_metadata_json_present(self, wooli_detail: ParsedTracklistDetail):
        assert wooli_detail.raw_metadata_json is not None
        assert wooli_detail.raw_metadata_json["parsed_track_count"] == 145

    # ── Track ordering ────────────────────────────────────────────────────────

    def test_tracks_ordered_by_sequence_index(self, wooli_detail: ParsedTracklistDetail):
        indices = [t.sequence_index for t in wooli_detail.tracks]
        assert indices == sorted(indices), "Tracks must be in ascending sequence_index order"

    def test_sequence_index_starts_at_zero(self, wooli_detail: ParsedTracklistDetail):
        assert wooli_detail.tracks[0].sequence_index == 0

    # ── First track ───────────────────────────────────────────────────────────

    def test_first_track_is_primary(self, wooli_detail: ParsedTracklistDetail):
        first = wooli_detail.tracks[0]
        assert first.played_with_previous is False
        assert first.track_number == 1

    def test_first_track_has_cue(self, wooli_detail: ParsedTracklistDetail):
        first = wooli_detail.tracks[0]
        assert first.cue_text == "00:10"
        assert first.cue_seconds == 10

    def test_first_track_has_title(self, wooli_detail: ParsedTracklistDetail):
        first = wooli_detail.tracks[0]
        assert first.title is not None
        assert len(first.title) > 0

    def test_first_track_has_source_position_id(self, wooli_detail: ParsedTracklistDetail):
        first = wooli_detail.tracks[0]
        assert first.source_position_id == "13679725"

    def test_first_track_has_source_track_id(self, wooli_detail: ParsedTracklistDetail):
        first = wooli_detail.tracks[0]
        assert first.source_track_id is not None

    def test_first_track_has_artwork(self, wooli_detail: ParsedTracklistDetail):
        first = wooli_detail.tracks[0]
        assert first.artwork_url is not None
        assert first.artwork_url.startswith("https://")

    # ── Cue parsing correctness ───────────────────────────────────────────────

    def test_cue_minutes_parsed_correctly(self, wooli_detail: ParsedTracklistDetail):
        # "01:45" → 105 seconds
        track = wooli_detail.tracks[1]
        assert track.cue_text == "01:45"
        assert track.cue_seconds == 105

    def test_cue_large_value_parsed(self, wooli_detail: ParsedTracklistDetail):
        # "46:50" should appear somewhere in the set; verify correct conversion
        timed = [t for t in wooli_detail.tracks if t.cue_text == "46:50"]
        assert len(timed) >= 1
        assert timed[0].cue_seconds == 46 * 60 + 50

    # ── Layered / w/ rows ─────────────────────────────────────────────────────

    def test_w_rows_count(self, wooli_detail: ParsedTracklistDetail):
        con_tracks = [t for t in wooli_detail.tracks if t.played_with_previous]
        assert len(con_tracks) == 79

    def test_w_row_track_number_is_null(self, wooli_detail: ParsedTracklistDetail):
        con_tracks = [t for t in wooli_detail.tracks if t.played_with_previous]
        for t in con_tracks:
            assert t.track_number is None, (
                f"w/ track at seq {t.sequence_index} should have track_number=None"
            )

    def test_w_row_follows_primary(self, wooli_detail: ParsedTracklistDetail):
        # Find the first w/ row and verify it is preceded by a primary track.
        con_indices = [i for i, t in enumerate(wooli_detail.tracks) if t.played_with_previous]
        assert len(con_indices) > 0
        first_con_idx = con_indices[0]
        assert first_con_idx > 0, "First con row must not be the very first track"
        preceding = wooli_detail.tracks[first_con_idx - 1]
        assert preceding.played_with_previous is False, "Row before first con must be a primary"
        con = wooli_detail.tracks[first_con_idx]
        assert con.played_with_previous is True
        assert con.track_number is None

    # ── ID / unidentified tracks ──────────────────────────────────────────────

    def test_all_rows_have_source_position_id(self, wooli_detail: ParsedTracklistDetail):
        for t in wooli_detail.tracks:
            assert t.source_position_id, f"Track at seq {t.sequence_index} missing source_position_id"

    def test_raw_track_json_present(self, wooli_detail: ParsedTracklistDetail):
        for t in wooli_detail.tracks:
            assert t.raw_track_json is not None

    # ── Duration ─────────────────────────────────────────────────────────────

    def test_duration_parsed_where_present(self, wooli_detail: ParsedTracklistDetail):
        with_duration = [t for t in wooli_detail.tracks if t.duration_seconds is not None]
        assert len(with_duration) > 0
        for t in with_duration:
            assert t.duration_seconds > 0
            assert t.duration_text is not None

    # ── Artist text ───────────────────────────────────────────────────────────

    def test_artist_text_extracted_where_present(self, wooli_detail: ParsedTracklistDetail):
        with_artist = [t for t in wooli_detail.tracks if t.artist_text is not None]
        assert len(with_artist) > 0


# ── Crankdat & ILLENIUM fixture tests ─────────────────────────────────────────

class TestCrankdatIlleniumDetail:
    """Crankdat & ILLENIUM @ Get Cranked — 12 tracks, no visible cues, some w/ rows."""

    def test_track_count(self, crankdat_illenium_detail: ParsedTracklistDetail):
        assert len(crankdat_illenium_detail.tracks) == 12

    def test_source_numeric_tracklist_id(self, crankdat_illenium_detail: ParsedTracklistDetail):
        assert crankdat_illenium_detail.source_numeric_tracklist_id == "639748"

    def test_declared_position_count(self, crankdat_illenium_detail: ParsedTracklistDetail):
        assert crankdat_illenium_detail.declared_position_count == 12

    def test_no_timed_cues(self, crankdat_illenium_detail: ParsedTracklistDetail):
        assert crankdat_illenium_detail.has_timed_cues is False

    def test_no_false_zero_cue_assignment(self, crankdat_illenium_detail: ParsedTracklistDetail):
        """
        Critical: rows with a blank visible cue must NOT be assigned cue_seconds=0.
        When the hidden input says "0" but div.cue is empty, both values are None.
        """
        for t in crankdat_illenium_detail.tracks:
            assert t.cue_seconds is None, (
                f"Track at seq {t.sequence_index} has cue_seconds={t.cue_seconds}; "
                "expected None because no visible cue is displayed"
            )
            assert t.cue_text is None

    def test_w_rows_detected(self, crankdat_illenium_detail: ParsedTracklistDetail):
        con_tracks = [t for t in crankdat_illenium_detail.tracks if t.played_with_previous]
        assert len(con_tracks) == 4

    def test_first_track_has_title(self, crankdat_illenium_detail: ParsedTracklistDetail):
        first = crankdat_illenium_detail.tracks[0]
        assert first.title is not None
        assert len(first.title) > 0

    def test_first_track_is_primary(self, crankdat_illenium_detail: ParsedTracklistDetail):
        first = crankdat_illenium_detail.tracks[0]
        assert first.played_with_previous is False
        assert first.track_number == 1

    def test_ordering_preserved(self, crankdat_illenium_detail: ParsedTracklistDetail):
        indices = [t.sequence_index for t in crankdat_illenium_detail.tracks]
        assert indices == sorted(indices)

    def test_canonical_url_present(self, crankdat_illenium_detail: ParsedTracklistDetail):
        assert crankdat_illenium_detail.canonical_url is not None
        assert "1001tracklists.com" in crankdat_illenium_detail.canonical_url

    def test_all_rows_have_source_position_id(self, crankdat_illenium_detail: ParsedTracklistDetail):
        for t in crankdat_illenium_detail.tracks:
            assert t.source_position_id

    def test_artwork_present_on_some_tracks(self, crankdat_illenium_detail: ParsedTracklistDetail):
        with_art = [t for t in crankdat_illenium_detail.tracks if t.artwork_url is not None]
        assert len(with_art) > 0

    def test_source_track_url_present_on_some_tracks(self, crankdat_illenium_detail: ParsedTracklistDetail):
        with_url = [t for t in crankdat_illenium_detail.tracks if t.source_track_url is not None]
        assert len(with_url) > 0
        for t in with_url:
            assert t.source_track_url.startswith("https://www.1001tracklists.com")


# ── ILLENIUM Luna Stage fixture tests ─────────────────────────────────────────

class TestIlleniumLunaDetail:
    """ILLENIUM @ Luna Stage, Empire Music Festival — 15 tracks, 7 w/ rows, no cues."""

    def test_track_count(self, illenium_luna_detail: ParsedTracklistDetail):
        assert len(illenium_luna_detail.tracks) == 15

    def test_source_numeric_tracklist_id(self, illenium_luna_detail: ParsedTracklistDetail):
        assert illenium_luna_detail.source_numeric_tracklist_id == "646722"

    def test_declared_position_count(self, illenium_luna_detail: ParsedTracklistDetail):
        assert illenium_luna_detail.declared_position_count == 15

    def test_title_contains_illenium(self, illenium_luna_detail: ParsedTracklistDetail):
        assert illenium_luna_detail.title is not None
        assert "ILLENIUM" in illenium_luna_detail.title

    def test_canonical_url(self, illenium_luna_detail: ParsedTracklistDetail):
        url = illenium_luna_detail.canonical_url
        assert url == (
            "https://www.1001tracklists.com/tracklist/rwbmuyk/"
            "illenium-luna-stage-empire-music-festival-guatemala-2026-05-02.html"
        )

    def test_w_rows_count(self, illenium_luna_detail: ParsedTracklistDetail):
        con_tracks = [t for t in illenium_luna_detail.tracks if t.played_with_previous]
        assert len(con_tracks) == 7

    def test_no_timed_cues(self, illenium_luna_detail: ParsedTracklistDetail):
        assert illenium_luna_detail.has_timed_cues is False

    def test_no_false_zero_cue_assignment(self, illenium_luna_detail: ParsedTracklistDetail):
        for t in illenium_luna_detail.tracks:
            assert t.cue_seconds is None
            assert t.cue_text is None

    def test_first_track_title_and_artist(self, illenium_luna_detail: ParsedTracklistDetail):
        first = illenium_luna_detail.tracks[0]
        assert first.title is not None
        assert "Slave To The Rithm" in (first.title or "")
        assert first.artist_text is not None
        assert "ILLENIUM" in (first.artist_text or "")

    def test_first_track_has_artwork(self, illenium_luna_detail: ParsedTracklistDetail):
        first = illenium_luna_detail.tracks[0]
        assert first.artwork_url is not None
        assert first.artwork_url.startswith("https://")

    def test_source_track_urls_are_absolute(self, illenium_luna_detail: ParsedTracklistDetail):
        with_url = [t for t in illenium_luna_detail.tracks if t.source_track_url is not None]
        assert len(with_url) > 0
        for t in with_url:
            assert t.source_track_url.startswith("https://www.1001tracklists.com")

    def test_duration_parsed_on_some_tracks(self, illenium_luna_detail: ParsedTracklistDetail):
        with_dur = [t for t in illenium_luna_detail.tracks if t.duration_seconds is not None]
        assert len(with_dur) > 0

    def test_ordering_preserved(self, illenium_luna_detail: ParsedTracklistDetail):
        indices = [t.sequence_index for t in illenium_luna_detail.tracks]
        assert indices == sorted(indices)

    def test_w_row_track_number_is_null(self, illenium_luna_detail: ParsedTracklistDetail):
        con_tracks = [t for t in illenium_luna_detail.tracks if t.played_with_previous]
        for t in con_tracks:
            assert t.track_number is None

    def test_primary_tracks_have_track_number(self, illenium_luna_detail: ParsedTracklistDetail):
        primary = [t for t in illenium_luna_detail.tracks if not t.played_with_previous]
        for t in primary:
            assert t.track_number is not None and t.track_number >= 1

    def test_all_rows_have_source_position_id(self, illenium_luna_detail: ParsedTracklistDetail):
        for t in illenium_luna_detail.tracks:
            assert t.source_position_id


# ── Parser robustness tests ───────────────────────────────────────────────────

class TestDetailParserRobustness:
    """Verify the parser survives missing optional fields and edge-case inputs."""

    _MINIMAL_HTML = """<!DOCTYPE html>
<html><head>
  <title>Test Set 2026-01-01</title>
  <link rel="canonical" href="https://www.1001tracklists.com/tracklist/abc/test.html">
</head><body>
  <form id="frmEditTracklist">
    <input name="id_tracklist" value="999">
    <input name="tl_pos_count" value="2">
  </form>
  <div class="tlpTog bItm tlpItem trRow1" data-trno="0" data-id="100"
       data-trackid="abc123">
    <div class="bPlay">
      <input id="tlp100_cue_seconds" type="hidden" value="0" form="frmEditTracklist">
      <span id="tlp0_tracknumber_value" class="fontXL">01 </span>
      <div id="cue_100" class="cue noWrap action mt5" data-mode="hours"></div>
    </div>
    <div class="bCont tl">
      <div itemprop="tracks" itemscope>
        <meta itemprop="name" content="Test Track Title">
        <meta itemprop="byArtist" content="Test Artist">
        <meta itemprop="duration" content="PT3M30S">
        <meta itemprop="url" content="/track/abc123/test-track/index.html">
      </div>
    </div>
  </div>
  <div class="tlpTog bItm tlpItem trRow1 con" data-trno="1" data-id="101"
       data-trackid="def456">
    <div class="bPlay">
      <input id="tlp101_cue_seconds" type="hidden" value="0" form="frmEditTracklist">
      <span id="tlp1_tracknumber_value" class="fontXL" title="played together">w/ </span>
      <div id="cue_101" class="cue noWrap action mt5" data-mode="hours"></div>
    </div>
    <div class="bCont tl">
      <div itemprop="tracks" itemscope>
        <meta itemprop="name" content="Layered Track">
        <meta itemprop="byArtist" content="Another Artist">
      </div>
    </div>
  </div>
</body></html>"""

    def test_minimal_html_parses_without_error(self):
        result = parse_tracklist_detail(self._MINIMAL_HTML)
        assert isinstance(result, ParsedTracklistDetail)

    def test_minimal_html_track_count(self):
        result = parse_tracklist_detail(self._MINIMAL_HTML)
        assert len(result.tracks) == 2

    def test_minimal_html_title(self):
        result = parse_tracklist_detail(self._MINIMAL_HTML)
        assert result.title == "Test Set 2026-01-01"

    def test_minimal_html_tracklist_id(self):
        result = parse_tracklist_detail(self._MINIMAL_HTML)
        assert result.source_numeric_tracklist_id == "999"

    def test_minimal_html_primary_track(self):
        result = parse_tracklist_detail(self._MINIMAL_HTML)
        primary = result.tracks[0]
        assert primary.played_with_previous is False
        assert primary.track_number == 1
        assert primary.title == "Test Track Title"
        assert primary.artist_text == "Test Artist"
        assert primary.duration_seconds == 210
        assert primary.duration_text == "3:30"
        assert primary.source_track_url == "https://www.1001tracklists.com/track/abc123/test-track/index.html"

    def test_minimal_html_w_row(self):
        result = parse_tracklist_detail(self._MINIMAL_HTML)
        con = result.tracks[1]
        assert con.played_with_previous is True
        assert con.track_number is None
        assert con.title == "Layered Track"

    def test_blank_cue_div_produces_null_cue(self):
        """Hidden input value=0 with empty div.cue must not produce cue_seconds=0."""
        result = parse_tracklist_detail(self._MINIMAL_HTML)
        for t in result.tracks:
            assert t.cue_seconds is None
            assert t.cue_text is None

    def test_empty_html_returns_no_tracks(self):
        result = parse_tracklist_detail("<html><body></body></html>")
        assert result.tracks == []
        assert result.has_timed_cues is False

    def test_explicit_zero_cue_stored(self):
        """A visible "00:00" in div.cue must store cue_seconds=0."""
        html = """<html><body>
        <div class="tlpTog bItm tlpItem trRow1" data-trno="0" data-id="200" data-trackid="x">
          <div class="bPlay">
            <input id="tlp200_cue_seconds" type="hidden" value="0" form="frmEditTracklist">
            <span id="tlp0_tracknumber_value">01 </span>
            <div id="cue_200" class="cue noWrap action mt5">00:00</div>
          </div>
          <div class="bCont tl"><div itemprop="tracks" itemscope>
            <meta itemprop="name" content="Opening Track">
          </div></div>
        </div>
        </body></html>"""
        result = parse_tracklist_detail(html)
        assert len(result.tracks) == 1
        assert result.tracks[0].cue_seconds == 0
        assert result.tracks[0].cue_text == "00:00"

    def test_hour_format_cue_parsed(self):
        """Cue time "1:26:10" must parse to 5170 seconds."""
        html = """<html><body>
        <div class="tlpTog bItm tlpItem trRow1" data-trno="0" data-id="300" data-trackid="y">
          <div class="bPlay">
            <input id="tlp300_cue_seconds" type="hidden" value="5170" form="frmEditTracklist">
            <span id="tlp0_tracknumber_value">01 </span>
            <div id="cue_300" class="cue noWrap action mt5">1:26:10</div>
          </div>
          <div class="bCont tl"><div itemprop="tracks" itemscope>
            <meta itemprop="name" content="Late Night Track">
          </div></div>
        </div>
        </body></html>"""
        result = parse_tracklist_detail(html)
        assert len(result.tracks) == 1
        assert result.tracks[0].cue_text == "1:26:10"
        assert result.tracks[0].cue_seconds == 5170

    def test_missing_data_id_row_skipped(self):
        """A row without data-id must be silently skipped."""
        html = """<html><body>
        <div class="tlpTog bItm tlpItem trRow1" data-trno="0">
          <div class="bCont tl"><div itemprop="tracks" itemscope>
            <meta itemprop="name" content="No ID Track">
          </div></div>
        </div>
        </body></html>"""
        result = parse_tracklist_detail(html)
        assert result.tracks == []

    def test_missing_optional_fields_no_crash(self):
        """A row with only data-id (no title, artist, artwork, duration) must not raise."""
        html = """<html><body>
        <div class="tlpTog bItm tlpItem trRow1" data-trno="0" data-id="400">
          <div class="bPlay">
            <div id="cue_400" class="cue noWrap action mt5"></div>
          </div>
        </div>
        </body></html>"""
        result = parse_tracklist_detail(html)
        assert len(result.tracks) == 1
        t = result.tracks[0]
        assert t.source_position_id == "400"
        assert t.title is None
        assert t.artist_text is None
        assert t.artwork_url is None
        assert t.duration_seconds is None
        assert t.cue_seconds is None

    def test_cue_mmss_parsing(self):
        """Verify various MM:SS cue strings convert correctly."""
        from app.discovery.scrapers.tracklists1001.detail_parser import _cue_text_to_seconds
        assert _cue_text_to_seconds("00:10") == 10
        assert _cue_text_to_seconds("01:45") == 105
        assert _cue_text_to_seconds("46:50") == 2810
        assert _cue_text_to_seconds("59:30") == 3570

    def test_cue_hmmss_parsing(self):
        """Verify H:MM:SS cue strings convert correctly."""
        from app.discovery.scrapers.tracklists1001.detail_parser import _cue_text_to_seconds
        assert _cue_text_to_seconds("1:26:10") == 5170
        assert _cue_text_to_seconds("2:00:00") == 7200

    def test_iso_duration_hour_format(self):
        """PT1H26M10S duration must parse to 5170 seconds and "1:26:10"."""
        html = """<html><body>
        <div class="tlpTog bItm tlpItem trRow1" data-trno="0" data-id="500" data-trackid="z">
          <div class="bPlay">
            <div id="cue_500" class="cue noWrap action mt5"></div>
          </div>
          <div class="bCont tl"><div itemprop="tracks" itemscope>
            <meta itemprop="name" content="Long Track">
            <meta itemprop="duration" content="PT1H26M10S">
          </div></div>
        </div>
        </body></html>"""
        result = parse_tracklist_detail(html)
        t = result.tracks[0]
        assert t.duration_seconds == 5170
        assert t.duration_text == "1:26:10"
