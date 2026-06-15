"""
Canonical musical-key normalization for Rekordbox tracks.

Converts any common key representation to a structured KeyIdentity containing
the Camelot wheel position, normalized name, tonic, and mode.

The import pipeline never fails on an unknown key — unrecognised formats produce
a KeyIdentity with parsed=False and are logged at WARNING level without exposing
the raw value in production log aggregation.

Supported input forms (examples all map to Camelot 8A / A minor):
  A minor, A Minor, A MINOR, Amin, A min, Am, a minor, 8A, 8a
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class KeyIdentity:
    """Structured result of key normalization. All fields are None when parsed=False."""

    camelot_key: Optional[str]           # e.g. "8A", "12B"
    key_tonic: Optional[str]             # e.g. "A", "F#", "Ab"
    key_mode: Optional[str]              # "major" or "minor"
    normalized_key_name: Optional[str]   # e.g. "A minor", "F# major"
    parsed: bool


_UNKNOWN: KeyIdentity = KeyIdentity(
    camelot_key=None,
    key_tonic=None,
    key_mode=None,
    normalized_key_name=None,
    parsed=False,
)


# ── Camelot wheel: (canonical_tonic, mode) → (camelot_key, normalized_name) ──

_CAMELOT_TABLE: dict[tuple[str, str], tuple[str, str]] = {
    # Minor keys (A-suffix on Camelot wheel)
    ("Ab", "minor"): ("1A",  "Ab minor"),
    ("Eb", "minor"): ("2A",  "Eb minor"),
    ("Bb", "minor"): ("3A",  "Bb minor"),
    ("F",  "minor"): ("4A",  "F minor"),
    ("C",  "minor"): ("5A",  "C minor"),
    ("G",  "minor"): ("6A",  "G minor"),
    ("D",  "minor"): ("7A",  "D minor"),
    ("A",  "minor"): ("8A",  "A minor"),
    ("E",  "minor"): ("9A",  "E minor"),
    ("B",  "minor"): ("10A", "B minor"),
    ("F#", "minor"): ("11A", "F# minor"),
    ("C#", "minor"): ("12A", "C# minor"),
    # Major keys (B-suffix on Camelot wheel)
    ("B",  "major"): ("1B",  "B major"),
    ("F#", "major"): ("2B",  "F# major"),
    ("C#", "major"): ("3B",  "C# major"),
    ("Ab", "major"): ("4B",  "Ab major"),
    ("Eb", "major"): ("5B",  "Eb major"),
    ("Bb", "major"): ("6B",  "Bb major"),
    ("F",  "major"): ("7B",  "F major"),
    ("C",  "major"): ("8B",  "C major"),
    ("G",  "major"): ("9B",  "G major"),
    ("D",  "major"): ("10B", "D major"),
    ("A",  "major"): ("11B", "A major"),
    ("E",  "major"): ("12B", "E major"),
}

# Reverse lookup: Camelot code (uppercase) → KeyIdentity
_CAMELOT_BY_CODE: dict[str, KeyIdentity] = {
    code: KeyIdentity(
        camelot_key=code,
        key_tonic=tonic,
        key_mode=mode,
        normalized_key_name=name,
        parsed=True,
    )
    for (tonic, mode), (code, name) in _CAMELOT_TABLE.items()
}

# Enharmonic aliases → canonical tonic used in _CAMELOT_TABLE.
# Canonical form: flats for Ab/Eb/Bb, sharps for F#/C#, naturals otherwise.
_ENHARMONIC: dict[str, str] = {
    "G#": "Ab",
    "D#": "Eb",
    "A#": "Bb",
    "Gb": "F#",
    "Db": "C#",
    "Cb": "B",   # Cb major → B major (1B)
    "Fb": "E",   # Fb major → E major (12B)
    "E#": "F",   # E# minor → F minor (4A)
    "B#": "C",   # B# minor → C minor (5A)
}


# ── Regex patterns ─────────────────────────────────────────────────────────────

# Camelot code: 1A–12B (case-insensitive). Must be the entire string (trimmed).
_RE_CAMELOT = re.compile(r"^\s*(1[0-2]|[1-9])([ab])\s*$", re.IGNORECASE)

# Note-based key: root letter + optional accidental + optional whitespace + mode.
# Handles: Am, A minor, A min, Amin, F#m, Dbm, Cmaj, Gb major, C♯ minor …
# The accidental character class includes 'b'/'B' (flat) and '#' (sharp).
# Unicode ♯/♭ are replaced with #/b before this regex runs.
_RE_NOTE_KEY = re.compile(
    r"^\s*"
    r"(?P<note>[A-G])"
    r"(?P<acc>[#b]?)"
    r"\s*"
    r"(?P<mode>major|minor|maj|min|m)?"
    r"\s*$",
    re.IGNORECASE,
)


# ── Internal helpers ───────────────────────────────────────────────────────────


def _replace_unicode_accidentals(s: str) -> str:
    return s.replace("♯", "#").replace("♭", "b")


def _canonical_tonic(note: str, acc: str) -> str:
    """Combine raw note + accidental and resolve enharmonic aliases."""
    tonic = note.upper() + acc.lower()   # acc.lower() converts 'B' flat → 'b'
    return _ENHARMONIC.get(tonic, tonic)


def _parse_mode(raw_mode: Optional[str]) -> Optional[str]:
    if not raw_mode:
        return None
    m = raw_mode.lower()
    if m in ("major", "maj"):
        return "major"
    if m in ("minor", "min", "m"):
        return "minor"
    return None


# ── Public API ─────────────────────────────────────────────────────────────────


def parse_key_identity(raw_key: object) -> KeyIdentity:
    """
    Parse any common key representation and return a KeyIdentity.

    Never raises. Returns _UNKNOWN (parsed=False, all other fields None) for
    null, blank, or unrecognised input. Unrecognised formats are logged at
    WARNING level; ambiguous-but-parseable notes with no mode are DEBUG.
    """
    if raw_key is None:
        return _UNKNOWN

    text = str(raw_key).strip()
    text = _replace_unicode_accidentals(text)

    if not text:
        return _UNKNOWN

    # ── 1. Camelot code  e.g. "8A", "12B" ────────────────────────────────────
    m = _RE_CAMELOT.match(text)
    if m:
        code = m.group(1) + m.group(2).upper()   # normalise letter to uppercase
        identity = _CAMELOT_BY_CODE.get(code)
        if identity:
            return identity
        logger.warning("Camelot code matched regex but missing from table: %r", code)
        return _UNKNOWN

    # ── 2. Note-based key  e.g. "Am", "A minor", "Cmaj" ──────────────────────
    m = _RE_NOTE_KEY.match(text)
    if m:
        note = m.group("note")
        acc  = m.group("acc") or ""
        mode = _parse_mode(m.group("mode"))

        if mode is None:
            # Note letter parsed but no mode — cannot determine Camelot position.
            logger.debug("Key has note but no mode, cannot normalize: %r", raw_key)
            return _UNKNOWN

        tonic = _canonical_tonic(note, acc)
        entry = _CAMELOT_TABLE.get((tonic, mode))
        if entry:
            camelot_code, normalized_name = entry
            return KeyIdentity(
                camelot_key=camelot_code,
                key_tonic=tonic,
                key_mode=mode,
                normalized_key_name=normalized_name,
                parsed=True,
            )

        # Valid Western note + mode but not in table — log for investigation.
        logger.warning(
            "Parsed key not found in Camelot table: tonic=%r mode=%r", tonic, mode
        )
        return _UNKNOWN

    # ── 3. Unrecognised ───────────────────────────────────────────────────────
    logger.warning("Unrecognised key format: %r", raw_key)
    return _UNKNOWN


def normalize_key_name(raw_key: object) -> Optional[str]:
    """Return the canonical key name (e.g. 'A minor', 'F# major') or None."""
    return parse_key_identity(raw_key).normalized_key_name


def key_to_camelot(raw_key: object) -> Optional[str]:
    """Return the Camelot wheel position (e.g. '8A', '2B') or None."""
    return parse_key_identity(raw_key).camelot_key
