"""Tests for dropdex_importer.music_keys."""

from __future__ import annotations

import pytest

from dropdex_importer.music_keys import (
    KeyIdentity,
    key_to_camelot,
    normalize_key_name,
    parse_key_identity,
)


# ── Assertion helpers ──────────────────────────────────────────────────────────


def _expect(raw, camelot, tonic, mode, normalized):
    identity = parse_key_identity(raw)
    assert identity.parsed, f"Expected parsed=True for {raw!r}, got {identity}"
    assert identity.camelot_key == camelot, f"camelot_key mismatch for {raw!r}: {identity.camelot_key!r}"
    assert identity.key_tonic == tonic, f"key_tonic mismatch for {raw!r}: {identity.key_tonic!r}"
    assert identity.key_mode == mode, f"key_mode mismatch for {raw!r}: {identity.key_mode!r}"
    assert identity.normalized_key_name == normalized, f"normalized_key_name mismatch for {raw!r}: {identity.normalized_key_name!r}"


def _expect_unknown(raw):
    identity = parse_key_identity(raw)
    assert not identity.parsed, f"Expected parsed=False for {raw!r}, got {identity}"
    assert identity.camelot_key is None, f"camelot_key should be None for {raw!r}"
    assert identity.key_tonic is None, f"key_tonic should be None for {raw!r}"
    assert identity.key_mode is None, f"key_mode should be None for {raw!r}"
    assert identity.normalized_key_name is None, f"normalized_key_name should be None for {raw!r}"


# ── A minor variants ──────────────────────────────────────────────────────────


class TestAMinor:
    @pytest.mark.parametrize("raw", [
        "A minor",
        "A Minor",
        "A MINOR",
        "Amin",
        "A min",
        "Am",
        "a minor",
        "a min",
        "am",
        "  A  minor  ",
        "A   min",
        "AM",       # uppercase M treated as minor (DJ convention)
    ])
    def test_a_minor_variants(self, raw):
        _expect(raw, "8A", "A", "minor", "A minor")

    def test_camelot_8a_uppercase(self):
        _expect("8A", "8A", "A", "minor", "A minor")

    def test_camelot_8a_lowercase(self):
        _expect("8a", "8A", "A", "minor", "A minor")

    def test_camelot_8a_leading_trailing_whitespace(self):
        _expect("  8A  ", "8A", "A", "minor", "A minor")


# ── C major variants ──────────────────────────────────────────────────────────


class TestCMajor:
    @pytest.mark.parametrize("raw", [
        "C major",
        "C Major",
        "C MAJOR",
        "Cmaj",
        "C maj",
        "c major",
        "cmaj",
        "C MAJ",
    ])
    def test_c_major_variants(self, raw):
        _expect(raw, "8B", "C", "major", "C major")

    def test_camelot_8b_uppercase(self):
        _expect("8B", "8B", "C", "major", "C major")

    def test_camelot_8b_lowercase(self):
        _expect("8b", "8B", "C", "major", "C major")


# ── C# minor / Db minor variants ─────────────────────────────────────────────


class TestCSharpMinor:
    @pytest.mark.parametrize("raw", [
        "C# minor",
        "C# Minor",
        "C# MINOR",
        "C#m",
        "C#min",
        "C# min",
        "Db minor",
        "Db Minor",
        "Dbm",
        "Db min",
        "c# minor",
        "db minor",
        "C♯ minor",
        "D♭ minor",
        "D♭m",
        "C♯m",
        "C♯min",
    ])
    def test_csharp_dbflat_minor_variants(self, raw):
        _expect(raw, "12A", "C#", "minor", "C# minor")

    def test_camelot_12a_direct(self):
        _expect("12A", "12A", "C#", "minor", "C# minor")


# ── F# major / Gb major ───────────────────────────────────────────────────────


class TestFSharpMajor:
    @pytest.mark.parametrize("raw", [
        "F# major",
        "F# Major",
        "F#maj",
        "F# maj",
        "Gb major",
        "Gb Major",
        "Gbmaj",
        "Gb maj",
        "f# major",
        "gb major",
        "F♯ major",
        "G♭ major",
        "G♭maj",
        "F♯maj",
    ])
    def test_fsharp_gbflat_major_variants(self, raw):
        _expect(raw, "2B", "F#", "major", "F# major")

    def test_camelot_2b_direct(self):
        _expect("2B", "2B", "F#", "major", "F# major")


# ── All 24 Camelot values: direct code → fields ───────────────────────────────


