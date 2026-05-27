"""
CSS selectors and parsing constants for 1001Tracklists search result pages.

All HTML-structure knowledge lives here so that a site change requires only
this file to be updated.  Parser logic stays in parser.py.
"""

import re

# ── Site constants ────────────────────────────────────────────────────────────

SOURCE_NAME = "1001tracklists"
BASE_URL    = "https://www.1001tracklists.com"

# ── Page-level ────────────────────────────────────────────────────────────────

# The results column; first .bItmH child contains query text + total count badge
RESULTS_COLUMN     = "#csMiddle"
RESULT_HEADER      = "#csMiddle .bItmH"

# <span class="badge spL">569</span> inside the first .bItmH
RESULT_COUNT_BADGE = "#csMiddle .bItmH .badge"

# Search query input pre-populated with the searched term
SEARCH_INPUT       = "#sBoxInput"

# ── Pagination ────────────────────────────────────────────────────────────────

PAGINATION       = "ul.pagination.bs"
PAGINATION_ITEMS = "ul.pagination.bs li"

# The active page number lives in the text of the <a> inside li.active
PAGINATION_ACTIVE = "ul.pagination.bs li.active a"

# onclick on a pagination <li> encodes the next page number, e.g.:
#   submitForm(this, { form: 'searchForm', page: 2, noAnker: true })
PAGINATION_PAGE_RE = re.compile(r"page:\s*(\d+)")

# ── Result card container ─────────────────────────────────────────────────────

# Each setlist result card:
#   <div class="bItm action oItm" data-id="<id>" onclick="...">
CARD = "div.bItm.action.oItm"

# ── Per-card selectors ────────────────────────────────────────────────────────

# Lazy-loaded artwork; actual URL is in data-src, src is always the placeholder
CARD_ARTWORK = "img.artM"

# Title + relative URL of the individual tracklist page
CARD_TITLE_LINK = ".bTitle a"

# views count badge — data-count holds the integer (already populated by JS)
CARD_VIEWS_BADGE = "div.badge.views"

# ISO date text (YYYY-MM-DD) follows the calendar icon
CARD_DATE = 'div[title="tracklist date"]'

# Creator link inside the creator div
CARD_CREATOR_LINK = 'div[title="creator"] a'

# Identified / total tracks — text like "all/19" or "53/54" or "/19"
CARD_TRACKS = 'div[title="IDed tracks / total tracks"]'

# Play-time text — "1h 31m", "18m", "1h"
CARD_DURATION = 'div[title="play time"]'

# Likes div; class="likes hidden" when likes are zero/unknown in initial HTML
# Populated from tlData JS; kept for future use
CARD_LIKES = 'div.likes'

# Comma-separated music style string follows the music icon
CARD_STYLES = 'div[title="musicstyle(s)"]'

# Creation age ("5 days ago") — noMob means hidden on narrow screens
CARD_CREATED_AGE = 'div.noMob[title="tracklist creation date"]'

# Last-edit age — only present on cards that have been edited
CARD_EDITED_AGE  = 'div.noMob[title="last edit"]'

# Listen-source icons: <i title="with podcast links">, <i title="with audio link">, …
CARD_LISTEN_ICONS = 'i[title^="with"]'

# ── Inline JS data ────────────────────────────────────────────────────────────

# tlData block holds countRaw (views), count (display), likes, userPoints per id:
#   let tlData = { 'abc123': { "countRaw": 89, "count": 89, "likes": "1", … }, … };
TL_DATA_JS_RE     = re.compile(r"let\s+tlData\s*=\s*(\{.*?\});", re.DOTALL)

# Single-quoted keys in the JS literal → double-quoted for JSON parsing
TL_DATA_SQUOTE_RE = re.compile(r"'([^']+)'\s*:")

# ── Field-parsing helpers ─────────────────────────────────────────────────────

# "1h 31m" → hours group, minutes group
DURATION_RE = re.compile(r"(?:(\d+)h)?\s*(?:(\d+)m)?")

# IDed/total variants:
#   "all/19"  → ided = total = 19
#   "53/54"   → ided = 53, total = 54
#   "/19"     → ided = None, total = 19
TRACKS_ALL_RE   = re.compile(r"^all/(\d+)$")
TRACKS_RATIO_RE = re.compile(r"^(\d+)/(\d+)$")
TRACKS_TOTAL_RE = re.compile(r"^/(\d+)$")

# ISO date strict check (pages already use YYYY-MM-DD)
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
