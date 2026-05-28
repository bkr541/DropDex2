"""
Parser for 1001Tracklists setlist detail pages.

Input:  full HTML string of a /tracklist/<id>/<slug>.html page.
Output: ParsedTracklistDetail with an ordered list of ParsedTrackPosition
        dataclasses.

Design rules (same as parser.py):
- Never raise for a missing optional field.
- Return an empty tracks list when no .tlpItem rows are found.
- Never drop a position row just because optional metadata is absent.
- Preserve original set order exactly, including w/ layered rows.
- All source-specific HTML knowledge lives in detail_selectors.py.
- No network access, no Supabase writes.
"""

from __future__ import annotations

import html as _html_stdlib
import re
from dataclasses import dataclass, field
from typing import Optional

from selectolax.parser import HTMLParser

from . import detail_selectors as DS
from . import selectors as S  # shared constants (BASE_URL, SOURCE_NAME)


# ── Output models ─────────────────────────────────────────────────────────────

@dataclass
class ParsedTrackPosition:
    """One track position row from a setlist detail page."""
    source_position_id: str          # data-id on the tlpItem div
    source_track_id: Optional[str]   # data-trackid; None for unidentified tracks
    sequence_index: int              # data-trno (0-based, stable across re-scrapes)
    track_number: Optional[int]      # visible track number; None for w/ rows
    played_with_previous: bool       # True when class contains "con"

    cue_seconds: Optional[int]       # None when no visible cue; 0 only for "00:00"
    cue_text: Optional[str]          # Raw visible cue string; None when untimed

    title: Optional[str]
    artist_text: Optional[str]
    label_text: Optional[str]

    duration_seconds: Optional[int]  # None when duration absent
    duration_text: Optional[str]     # e.g. "3:49"; None when absent

    source_track_url: Optional[str]  # Absolute URL; None for unidentified tracks
    artwork_url: Optional[str]

    raw_track_json: Optional[dict]   # Preserved for debugging parser changes


@dataclass
class ParsedTracklistDetail:
    """Full result of parsing one setlist detail page."""
    source_numeric_tracklist_id: Optional[str]   # from input[name="id_tracklist"]
    title: Optional[str]                          # from <title>
    canonical_url: Optional[str]                  # from <link rel="canonical">
    declared_position_count: Optional[int]        # from input[name="tl_pos_count"]
    tracks: list[ParsedTrackPosition] = field(default_factory=list)
    has_timed_cues: bool = False
    raw_metadata_json: Optional[dict] = None


# ── Public entry point ────────────────────────────────────────────────────────

def parse_tracklist_detail(html: str) -> ParsedTracklistDetail:
    """Parse a full rendered 1001Tracklists setlist detail page."""
    tree = HTMLParser(html)

    detail = ParsedTracklistDetail(
        source_numeric_tracklist_id=_parse_tracklist_id(tree),
        title=_parse_title(tree),
        canonical_url=_parse_canonical_url(tree),
        declared_position_count=_parse_pos_count(tree),
    )

    for row_node in tree.css(DS.TRACK_ROW):
        position = _parse_track_row(row_node)
        if position is not None:
            detail.tracks.append(position)

    detail.has_timed_cues = any(
        t.cue_seconds is not None for t in detail.tracks
    )

    detail.raw_metadata_json = {
        "source_numeric_tracklist_id": detail.source_numeric_tracklist_id,
        "title": detail.title,
        "canonical_url": detail.canonical_url,
        "declared_position_count": detail.declared_position_count,
        "parsed_track_count": len(detail.tracks),
    }

    return detail


# ── Page-level parsing ────────────────────────────────────────────────────────

def _parse_title(tree: HTMLParser) -> Optional[str]:
    node = tree.css_first("title")
    if node:
        text = node.text(strip=True)
        return text or None
    return None


def _parse_canonical_url(tree: HTMLParser) -> Optional[str]:
    node = tree.css_first(DS.CANONICAL_URL)
    if node:
        href = (node.attributes.get("href") or "").strip()
        return href or None
    return None


def _parse_tracklist_id(tree: HTMLParser) -> Optional[str]:
    node = tree.css_first(DS.TRACKLIST_ID_INPUT)
    if node:
        val = (node.attributes.get("value") or "").strip()
        return val or None
    return None


def _parse_pos_count(tree: HTMLParser) -> Optional[int]:
    node = tree.css_first(DS.POS_COUNT_INPUT)
    if node:
        val = (node.attributes.get("value") or "").strip()
        return _parse_int(val)
    return None


# ── Track row parsing ─────────────────────────────────────────────────────────