_ALL_CAMELOT = [
    ("1A",  "Ab", "minor", "Ab minor"),
    ("2A",  "Eb", "minor", "Eb minor"),
    ("3A",  "Bb", "minor", "Bb minor"),
    ("4A",  "F",  "minor", "F minor"),
    ("5A",  "C",  "minor", "C minor"),
    ("6A",  "G",  "minor", "G minor"),
    ("7A",  "D",  "minor", "D minor"),
    ("8A",  "A",  "minor", "A minor"),
    ("9A",  "E",  "minor", "E minor"),
    ("10A", "B",  "minor", "B minor"),
    ("11A", "F#", "minor", "F# minor"),
    ("12A", "C#", "minor", "C# minor"),
    ("1B",  "B",  "major", "B major"),
    ("2B",  "F#", "major", "F# major"),
    ("3B",  "C#", "major", "C# major"),
    ("4B",  "Ab", "major", "Ab major"),
    ("5B",  "Eb", "major", "Eb major"),
    ("6B",  "Bb", "major", "Bb major"),
    ("7B",  "F",  "major", "F major"),
    ("8B",  "C",  "major", "C major"),
    ("9B",  "G",  "major", "G major"),
    ("10B", "D",  "major", "D major"),
    ("11B", "A",  "major", "A major"),
    ("12B", "E",  "major", "E major"),
]


@pytest.mark.parametrize("code,tonic,mode,name", _ALL_CAMELOT)
def test_all_camelot_direct(code, tonic, mode, name):
    _expect(code, code, tonic, mode, name)


@pytest.mark.parametrize("code,tonic,mode,name", _ALL_CAMELOT)
def test_all_camelot_normalized_name_round_trips(code, tonic, mode, name):
    """Each normalized name should parse back to the same Camelot code."""
    _expect(name, code, tonic, mode, name)


# ── Enharmonic equivalents ────────────────────────────────────────────────────


class TestEnharmonics:
    def test_ab_gsharp_minor(self):
        _expect("G# minor", "1A", "Ab", "minor", "Ab minor")
        _expect("G#m",      "1A", "Ab", "minor", "Ab minor")
        _expect("Ab minor", "1A", "Ab", "minor", "Ab minor")
        _expect("Abm",      "1A", "Ab", "minor", "Ab minor")

    def test_eb_dsharp_minor(self):
        _expect("D# minor", "2A", "Eb", "minor", "Eb minor")
        _expect("D#m",      "2A", "Eb", "minor", "Eb minor")
        _expect("Eb minor", "2A", "Eb", "minor", "Eb minor")

    def test_bb_asharp_minor(self):
        _expect("A# minor", "3A", "Bb", "minor", "Bb minor")
        _expect("A#m",      "3A", "Bb", "minor", "Bb minor")
        _expect("Bb minor", "3A", "Bb", "minor", "Bb minor")

    def test_b_cb_major(self):
        _expect("Cb major", "1B", "B", "major", "B major")
        _expect("B major",  "1B", "B", "major", "B major")

    def test_cs_db_major(self):
        _expect("C# major", "3B", "C#", "major", "C# major")
        _expect("Db major", "3B", "C#", "major", "C# major")
        _expect("Dbmaj",    "3B", "C#", "major", "C# major")

    def test_ab_gsharp_major(self):
        _expect("G# major", "4B", "Ab", "major", "Ab major")
        _expect("Ab major", "4B", "Ab", "major", "Ab major")

    def test_fsharp_gb_minor(self):
        _expect("Gb minor", "11A", "F#", "minor", "F# minor")
        _expect("F# minor", "11A", "F#", "minor", "F# minor")


# ── Unicode accidentals ───────────────────────────────────────────────────────


class TestUnicodeAccidentals:
    def test_sharp_minor(self):
        _expect("C♯ minor", "12A", "C#", "minor", "C# minor")
        _expect("F♯ major", "2B",  "F#", "major", "F# major")

    def test_flat_minor(self):
        _expect("D♭ minor", "12A", "C#", "minor", "C# minor")
        _expect("G♭ major", "2B",  "F#", "major", "F# major")
        _expect("A♭ minor", "1A",  "Ab", "minor", "Ab minor")

    def test_unicode_short_forms(self):
        _expect("A♭m",  "1A",  "Ab", "minor", "Ab minor")
        _expect("C♯m",  "12A", "C#", "minor", "C# minor")
        _expect("G♭maj","2B",  "F#", "major", "F# major")


# ── Case and whitespace normalisation ─────────────────────────────────────────


