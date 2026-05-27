"""
Parser for 1001Tracklists rendered search-result pages.

Input:  full HTML string of a /search/result.php page (rendered, JS-executed).
Output: ParsedResultPage with a list of ParsedSetlistResult dataclasses.

Design rules:
- Never raise for a missing optional card field.
- Skip cards that lack source_tracklist_id, source_url, or title.
- All source-specific knowledge lives in selectors.py.
- No network access, no Supabase writes.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Optional

from selectolax.parser import HTMLParser

from . import selectors as S


# ── Output models ─────────────────────────────────────────────────────────────

@dataclass
class ParsedSetlistResult:
    source: str
    source_tracklist_id: str
    source_url: str
    title: str
    artwork_url: Optional[str] = None
    set_date: Optional[str] = None
    creator_username: Optional[str] = None
    creator_profile_url: Optional[str] = None
    ided_tracks: Optional[int] = None
    total_tracks: Optional[int] = None
    completion_pct: Optional[float] = None
    duration_text: Optional[str] = None
    duration_seconds: Optional[int] = None
    music_styles: list[str] = field(default_factory=list)
    views: Optional[int] = None
    likes: Optional[int] = None
    created_age_text: Optional[str] = None
    updated_age_text: Optional[str] = None
    listen_sources: list[str] = field(default_factory=list)
    raw_result_json: Optional[dict] = None


@dataclass
class ParsedResultPage:
    query_text: Optional[str] = None
    reported_total_results: Optional[int] = None
    current_page: Optional[int] = None
    has_next_page: bool = False
    next_page_number: Optional[int] = None
    results: list[ParsedSetlistResult] = field(default_factory=list)


# ── Public entry point ────────────────────────────────────────────────────────

def parse_result_page(html: str) -> ParsedResultPage:
    """Parse a full rendered 1001Tracklists search result page."""
    tree = HTMLParser(html)
    tl_data = _extract_tl_data(html)

    page = ParsedResultPage(
        query_text=_parse_query(tree),
        reported_total_results=_parse_total(tree),
        current_page=_parse_current_page(tree),
    )
    page.has_next_page, page.next_page_number = _parse_pagination(tree)

    for card_node in tree.css(S.CARD):
        result = _parse_card(card_node, tl_data)
        if result is not None:
            page.results.append(result)

    return page


# ── Page-level parsing ────────────────────────────────────────────────────────

def _parse_query(tree: HTMLParser) -> Optional[str]:
    # Try search input value first ("illenium")
    inp = tree.css_first(S.SEARCH_INPUT)
    if inp:
        val = (inp.attributes.get("value") or "").strip()
        if val:
            return val
    # Fall back: extract from header text "Tracklists search result for \"illenium\""
    hdr = tree.css_first(S.RESULT_HEADER)
    if hdr:
        m = re.search(r'for\s+"([^"]+)"', hdr.text(strip=True))
        if m:
            return m.group(1).strip()
    return None


def _parse_total(tree: HTMLParser) -> Optional[int]:
    badge = tree.css_first(S.RESULT_COUNT_BADGE)
    if badge:
        return _parse_int(badge.text(strip=True))
    return None


def _parse_current_page(tree: HTMLParser) -> Optional[int]:
    active = tree.css_first(S.PAGINATION_ACTIVE)
    if active:
        return _parse_int(active.text(strip=True))
    return None


def _parse_pagination(tree: HTMLParser) -> tuple[bool, Optional[int]]:
    """Return (has_next_page, next_page_number)."""
    for li in tree.css(S.PAGINATION_ITEMS):
        a = li.css_first("a")
        if a and a.text(strip=True) == "Next":
            classes = li.attributes.get("class") or ""
            if "disabled" not in classes:
                onclick = li.attributes.get("onclick") or ""
                m = S.PAGINATION_PAGE_RE.search(onclick)
                next_num = int(m.group(1)) if m else None
                return True, next_num
    return False, None


# ── Card parsing ──────────────────────────────────────────────────────────────

def _parse_card(card, tl_data: dict) -> Optional[ParsedSetlistResult]:
    """Parse one bItm card node.  Returns None if required fields are absent."""
    source_tracklist_id = (card.attributes.get("data-id") or "").strip()

    title_node = card.css_first(S.CARD_TITLE_LINK)
    raw_href  = (title_node.attributes.get("href") or "").strip() if title_node else ""
    raw_title = _clean(title_node.text(strip=True)) if title_node else ""

    # Require all three identity fields
    if not source_tracklist_id or not raw_href or not raw_title:
        return None

    source_url = _abs_url(raw_href)
    if not source_url:
        return None

    # ── artwork ───────────────────────────────────────────────────────────────
    art_node   = card.css_first(S.CARD_ARTWORK)
    artwork_url = _abs_url(
        (art_node.attributes.get("data-src") or "") if art_node else ""
    )

    # ── date ──────────────────────────────────────────────────────────────────
    date_node = card.css_first(S.CARD_DATE)
    set_date  = _parse_date(_node_text(date_node)) if date_node else None

    # ── creator ───────────────────────────────────────────────────────────────
    creator_node = card.css_first(S.CARD_CREATOR_LINK)
    creator_username    = _clean(creator_node.text(strip=True)) if creator_node else None
    creator_profile_url = _abs_url(
        (creator_node.attributes.get("href") or "") if creator_node else ""
    )

    # ── track counts ─────────────────────────────────────────────────────────
    tracks_node = card.css_first(S.CARD_TRACKS)
    ided, total = _parse_tracks(_node_text_compact(tracks_node)) if tracks_node else (None, None)
    completion_pct: Optional[float] = None
    if ided is not None and total is not None and total > 0:
        completion_pct = round(ided / total * 100, 2)

    # ── duration ──────────────────────────────────────────────────────────────
    dur_node       = card.css_first(S.CARD_DURATION)
    duration_text  = _node_text(dur_node) if dur_node else None
    duration_seconds = _parse_duration_secs(duration_text) if duration_text else None
    if duration_text == "":
        duration_text = None

    # ── music styles ──────────────────────────────────────────────────────────
    styles_node  = card.css_first(S.CARD_STYLES)
    music_styles = _parse_styles(_node_text(styles_node)) if styles_node else []

    # ── views (from data-count, confirmed by tlData.countRaw) ────────────────
    views_badge = card.css_first(S.CARD_VIEWS_BADGE)
    views: Optional[int] = None
    if views_badge:
        views = _parse_int(views_badge.attributes.get("data-count") or "")
    # prefer tlData.countRaw when available (real-time vs server-rendered)
    tl_entry = tl_data.get(source_tracklist_id, {})
    if tl_entry.get("countRaw") is not None:
        views = tl_entry["countRaw"]

    # ── likes (from tlData, not visible in card HTML) ─────────────────────────
    likes: Optional[int] = None
    raw_likes = tl_entry.get("likes")
    if raw_likes not in (None, 0, "0"):
        likes = _parse_int(str(raw_likes))

    # ── age text ──────────────────────────────────────────────────────────────
    created_node = card.css_first(S.CARD_CREATED_AGE)
    created_age  = _node_text(created_node) if created_node else None

    edited_node  = card.css_first(S.CARD_EDITED_AGE)
    updated_age  = _node_text(edited_node) if edited_node else None

    # ── listen sources ────────────────────────────────────────────────────────
    listen_sources: list[str] = []
    for icon in card.css(S.CARD_LISTEN_ICONS):
        title_attr = (icon.attributes.get("title") or "").strip()
        if title_attr.startswith("with "):
            label = (
                title_attr[5:]
                .replace(" links", "")
                .replace(" link", "")
                .replace(" video", "")
                .strip()
            )
            if label:
                listen_sources.append(label)

    raw_result_json = {
        "data_id": source_tracklist_id,
        "href": raw_href,
        "title_raw": raw_title,
        "artwork_data_src": (art_node.attributes.get("data-src") or None) if art_node else None,
        "date_raw": _node_text(date_node) if date_node else None,
        "creator_href": (creator_node.attributes.get("href") or None) if creator_node else None,
        "tracks_raw": _node_text_compact(tracks_node) if tracks_node else None,
        "duration_raw": _node_text(dur_node) if dur_node else None,
        "styles_raw": _node_text(styles_node) if styles_node else None,
        "tl_data": tl_entry,
    }

    return ParsedSetlistResult(
        source=S.SOURCE_NAME,
        source_tracklist_id=source_tracklist_id,
        source_url=source_url,
        title=raw_title,
        artwork_url=artwork_url,
        set_date=set_date,
        creator_username=creator_username,
        creator_profile_url=creator_profile_url,
        ided_tracks=ided,
        total_tracks=total,
        completion_pct=completion_pct,
        duration_text=duration_text,
        duration_seconds=duration_seconds,
        music_styles=music_styles,
        views=views,
        likes=likes,
        created_age_text=created_age,
        updated_age_text=updated_age,
        listen_sources=listen_sources,
        raw_result_json=raw_result_json,
    )


# ── Field helpers ─────────────────────────────────────────────────────────────

def _node_text(node) -> Optional[str]:
    """Return stripped, whitespace-normalized text from a selectolax node."""
    if node is None:
        return None
    raw = node.text(deep=True, strip=True, separator=" ")
    return re.sub(r"\s+", " ", raw).strip() or None


def _node_text_compact(node) -> Optional[str]:
    """Return text with ALL whitespace removed — used for track-count parsing."""
    if node is None:
        return None
    raw = node.text(deep=True, strip=True, separator="")
    return re.sub(r"\s+", "", raw) or None


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _abs_url(path: str) -> Optional[str]:
    """Convert a relative 1001Tracklists path to an absolute URL."""
    if not path:
        return None
    # Reject the lazy-load placeholder
    if path.startswith("/images/static/empty"):
        return None
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if path.startswith("/"):
        return S.BASE_URL + path
    return None


def _parse_date(text: Optional[str]) -> Optional[str]:
    """Return ISO date string if text matches YYYY-MM-DD, otherwise None."""
    if not text:
        return None
    stripped = text.strip()
    if S.ISO_DATE_RE.match(stripped):
        return stripped
    return None


def _parse_tracks(text: Optional[str]) -> tuple[Optional[int], Optional[int]]:
    """Return (ided_tracks, total_tracks) from compact track-count text."""
    if not text:
        return None, None
    m = S.TRACKS_ALL_RE.match(text)
    if m:
        total = int(m.group(1))
        return total, total
    m = S.TRACKS_RATIO_RE.match(text)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = S.TRACKS_TOTAL_RE.match(text)
    if m:
        return None, int(m.group(1))
    return None, None


def _parse_duration_secs(text: str) -> Optional[int]:
    """Parse "1h 31m" / "18m" / "1h" → total seconds, or None."""
    m = S.DURATION_RE.match(text.strip())
    if not m:
        return None
    hours   = int(m.group(1)) if m.group(1) else 0
    minutes = int(m.group(2)) if m.group(2) else 0
    if hours == 0 and minutes == 0:
        return None
    return hours * 3600 + minutes * 60


def _parse_styles(text: Optional[str]) -> list[str]:
    """Split comma-separated style string into a list of clean strings."""
    if not text:
        return []
    return [s.strip() for s in text.split(",") if s.strip()]


def _parse_int(text: str) -> Optional[int]:
    """Parse an integer string, stripping commas. Returns None on failure."""
    try:
        return int(str(text).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


def _extract_tl_data(html: str) -> dict:
    """Extract the inline tlData JS object → dict[tracklist_id → metadata]."""
    m = S.TL_DATA_JS_RE.search(html)
    if not m:
        return {}
    raw = m.group(1)
    # JS uses single-quoted keys: 'abc123': { … } → "abc123": { … }
    raw = S.TL_DATA_SQUOTE_RE.sub(r'"\1":', raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}