def _parse_track_row(row) -> Optional[ParsedTrackPosition]:
    """
    Parse one .tlpItem div.  Returns None only if source_position_id is absent
    (which would make the row unidentifiable and unstorable).
    """
    source_position_id = (row.attributes.get("data-id") or "").strip()
    if not source_position_id:
        return None

    classes = row.attributes.get("class") or ""
    played_with_previous = DS.CON_CLASS in classes.split()

    raw_track_id = (row.attributes.get("data-trackid") or "").strip()
    source_track_id = raw_track_id or None

    try:
        sequence_index = int(row.attributes.get("data-trno") or 0)
    except (ValueError, TypeError):
        sequence_index = 0

    # ── Track number ──────────────────────────────────────────────────────────
    tn_span = row.css_first(DS.TRACKNUMBER_SPAN)
    track_number: Optional[int] = None
    if tn_span and not played_with_previous:
        tn_text = tn_span.text(strip=True)
        # Text is like "01 " or "01"; strip trailing spaces / non-numeric suffix
        tn_match = re.match(r"^(\d+)", tn_text)
        if tn_match:
            track_number = int(tn_match.group(1))

    # ── Cue time ──────────────────────────────────────────────────────────────
    cue_text, cue_seconds = _parse_cue(row, source_position_id)

    # ── Schema.org metadata ───────────────────────────────────────────────────
    title       = _meta_content(row, DS.META_NAME)
    artist_text = _meta_content(row, DS.META_ARTIST)
    label_text  = _parse_label(row)

    # ── Duration ──────────────────────────────────────────────────────────────
    duration_text, duration_seconds = _parse_duration(row)

    # ── Track URL ─────────────────────────────────────────────────────────────
    raw_url     = _meta_content(row, DS.META_URL)
    source_track_url = _abs_url(raw_url) if raw_url else None

    # ── Artwork ───────────────────────────────────────────────────────────────
    art_node    = row.css_first(DS.ARTWORK_IMG)
    artwork_url = _abs_url(
        (art_node.attributes.get("data-src") or "") if art_node else ""
    )

    raw_track_json = {
        "source_position_id":   source_position_id,
        "source_track_id":      source_track_id,
        "sequence_index":       sequence_index,
        "played_with_previous": played_with_previous,
        "cue_text":             cue_text,
        "title":                title,
        "artist_text":          artist_text,
        "duration_text":        duration_text,
        "source_track_url":     source_track_url,
        "artwork_url":          artwork_url,
    }

    return ParsedTrackPosition(
        source_position_id=source_position_id,
        source_track_id=source_track_id,
        sequence_index=sequence_index,
        track_number=track_number,
        played_with_previous=played_with_previous,
        cue_seconds=cue_seconds,
        cue_text=cue_text,
        title=title,
        artist_text=artist_text,
        label_text=label_text,
        duration_seconds=duration_seconds,
        duration_text=duration_text,
        source_track_url=source_track_url,
        artwork_url=artwork_url,
        raw_track_json=raw_track_json,
    )


# ── Field helpers ─────────────────────────────────────────────────────────────

def _meta_content(row, selector: str) -> Optional[str]:
    """Return the content= attribute of the first matching meta node, or None."""
    node = row.css_first(selector)
    if node:
        val = (node.attributes.get("content") or "").strip()
        # HTML entities in content attributes are already decoded by selectolax
        return val or None
    return None


def _parse_cue(row, source_position_id: str) -> tuple[Optional[str], Optional[int]]:
    """
    Return (cue_text, cue_seconds).

    Rules:
    - If the visible div.cue has non-empty text → parse it; it is authoritative.
    - If div.cue is empty → return (None, None); the hidden input is ignored.
    - cue_seconds == 0 only when visible text is explicitly "00:00".
    """
    cue_div = row.css_first(DS.CUE_DIV)
    if cue_div is None:
        return None, None

    visible = cue_div.text(strip=True)
    if not visible:
        return None, None

    return visible, _cue_text_to_seconds(visible)


def _cue_text_to_seconds(text: str) -> Optional[int]:
    """Convert "MM:SS" or "H:MM:SS" cue text to total seconds."""
    m = DS.CUE_HMMSS_RE.match(text)
    if m:
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
    m = DS.CUE_MMSS_RE.match(text)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    return None


def _parse_duration(row) -> tuple[Optional[str], Optional[int]]:
    """
    Return (duration_text, duration_seconds) from meta[itemprop="duration"].

    The meta value uses ISO 8601: PT3M49S, PT1H26M10S.
    We also derive a human-readable string ("3:49", "1:26:10").
    """
    meta_val = _meta_content(row, DS.META_DURATION)
    if not meta_val:
        return None, None

    m = DS.ISO_DURATION_RE.match(meta_val)
    if not m:
        return None, None

    hours   = int(m.group(1)) if m.group(1) else 0
    minutes = int(m.group(2)) if m.group(2) else 0
    seconds = int(m.group(3)) if m.group(3) else 0
    total   = hours * 3600 + minutes * 60 + seconds
    if total == 0:
        return None, None

    if hours:
        text = f"{hours}:{minutes:02d}:{seconds:02d}"
    else:
        text = f"{minutes}:{seconds:02d}"

    return text, total


def _parse_label(row) -> Optional[str]:
    """
    Extract label text from meta[itemprop="publisher"].

    The attribute value is HTML-encoded inner HTML, e.g.:
      &lt;span class="trackLabel"&gt;&lt;a href="..."&gt;REPUBLIC&lt;/a&gt;&lt;/span&gt;

    Steps:
    1. HTML-decode the attribute string.
    2. Find the .trackLabel span.
    3. Strip remaining HTML tags to get plain text.
    4. Collapse whitespace.
    """
    node = row.css_first(DS.META_PUBLISHER)
    if not node:
        return None
    raw = (node.attributes.get("content") or "").strip()
    if not raw:
        return None

    decoded = _html_stdlib.unescape(raw)
    m = DS.LABEL_SPAN_RE.search(decoded)
    if not m:
        return None

    inner = m.group(1)
    plain = DS.HTML_TAG_RE.sub(" ", inner)
    plain = re.sub(r"\s+", " ", plain).strip()
    return plain or None


def _abs_url(path: str) -> Optional[str]:
    """Convert a relative 1001Tracklists path to an absolute URL."""
    if not path:
        return None
    if path.startswith("/images/static/empty"):
        return None
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if path.startswith("/"):
        return S.BASE_URL + path
    return None


def _parse_int(text: str) -> Optional[int]:
    """Parse an integer string. Returns None on failure."""
    try:
        return int(str(text).replace(",", "").strip())
    except (ValueError, TypeError):
        return None
