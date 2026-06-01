"""
CSS selectors and parsing constants for 1001Tracklists setlist detail pages.

Covers /tracklist/<id>/<slug>.html pages, not the search-result pages handled
by selectors.py.  All HTML-structure knowledge lives here; parser logic stays
in detail_parser.py.
"""

import re

# ── Page-level metadata ────────────────────────────────────────────────────────

# Canonical URL of the setlist page.
CANONICAL_URL = 'link[rel="canonical"]'

# Hidden form inputs that expose the internal 1001Tracklists set identity.
# <input name="id_tracklist" value="639744" ...>
TRACKLIST_ID_INPUT   = 'input[name="id_tracklist"]'
# <input name="tl_pos_count" value="145" ...>
POS_COUNT_INPUT      = 'input[name="tl_pos_count"]'

# ── Track position rows ────────────────────────────────────────────────────────

# Each track position is a div with class "tlpItem".  Additional classes:
#   trRow<n>  — visual row grouping (primary colour band)
#   con       — this position is played simultaneously with the previous track
#               (displayed as "w/" in the DJ setlist)
TRACK_ROW = ".tlpItem"

# The "con" marker class that identifies a w/ layered track.
CON_CLASS = "con"

# ── Per-row selectors ─────────────────────────────────────────────────────────

# Hidden input that stores cue time in seconds.
# id pattern: tlp<data-id>_cue_seconds, e.g. tlp13679725_cue_seconds
# We match by attribute suffix so we do not need to know the id ahead of time.
CUE_SECONDS_INPUT = 'input[id$="_cue_seconds"]'

# Visible cue time display — non-empty text only when a cue is set.
# Examples: "00:10", "01:45", "46:50", "1:26:10"
# Empty string when the track has no confirmed cue time.
CUE_DIV = "div.cue"

# Track number / w/ indicator span.
# Text values: "01 ", "02 ", … for primary tracks; "w/ " for layered tracks.
TRACKNUMBER_SPAN = '[id$="_tracknumber_value"]'

# Artwork image — actual URL in data-src (lazy-loaded).
ARTWORK_IMG = "img.artM"

# Schema.org microdata inside .bCont: title, artist, duration, url, publisher.
META_NAME      = 'meta[itemprop="name"]'
META_ARTIST    = 'meta[itemprop="byArtist"]'
META_DURATION  = 'meta[itemprop="duration"]'
META_URL       = 'meta[itemprop="url"]'
META_PUBLISHER = 'meta[itemprop="publisher"]'

# ── Fallback / diagnostic selectors ──────────────────────────────────────────

# Checked when zero TRACK_ROW elements are found, to diagnose whether the page
# loaded at all and what DOM structure is present.
DIAGNOSTIC_SELECTORS: list[str] = [
    TRACK_ROW,                        # ".tlpItem"  — primary row container
    CUE_SECONDS_INPUT,                # 'input[id$="_cue_seconds"]'
    "[data-trackid]",                 # rows bearing an identified track ID
    "[data-trno]",                    # rows bearing a position sequence number
    TRACKNUMBER_SPAN,                 # '[id$="_tracknumber_value"]'
    'input[name="tl_pos_count"]',     # page-level declared track count
    '[id^="tlp_"]',                   # any element whose id starts with "tlp_"
]

# ── Parsing patterns ──────────────────────────────────────────────────────────

# ISO 8601 duration used in meta[itemprop="duration"]:  PT3M49S, PT1H26M10S
# Groups: hours (optional), minutes (optional), seconds (optional).
ISO_DURATION_RE = re.compile(
    r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$",
    re.IGNORECASE,
)

# Visible cue text formats:
#   MM:SS       — e.g. "00:10", "46:50"
#   H:MM:SS     — e.g. "1:26:10"
CUE_MMSS_RE   = re.compile(r"^(\d+):(\d{2})$")
CUE_HMMSS_RE  = re.compile(r"^(\d+):(\d{2}):(\d{2})$")

# Label text lives inside the HTML-encoded publisher meta value.
# After HTML-decoding the value, this matches the <span class="trackLabel …">
# block that wraps the label anchor(s).
LABEL_SPAN_RE = re.compile(
    r'class=["\']trackLabel[^"\']*["\'][^>]*>(.*?)</span>',
    re.DOTALL,
)

# Strip any remaining HTML tags from label text after extracting the span.
HTML_TAG_RE = re.compile(r"<[^>]+>")