class TestCaseAndWhitespace:
    @pytest.mark.parametrize("raw", [
        "A MINOR",
        "a minor",
        "A Minor",
        "  A minor  ",
        "\tA minor\t",
        "A   minor",
    ])
    def test_a_minor_case_whitespace(self, raw):
        _expect(raw, "8A", "A", "minor", "A minor")

    @pytest.mark.parametrize("raw", [
        "C MAJOR",
        "c major",
        "C Major",
        "CMAJ",
        "  C  major  ",
    ])
    def test_c_major_case_whitespace(self, raw):
        _expect(raw, "8B", "C", "major", "C major")

    @pytest.mark.parametrize("raw", [
        "  12A  ",
        "12a",
        " 12a ",
        "12A",
    ])
    def test_camelot_whitespace(self, raw):
        _expect(raw, "12A", "C#", "minor", "C# minor")


# ── Invalid inputs ────────────────────────────────────────────────────────────


class TestInvalid:
    @pytest.mark.parametrize("raw", [
        "X",
        "Z major",
        "H minor",      # H is German notation, not supported
        "13A",          # out of range
        "2C",           # invalid Camelot suffix
        "0A",           # 0 is not a valid Camelot number
        "99B",
        "not a key",
        "C",            # note without mode is ambiguous
        "A",            # note without mode
        "F#",           # accidental without mode
    ])
    def test_invalid(self, raw):
        _expect_unknown(raw)


# ── Null and blank inputs ─────────────────────────────────────────────────────


class TestNullAndBlank:
    @pytest.mark.parametrize("raw", [
        None,
        "",
        "   ",
        "\t",
        "\n",
        "\r\n",
    ])
    def test_null_blank(self, raw):
        _expect_unknown(raw)

    def test_non_string_objects_do_not_raise(self):
        # parse_key_identity accepts any object and coerces via str()
        _expect_unknown(0)
        _expect_unknown(False)
        _expect_unknown([])


# ── Convenience function wrappers ─────────────────────────────────────────────


class TestConvenienceFunctions:
    def test_normalize_key_name_known(self):
        assert normalize_key_name("Am")      == "A minor"
        assert normalize_key_name("8A")      == "A minor"
        assert normalize_key_name("8B")      == "C major"
        assert normalize_key_name("C major") == "C major"
        assert normalize_key_name("Dbm")     == "C# minor"

    def test_normalize_key_name_unknown(self):
        assert normalize_key_name(None)      is None
        assert normalize_key_name("")        is None
        assert normalize_key_name("invalid") is None

    def test_key_to_camelot_known(self):
        assert key_to_camelot("A minor") == "8A"
        assert key_to_camelot("C major") == "8B"
        assert key_to_camelot("12A")     == "12A"
        assert key_to_camelot("Gb maj")  == "2B"

    def test_key_to_camelot_unknown(self):
        assert key_to_camelot(None)      is None
        assert key_to_camelot("")        is None
        assert key_to_camelot("invalid") is None


# ── KeyIdentity is frozen (immutable) ─────────────────────────────────────────


def test_key_identity_is_frozen():
    identity = parse_key_identity("Am")
    with pytest.raises((AttributeError, TypeError)):
        identity.camelot_key = "99Z"  # type: ignore[misc]


# ── Typical Rekordbox key strings ─────────────────────────────────────────────


class TestRekordboxKeyStrings:
    """
    Rekordbox stores key names in the key.name column using the format
    '<Note> <mode>' (e.g. 'A minor', 'Bb Major').  These tests verify the most
    common values pyrekordbox surfaces from exportLibrary.db.
    """

    @pytest.mark.parametrize("raw,camelot,tonic,mode", [
        ("A minor",   "8A",  "A",  "minor"),
        ("Bb minor",  "3A",  "Bb", "minor"),
        ("C major",   "8B",  "C",  "major"),
        ("F# minor",  "11A", "F#", "minor"),
        ("Gb major",  "2B",  "F#", "major"),
        ("Ab major",  "4B",  "Ab", "major"),
        ("B major",   "1B",  "B",  "major"),
        ("E major",   "12B", "E",  "major"),
        ("D minor",   "7A",  "D",  "minor"),
        ("G minor",   "6A",  "G",  "minor"),
    ])
    def test_rekordbox_format(self, raw, camelot, tonic, mode):
        identity = parse_key_identity(raw)
        assert identity.parsed
        assert identity.camelot_key == camelot
        assert identity.key_tonic == tonic
        assert identity.key_mode == mode
