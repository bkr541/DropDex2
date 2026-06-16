"""
Tests for the ANLZ parsing foundation.

Unit tests mock AnlzFile.parse so they do not require a real USB device.
Binary fixture helpers build minimal but structurally valid ANLZ containers
so that the raw scanner and hash functions exercise real code paths.

Test sections
-------------
1.  Path normalization — Windows/macOS, drive letters, anchors, case
2.  Upload-root detection and normalize_upload_path
3.  Traversal and security rejection
4.  Sibling path derivation
5.  Storage key construction
6.  SHA-256 streaming hash
7.  Raw binary tag scanner (unknown code detection)
8.  parse_anlz_asset with mocked AnlzFile.parse
9.  Tag accessors (get_first_tag, get_all_tags, has_tag)
10. TrackAnalysisBundle overall_status from asset combinations
11. Corrupt-EXT-with-valid-DAT → partial
12. Unsupported 2EX tags → partial with TAG_UNSUPPORTED warning
13. Storage upload mocking
14. Structured warning serialization
"""

from __future__ import annotations

import hashlib
import struct
import tempfile
from pathlib import Path
from typing import Any, List, Optional
from unittest.mock import MagicMock, patch

import pytest

from dropdex_importer.analysis_models import AnalysisParseWarning, ParsedAnalysisAsset
from dropdex_importer.analysis_paths import (
    ROOT_PIONEER,
    ROOT_USBANLZ,
    ROOT_UNKNOWN,
    ROOT_USB,
    build_storage_path,
    derive_anlz_siblings,
    detect_upload_root,
    is_safe_path,
    is_safe_under,
    normalize_anlz_path,
    normalize_upload_path,
)
from dropdex_importer.anlz_parser import (
    DROPDEX_ANLZ_PARSER_VERSION,
    _hash_file_and_read,
    _scan_raw_tag_codes,
    get_all_tags,
    get_first_tag,
    has_tag,
    parse_anlz_asset,
    parse_track_analysis_bundle,
)
from dropdex_importer.analysis_storage import (
    DEFAULT_BUCKET,
    StorageUploadResult,
    upload_anlz_asset,
)


# ── Binary fixture helpers ────────────────────────────────────────────────────


def _pack_u32be(value: int) -> bytes:
    return struct.pack(">I", value)


def _make_anlz_file_header(len_file: int) -> bytes:
    """Build a minimal ANLZ file header (28 bytes, type=PMAI)."""
    len_header = 28
    return (
        b"PMAI"          # type  (4)
        + _pack_u32be(len_header)   # len_header (4)
        + _pack_u32be(len_file)     # len_file   (4)
        + b"\x00" * 16             # u1–u4 padding (16)
    )


def _make_anlz_tag(type_code: bytes, content: bytes = b"") -> bytes:
    """
    Build a minimal ANLZ tag block.

    Tag layout: type(4) + len_header(4) + len_tag(4) + content(...)
    len_header is set to 12 (the generic header size).
    """
    len_header = 12
    len_tag = len_header + len(content)
    return (
        type_code[:4].ljust(4, b"\x00")
        + _pack_u32be(len_header)
        + _pack_u32be(len_tag)
        + content
    )


def _make_anlz_bytes(*tag_defs: tuple[bytes, bytes]) -> bytes:
    """
    Build a complete ANLZ binary containing the given tags.

    Each element of tag_defs is (type_code_bytes, content_bytes).
    Returns a bytes object with a valid PMAI header + all tags.
    """
    tags_bytes = b"".join(_make_anlz_tag(tc, c) for tc, c in tag_defs)
    len_file = 28 + len(tags_bytes)
    header = _make_anlz_file_header(len_file)
    return header + tags_bytes


def _write_anlz_file(tmp_path: Path, filename: str, *tag_defs: tuple[bytes, bytes]) -> Path:
    """Write an ANLZ binary to a temp path and return its Path."""
    data = _make_anlz_bytes(*tag_defs)
    p = tmp_path / filename
    p.write_bytes(data)
    return p


def _write_bad_file(tmp_path: Path, filename: str, content: bytes = b"NOTANLZ!") -> Path:
    """Write a non-ANLZ file (wrong signature) to a temp path."""
    p = tmp_path / filename
    p.write_bytes(content)
    return p


def _make_mock_anlz_file(tag_types: List[str]) -> MagicMock:
    """
    Build a mock AnlzFile whose tag_types and [] operator behave realistically.
    Each tag type maps to a single mock tag object.
    """
    mock_tags: dict[str, MagicMock] = {}
    for tc in tag_types:
        tag = MagicMock()
        tag.type = tc
        mock_tags[tc] = tag

    anlz = MagicMock()
    anlz.tag_types = list(tag_types)

    def getitem(key):
        return [mock_tags[key]] if key in mock_tags else []

    anlz.__getitem__ = lambda self, key: getitem(key)
    anlz.__contains__ = lambda self, item: item in mock_tags
    return anlz


# ── 1. normalize_anlz_path (DB-sourced paths) ─────────────────────────────────


class TestNormalizeAnlzPath:
    def test_windows_path_stripped_to_pioneer(self):
        result = normalize_anlz_path("C:\\PIONEER\\USBANLZ\\P001\\ANLZ0000.DAT")
        assert result == "PIONEER/USBANLZ/P001/ANLZ0000.DAT"

    def test_windows_forward_slash_variant(self):
        result = normalize_anlz_path("C:/PIONEER/USBANLZ/P001/ANLZ0000.DAT")
        assert result == "PIONEER/USBANLZ/P001/ANLZ0000.DAT"

    def test_macos_absolute_path(self):
        result = normalize_anlz_path("/Volumes/USB/PIONEER/USBANLZ/P001/ANLZ0000.DAT")
        assert result == "PIONEER/USBANLZ/P001/ANLZ0000.DAT"

    def test_already_relative_pioneer_path(self):
        result = normalize_anlz_path("PIONEER/USBANLZ/P001/ANLZ0000.DAT")
        assert result == "PIONEER/USBANLZ/P001/ANLZ0000.DAT"

    def test_backslashes_converted(self):
        result = normalize_anlz_path("PIONEER\\USBANLZ\\P001\\ANLZ0000.EXT")
        assert result == "PIONEER/USBANLZ/P001/ANLZ0000.EXT"

    def test_duplicate_slashes_collapsed(self):
        result = normalize_anlz_path("PIONEER//USBANLZ//P001//ANLZ0000.DAT")
        assert result == "PIONEER/USBANLZ/P001/ANLZ0000.DAT"

    def test_lowercase_pioneer_preserved_as_anchor(self):
        # case-insensitive detection, original case kept from that index
        result = normalize_anlz_path("pioneer/USBANLZ/P001/ANLZ0000.DAT")
        assert result is not None
        assert result.lower().startswith("pioneer/")

    def test_case_insensitive_pioneer_detection(self):
        result = normalize_anlz_path("/media/usb/PiOnEeR/USBANLZ/P001/ANLZ0000.DAT")
        assert result is not None
        assert result.lower().startswith("pioneer/")

    def test_no_pioneer_but_usbanlz_prepends_pioneer(self):
        result = normalize_anlz_path("USBANLZ/P001/ANLZ0000.DAT")
        assert result is not None
        assert result.startswith("PIONEER/")
        assert "USBANLZ" in result

    def test_empty_returns_none(self):
        assert normalize_anlz_path("") is None

    def test_null_byte_returns_none(self):
        assert normalize_anlz_path("PIONEER\x00/USBANLZ/P001/ANLZ0000.DAT") is None

    def test_traversal_returns_none(self):
        assert normalize_anlz_path("PIONEER/../etc/passwd") is None

    def test_windows_traversal_returns_none(self):
        assert normalize_anlz_path("C:\\PIONEER\\..\\etc\\passwd") is None

    def test_lowercase_drive_letter_stripped(self):
        result = normalize_anlz_path("d:/PIONEER/USBANLZ/P001/ANLZ0000.2EX")
        assert result == "PIONEER/USBANLZ/P001/ANLZ0000.2EX"

    def test_leading_slash_drive_form(self):
        result = normalize_anlz_path("/E:/PIONEER/USBANLZ/P001/ANLZ0000.DAT")
        assert result == "PIONEER/USBANLZ/P001/ANLZ0000.DAT"


# ── 2. Upload-root detection and normalize_upload_path ────────────────────────


class TestDetectUploadRoot:
    def test_usb_root_detected(self):
        assert detect_upload_root("PIONEER/USBANLZ/P001/ANLZ0000.DAT") == ROOT_USB

    def test_pioneer_root_detected(self):
        assert detect_upload_root("USBANLZ/P001/ANLZ0000.DAT") == ROOT_PIONEER

    def test_usbanlz_root_detected(self):
        assert detect_upload_root("P001/ANLZ0000.DAT") == ROOT_USBANLZ

    def test_empty_returns_unknown(self):
        assert detect_upload_root("") == ROOT_UNKNOWN

    def test_case_insensitive_pioneer(self):
        assert detect_upload_root("pioneer/USBANLZ/P001/ANLZ0000.DAT") == ROOT_USB

    def test_case_insensitive_usbanlz(self):
        assert detect_upload_root("usbanlz/P001/ANLZ0000.DAT") == ROOT_PIONEER

    def test_windows_path_usb_root(self):
        assert detect_upload_root("PIONEER\\USBANLZ\\P001\\ANLZ0000.DAT") == ROOT_USB


class TestNormalizeUploadPath:
    def test_usb_root_hint_preserves_path(self):
        r = normalize_upload_path("PIONEER/USBANLZ/P001/ANLZ0000.DAT", ROOT_USB)
        assert r == "PIONEER/USBANLZ/P001/ANLZ0000.DAT"

    def test_pioneer_hint_prepends_pioneer(self):
        r = normalize_upload_path("USBANLZ/P001/ANLZ0000.DAT", ROOT_PIONEER)
        assert r == "PIONEER/USBANLZ/P001/ANLZ0000.DAT"

    def test_usbanlz_hint_prepends_pioneer_usbanlz(self):
        r = normalize_upload_path("P001/ANLZ0000.DAT", ROOT_USBANLZ)
        assert r == "PIONEER/USBANLZ/P001/ANLZ0000.DAT"

    def test_pioneer_already_present_overrides_hint(self):
        # Even with USBANLZ hint, if PIONEER is in the path anchor to it
        r = normalize_upload_path("PIONEER/USBANLZ/P001/ANLZ0000.DAT", ROOT_USBANLZ)
        assert r is not None
        assert r.lower().startswith("pioneer/")

    def test_traversal_rejected(self):
        assert normalize_upload_path("../etc/passwd", ROOT_USBANLZ) is None

    def test_null_byte_rejected(self):
        assert normalize_upload_path("P001/ANLZ\x000000.DAT", ROOT_USBANLZ) is None

    def test_windows_separators_normalized(self):
        r = normalize_upload_path("USBANLZ\\P001\\ANLZ0000.DAT", ROOT_PIONEER)
        assert r is not None
        assert "\\" not in r

    def test_full_roundtrip_usb_root_selection(self):
        paths = [
            "PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            "PIONEER/USBANLZ/P001/ANLZ0000.EXT",
        ]
        root = detect_upload_root(paths[0])
        assert root == ROOT_USB
        normalized = [normalize_upload_path(p, root) for p in paths]
        assert all(n is not None for n in normalized)
        assert normalized[0] == "PIONEER/USBANLZ/P001/ANLZ0000.DAT"

    def test_full_roundtrip_pioneer_selection(self):
        paths = [
            "USBANLZ/P001/ANLZ0000.DAT",
            "USBANLZ/P002/ANLZ0000.DAT",
        ]
        root = detect_upload_root(paths[0])
        assert root == ROOT_PIONEER
        normalized = [normalize_upload_path(p, root) for p in paths]
        assert all(n.startswith("PIONEER/USBANLZ") for n in normalized)  # type: ignore

    def test_full_roundtrip_usbanlz_selection(self):
        paths = [
            "P001/ANLZ0000.DAT",
            "P002/ANLZ0000.DAT",
        ]
        root = detect_upload_root(paths[0])
        assert root == ROOT_USBANLZ
        normalized = [normalize_upload_path(p, root) for p in paths]
        assert all(n.startswith("PIONEER/USBANLZ") for n in normalized)  # type: ignore


# ── 3. Security: traversal and is_safe_* ──────────────────────────────────────


class TestIsSafePath:
    def test_normal_path_is_safe(self):
        assert is_safe_path("PIONEER/USBANLZ/P001/ANLZ0000.DAT")

    def test_null_byte_rejected(self):
        assert not is_safe_path("PIONEER\x00/USBANLZ")

    def test_double_dot_rejected(self):
        assert not is_safe_path("PIONEER/../etc/passwd")

    def test_windows_traversal_rejected(self):
        assert not is_safe_path("PIONEER\\..\\etc\\passwd")

    def test_empty_string_rejected(self):
        assert not is_safe_path("")

    def test_percent_encoded_traversal_rejected(self):
        assert not is_safe_path("PIONEER/%2e%2e/etc/passwd")


class TestIsSafeUnder:
    def test_valid_subpath_safe(self, tmp_path):
        assert is_safe_under(str(tmp_path), "PIONEER/USBANLZ/P001/ANLZ0000.DAT")

    def test_traversal_escape_detected(self, tmp_path):
        # If somehow a traversal slipped through normalization
        assert not is_safe_under(str(tmp_path), "../outside_file.txt")


# ── 4. Sibling path derivation ────────────────────────────────────────────────


class TestDeriveAnlzSiblings:
    def test_dat_input_produces_all_three(self):
        dat, ext, two_ex = derive_anlz_siblings("PIONEER/USBANLZ/P001/ANLZ0000.DAT")
        assert dat == "PIONEER/USBANLZ/P001/ANLZ0000.DAT"
        assert ext == "PIONEER/USBANLZ/P001/ANLZ0000.EXT"
        assert two_ex == "PIONEER/USBANLZ/P001/ANLZ0000.2EX"

    def test_ext_input_corrects_to_dat(self):
        dat, ext, two_ex = derive_anlz_siblings("PIONEER/USBANLZ/P001/ANLZ0000.EXT")
        assert dat.endswith(".DAT")
        assert ext.endswith(".EXT")
        assert two_ex.endswith(".2EX")

    def test_2ex_input_corrects_to_dat(self):
        dat, _, _ = derive_anlz_siblings("PIONEER/USBANLZ/P001/ANLZ0000.2EX")
        assert dat.endswith(".DAT")

    def test_no_extension_treated_as_stem(self):
        dat, ext, two_ex = derive_anlz_siblings("PIONEER/USBANLZ/P001/ANLZ0000")
        assert dat.endswith(".DAT")
        assert ext.endswith(".EXT")
        assert two_ex.endswith(".2EX")

    def test_backslash_normalized_in_output(self):
        dat, ext, two_ex = derive_anlz_siblings("PIONEER\\USBANLZ\\P001\\ANLZ0000.DAT")
        assert "\\" not in dat
        assert "\\" not in ext
        assert "\\" not in two_ex

    def test_ext_and_2ex_not_required(self):
        # Spec: do not mark EXT or 2EX as required
        # (No assertion on required field here — that lives in AnalysisFileSpec in models.py)
        dat, ext, two_ex = derive_anlz_siblings("PIONEER/USBANLZ/P001/ANLZ0000.DAT")
        assert dat != ext
        assert ext != two_ex


# ── 5. Storage key construction ───────────────────────────────────────────────


_USER_ID = "user-uuid-1111-2222-3333-444444444444"
_IMPORT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


class TestBuildStoragePath:
    def test_deterministic_key(self):
        key = build_storage_path(
            _USER_ID,
            _IMPORT_ID,
            "PIONEER/USBANLZ/P001/ANLZ0000.DAT",
        )
        assert key == f"{_USER_ID}/{_IMPORT_ID}/anlz/PIONEER/USBANLZ/P001/ANLZ0000.DAT"

    def test_user_id_is_first_segment(self):
        key = build_storage_path(_USER_ID, _IMPORT_ID, "PIONEER/USBANLZ/P001/ANLZ0000.DAT")
        assert key.startswith(f"{_USER_ID}/")

    def test_leading_slash_in_canonical_stripped(self):
        key = build_storage_path(_USER_ID, "import-1", "/PIONEER/USBANLZ/P001/ANLZ0000.DAT")
        assert "/anlz//" not in key
        assert "PIONEER/USBANLZ" in key

    def test_different_imports_produce_different_keys(self):
        canonical = "PIONEER/USBANLZ/P001/ANLZ0000.DAT"
        k1 = build_storage_path(_USER_ID, "import-aaa", canonical)
        k2 = build_storage_path(_USER_ID, "import-bbb", canonical)
        assert k1 != k2

    def test_different_users_produce_different_keys(self):
        canonical = "PIONEER/USBANLZ/P001/ANLZ0000.DAT"
        k1 = build_storage_path("user-aaa", _IMPORT_ID, canonical)
        k2 = build_storage_path("user-bbb", _IMPORT_ID, canonical)
        assert k1 != k2

    def test_same_import_different_files_different_keys(self):
        k1 = build_storage_path(_USER_ID, _IMPORT_ID, "PIONEER/USBANLZ/P001/ANLZ0000.DAT")
        k2 = build_storage_path(_USER_ID, _IMPORT_ID, "PIONEER/USBANLZ/P001/ANLZ0000.EXT")
        assert k1 != k2

    def test_empty_canonical_raises(self):
        with pytest.raises(ValueError):
            build_storage_path(_USER_ID, _IMPORT_ID, "")


# ── 6. SHA-256 streaming hash ─────────────────────────────────────────────────


class TestHashFileAndRead:
    def test_hash_matches_hashlib_direct(self, tmp_path):
        data = b"PMAI" + b"\xAB" * 1024
        p = tmp_path / "test.DAT"
        p.write_bytes(data)
        hex_digest, file_bytes = _hash_file_and_read(p)
        expected = hashlib.sha256(data).hexdigest()
        assert hex_digest == expected

    def test_returns_correct_file_bytes(self, tmp_path):
        data = b"PMAI" + bytes(range(256))
        p = tmp_path / "test.DAT"
        p.write_bytes(data)
        _, file_bytes = _hash_file_and_read(p)
        assert file_bytes == data

    def test_empty_file(self, tmp_path):
        p = tmp_path / "empty.DAT"
        p.write_bytes(b"")
        hex_digest, file_bytes = _hash_file_and_read(p)
        assert hex_digest == hashlib.sha256(b"").hexdigest()
        assert file_bytes == b""

    def test_hash_is_deterministic(self, tmp_path):
        data = b"PMAI" + b"hello world" * 500
        p = tmp_path / "test.DAT"
        p.write_bytes(data)
        h1, _ = _hash_file_and_read(p)
        h2, _ = _hash_file_and_read(p)
        assert h1 == h2

    def test_different_content_different_hash(self, tmp_path):
        p1 = tmp_path / "a.DAT"
        p2 = tmp_path / "b.DAT"
        p1.write_bytes(b"PMAI" + b"\x00" * 100)
        p2.write_bytes(b"PMAI" + b"\x01" * 100)
        h1, _ = _hash_file_and_read(p1)
        h2, _ = _hash_file_and_read(p2)
        assert h1 != h2


# ── 7. Raw binary tag scanner ─────────────────────────────────────────────────


class TestScanRawTagCodes:
    def test_scans_known_tags(self):
        data = _make_anlz_bytes(
            (b"PQTZ", b""),
            (b"PCOB", b""),
            (b"PPTH", b""),
        )
        codes = _scan_raw_tag_codes(data)
        assert set(codes) == {"PQTZ", "PCOB", "PPTH"}

    def test_detects_unknown_tag_code(self):
        data = _make_anlz_bytes(
            (b"PQTZ", b""),
            (b"ZZZZ", b"extra_data"),  # unknown
        )
        codes = _scan_raw_tag_codes(data)
        assert "ZZZZ" in codes
        assert "PQTZ" in codes

    def test_wrong_signature_returns_empty(self):
        data = b"NOTANLZ!" + b"\x00" * 100
        assert _scan_raw_tag_codes(data) == []

    def test_too_short_returns_empty(self):
        assert _scan_raw_tag_codes(b"PMI") == []

    def test_empty_bytes_returns_empty(self):
        assert _scan_raw_tag_codes(b"") == []

    def test_no_tags_returns_empty_list(self):
        data = _make_anlz_bytes()  # header only
        codes = _scan_raw_tag_codes(data)
        assert codes == []


# ── 8. parse_anlz_asset with mocked AnlzFile ─────────────────────────────────


class TestParseAnlzAsset:
    def test_valid_dat_completed_status(self, tmp_path):
        p = _write_anlz_file(tmp_path, "ANLZ0000.DAT", (b"PQTZ", b""), (b"PPTH", b""))
        mock_anlz = _make_mock_anlz_file(["PQTZ", "PPTH"])

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            MockCls.parse.return_value = mock_anlz
            asset = parse_anlz_asset(str(p))

        assert asset.parse_status == "completed"
        assert asset.asset_type == "DAT"
        assert asset.sha256 is not None
        assert len(asset.sha256) == 64  # hex SHA-256
        assert asset.file_size == p.stat().st_size
        assert asset.parser_version == DROPDEX_ANLZ_PARSER_VERSION
        assert asset.tag_types == ["PQTZ", "PPTH"]
        assert asset.unknown_tag_types == []
        assert asset.warnings == []

    def test_valid_ext_completed_status(self, tmp_path):
        p = _write_anlz_file(tmp_path, "ANLZ0000.EXT", (b"PCO2", b""))
        mock_anlz = _make_mock_anlz_file(["PCO2"])

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            MockCls.parse.return_value = mock_anlz
            asset = parse_anlz_asset(str(p))

        assert asset.parse_status == "completed"
        assert asset.asset_type == "EXT"

    def test_invalid_signature_gives_failed(self, tmp_path):
        p = _write_bad_file(tmp_path, "ANLZ0000.DAT")
        asset = parse_anlz_asset(str(p))
        assert asset.parse_status == "failed"
        assert any(w.code == "INVALID_SIGNATURE" for w in asset.warnings)
        assert asset.sha256 is not None  # hash still computed

    def test_unsupported_extension_gives_failed(self, tmp_path):
        p = tmp_path / "somefile.MP3"
        p.write_bytes(b"ID3" + b"\x00" * 100)
        asset = parse_anlz_asset(str(p))
        assert asset.parse_status == "failed"
        assert any(w.code == "INVALID_EXTENSION" for w in asset.warnings)

    def test_pyrekordbox_parse_exception_gives_failed(self, tmp_path):
        p = _write_anlz_file(tmp_path, "ANLZ0000.DAT", (b"PQTZ", b""))

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            MockCls.parse.side_effect = Exception("Unexpected parse error")
            asset = parse_anlz_asset(str(p))

        assert asset.parse_status == "failed"
        assert any(w.code == "PARSE_ERROR" for w in asset.warnings)

    def test_pyrekordbox_assertion_error_gives_failed(self, tmp_path):
        p = _write_anlz_file(tmp_path, "ANLZ0000.DAT", (b"PQTZ", b""))

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            MockCls.parse.side_effect = AssertionError("PMAI mismatch")
            asset = parse_anlz_asset(str(p))

        assert asset.parse_status == "failed"
        assert any(w.code == "PARSE_ERROR" for w in asset.warnings)

    def test_original_path_and_canonical_path_present(self, tmp_path):
        p = _write_anlz_file(tmp_path, "ANLZ0000.DAT")
        mock_anlz = _make_mock_anlz_file([])

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            MockCls.parse.return_value = mock_anlz
            asset = parse_anlz_asset(str(p))

        assert asset.original_path == str(p)
        assert asset.canonical_path is not None

    def test_nonexistent_file_gives_failed(self, tmp_path):
        asset = parse_anlz_asset(str(tmp_path / "MISSING.DAT"))
        assert asset.parse_status == "failed"
        assert any(w.code in ("READ_ERROR", "INVALID_EXTENSION", "INVALID_SIGNATURE") for w in asset.warnings)

    def test_unknown_tags_in_file_partial_with_warning(self, tmp_path):
        # Build a file containing an unknown tag code ZZZZ
        data = _make_anlz_bytes(
            (b"PQTZ", b""),
            (b"ZZZZ", b""),  # unknown — will be caught by raw scanner
        )
        p = tmp_path / "ANLZ0000.DAT"
        p.write_bytes(data)
        mock_anlz = _make_mock_anlz_file(["PQTZ"])  # ZZZZ skipped by pyrekordbox

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            MockCls.parse.return_value = mock_anlz
            asset = parse_anlz_asset(str(p))

        assert asset.parse_status == "partial"
        assert "ZZZZ" in asset.unknown_tag_types
        assert any(w.code == "TAG_UNSUPPORTED" for w in asset.warnings)


# ── 9. Tag accessors ──────────────────────────────────────────────────────────


class TestTagAccessors:
    def _make_asset_with_file(self, tag_types: List[str]) -> ParsedAnalysisAsset:
        mock_anlz = _make_mock_anlz_file(tag_types)
        return ParsedAnalysisAsset(
            asset_type="DAT",
            original_path="/test/ANLZ0000.DAT",
            canonical_path="PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            sha256="abc123",
            file_size=100,
            tag_types=tag_types,
            unknown_tag_types=[],
            parse_status="completed",
            parser_version=DROPDEX_ANLZ_PARSER_VERSION,
            _anlz_file=mock_anlz,
        )

    def test_has_tag_true(self):
        asset = self._make_asset_with_file(["PQTZ", "PCOB"])
        assert has_tag(asset, "PQTZ") is True
        assert has_tag(asset, "PCOB") is True

    def test_has_tag_false(self):
        asset = self._make_asset_with_file(["PQTZ"])
        assert has_tag(asset, "PCO2") is False

    def test_has_tag_no_anlz_file(self):
        asset = ParsedAnalysisAsset(
            asset_type="DAT",
            original_path="/test/ANLZ0000.DAT",
            canonical_path="PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            sha256=None,
            file_size=None,
            tag_types=[],
            unknown_tag_types=[],
            parse_status="failed",
            parser_version=DROPDEX_ANLZ_PARSER_VERSION,
        )
        assert has_tag(asset, "PQTZ") is False

    def test_get_first_tag_returns_tag(self):
        asset = self._make_asset_with_file(["PQTZ"])
        tag = get_first_tag(asset, "PQTZ")
        assert tag is not None
        assert tag.type == "PQTZ"

    def test_get_first_tag_missing_returns_none(self):
        asset = self._make_asset_with_file(["PQTZ"])
        assert get_first_tag(asset, "PCO2") is None

    def test_get_first_tag_no_anlz_file(self):
        asset = ParsedAnalysisAsset(
            asset_type="DAT",
            original_path="/test/ANLZ0000.DAT",
            canonical_path="PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            sha256=None,
            file_size=None,
            tag_types=[],
            unknown_tag_types=[],
            parse_status="failed",
            parser_version=DROPDEX_ANLZ_PARSER_VERSION,
        )
        assert get_first_tag(asset, "PQTZ") is None

    def test_get_all_tags_single(self):
        asset = self._make_asset_with_file(["PQTZ"])
        tags = get_all_tags(asset, "PQTZ")
        assert len(tags) == 1
        assert tags[0].type == "PQTZ"

    def test_get_all_tags_missing_returns_empty(self):
        asset = self._make_asset_with_file(["PQTZ"])
        assert get_all_tags(asset, "PCOB") == []

    def test_get_all_tags_no_anlz_file_returns_empty(self):
        asset = ParsedAnalysisAsset(
            asset_type="DAT",
            original_path="/test/ANLZ0000.DAT",
            canonical_path="PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            sha256=None,
            file_size=None,
            tag_types=[],
            unknown_tag_types=[],
            parse_status="failed",
            parser_version=DROPDEX_ANLZ_PARSER_VERSION,
        )
        assert get_all_tags(asset, "PQTZ") == []


# ── 10. TrackAnalysisBundle overall_status ────────────────────────────────────


def _asset(status: str, asset_type: str = "DAT") -> ParsedAnalysisAsset:
    return ParsedAnalysisAsset(
        asset_type=asset_type,
        original_path=f"/test/ANLZ0000.{asset_type}",
        canonical_path=f"PIONEER/USBANLZ/P001/ANLZ0000.{asset_type}",
        sha256="abc",
        file_size=100,
        tag_types=[],
        unknown_tag_types=[],
        parse_status=status,
        parser_version=DROPDEX_ANLZ_PARSER_VERSION,
    )


class TestOverallStatus:
    def test_all_completed_is_completed(self, tmp_path):
        mock_anlz = _make_mock_anlz_file(["PQTZ"])

        def make_valid(filename, ext):
            p = _write_anlz_file(tmp_path, filename, (b"PQTZ", b""))
            return str(p)

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            MockCls.parse.return_value = mock_anlz
            bundle = parse_track_analysis_bundle(
                dat_path=make_valid("ANLZ0000.DAT", "DAT"),
                ext_path=make_valid("ANLZ0000.EXT", "EXT"),
            )
        assert bundle.overall_status == "completed"

    def test_dat_missing_is_partial_when_ext_valid(self, tmp_path):
        p_ext = _write_anlz_file(tmp_path, "ANLZ0000.EXT", (b"PCO2", b""))
        mock_anlz = _make_mock_anlz_file(["PCO2"])

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            MockCls.parse.return_value = mock_anlz
            bundle = parse_track_analysis_bundle(dat_path=None, ext_path=str(p_ext))

        assert bundle.overall_status == "partial"
        assert bundle.dat is None
        assert bundle.ext is not None

    def test_all_failed_is_failed(self, tmp_path):
        p_dat = _write_bad_file(tmp_path, "ANLZ0000.DAT")
        p_ext = _write_bad_file(tmp_path, "ANLZ0000.EXT")
        bundle = parse_track_analysis_bundle(
            dat_path=str(p_dat),
            ext_path=str(p_ext),
        )
        assert bundle.overall_status == "failed"

    def test_no_assets_provided_is_failed(self):
        bundle = parse_track_analysis_bundle()
        assert bundle.overall_status == "failed"


# ── 11. Corrupt EXT with valid DAT → partial ─────────────────────────────────


class TestCorruptExtValidDat:
    def test_corrupt_ext_partial_status(self, tmp_path):
        dat_path = _write_anlz_file(tmp_path, "ANLZ0000.DAT", (b"PQTZ", b""))
        ext_path = _write_bad_file(tmp_path, "ANLZ0000.EXT", b"CORRUPT")

        mock_anlz = _make_mock_anlz_file(["PQTZ"])

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            # Only DAT will actually reach AnlzFile.parse (EXT fails at signature check)
            MockCls.parse.return_value = mock_anlz
            bundle = parse_track_analysis_bundle(
                dat_path=str(dat_path),
                ext_path=str(ext_path),
            )

        assert bundle.overall_status == "partial"
        assert bundle.dat is not None
        assert bundle.dat.parse_status == "completed"
        assert bundle.ext is not None
        assert bundle.ext.parse_status == "failed"
        assert any(w.code == "INVALID_SIGNATURE" for w in bundle.ext.warnings)

    def test_dat_ok_ext_exception_partial(self, tmp_path):
        dat_path = _write_anlz_file(tmp_path, "ANLZ0000.DAT", (b"PQTZ", b""))
        ext_path = _write_anlz_file(tmp_path, "ANLZ0000.EXT", (b"PCO2", b""))

        mock_dat = _make_mock_anlz_file(["PQTZ"])

        call_count = [0]

        def side_effect(data):
            call_count[0] += 1
            if call_count[0] == 1:
                return mock_dat
            raise Exception("EXT parse exploded")

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            MockCls.parse.side_effect = side_effect
            bundle = parse_track_analysis_bundle(
                dat_path=str(dat_path),
                ext_path=str(ext_path),
            )

        assert bundle.overall_status == "partial"
        assert bundle.dat.parse_status == "completed"  # type: ignore
        assert bundle.ext.parse_status == "failed"     # type: ignore


# ── 12. Unsupported 2EX tags (partial with TAG_UNSUPPORTED warning) ───────────


class TestUnsupported2ExTags:
    def test_2ex_with_unknown_tag_partial(self, tmp_path):
        two_ex_path = tmp_path / "ANLZ0000.2EX"
        # Binary contains PWVC (known) + FUTX (unknown)
        data = _make_anlz_bytes(
            (b"PWVC", b""),
            (b"FUTX", b""),  # hypothetical future tag
        )
        two_ex_path.write_bytes(data)

        mock_anlz = _make_mock_anlz_file(["PWVC"])  # FUTX skipped by pyrekordbox

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            MockCls.parse.return_value = mock_anlz
            asset = parse_anlz_asset(str(two_ex_path))

        assert asset.parse_status == "partial"
        assert "FUTX" in asset.unknown_tag_types
        assert any(w.code == "TAG_UNSUPPORTED" for w in asset.warnings)
        assert "PWVC" in asset.tag_types

    def test_bundle_with_unknown_2ex_tag_partial(self, tmp_path):
        dat_path = _write_anlz_file(tmp_path, "ANLZ0000.DAT", (b"PQTZ", b""))
        two_ex_data = _make_anlz_bytes((b"PWVC", b""), (b"FUTX", b""))
        two_ex_path = tmp_path / "ANLZ0000.2EX"
        two_ex_path.write_bytes(two_ex_data)

        mock_dat = _make_mock_anlz_file(["PQTZ"])
        mock_2ex = _make_mock_anlz_file(["PWVC"])

        call_count = [0]

        def side_effect(data):
            call_count[0] += 1
            return mock_dat if call_count[0] == 1 else mock_2ex

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            MockCls.parse.side_effect = side_effect
            bundle = parse_track_analysis_bundle(
                dat_path=str(dat_path),
                two_ex_path=str(two_ex_path),
            )

        # DAT succeeded, 2EX partial (unknown tag) → bundle partial
        assert bundle.overall_status == "partial"
        assert bundle.dat.parse_status == "completed"  # type: ignore
        assert bundle.two_ex.parse_status == "partial"  # type: ignore

    def test_bundle_without_2ex_is_completed(self, tmp_path):
        dat_path = _write_anlz_file(tmp_path, "ANLZ0000.DAT", (b"PQTZ", b""))
        mock_anlz = _make_mock_anlz_file(["PQTZ"])

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            MockCls.parse.return_value = mock_anlz
            bundle = parse_track_analysis_bundle(dat_path=str(dat_path))

        assert bundle.overall_status == "completed"


# ── 13. Storage upload mocking ────────────────────────────────────────────────


class TestStorageUpload:
    def _make_sb_storage(self, existing: bool = False) -> MagicMock:
        """Build a minimal Supabase storage sub-client mock."""
        storage = MagicMock()
        # list() returns a non-empty list when an object exists, empty otherwise
        storage.from_.return_value.list.return_value = (
            [{"name": "ANLZ0000.DAT"}] if existing else []
        )
        storage.from_.return_value.upload.return_value = {"Key": "path/ANLZ0000.DAT"}
        return storage

    def test_successful_upload_returns_ok(self, tmp_path):
        p = tmp_path / "ANLZ0000.DAT"
        p.write_bytes(b"PMAI" + b"\x00" * 100)
        sha256 = hashlib.sha256(p.read_bytes()).hexdigest()

        sb_storage = self._make_sb_storage(existing=False)
        result = upload_anlz_asset(
            sb_storage, DEFAULT_BUCKET, "import-1/anlz/PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            str(p), sha256,
        )

        assert result.ok
        assert not result.was_skipped
        assert result.sha256 == sha256
        assert result.file_size == p.stat().st_size
        sb_storage.from_.return_value.upload.assert_called_once()

    def test_existing_object_skipped(self, tmp_path):
        p = tmp_path / "ANLZ0000.DAT"
        p.write_bytes(b"PMAI" + b"\x00" * 100)
        sha256 = hashlib.sha256(p.read_bytes()).hexdigest()

        sb_storage = self._make_sb_storage(existing=True)
        result = upload_anlz_asset(
            sb_storage, DEFAULT_BUCKET, "import-1/anlz/PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            str(p), sha256,
        )

        assert result.ok
        assert result.was_skipped
        sb_storage.from_.return_value.upload.assert_not_called()

    def test_upload_failure_captured_in_result(self, tmp_path):
        p = tmp_path / "ANLZ0000.DAT"
        p.write_bytes(b"PMAI" + b"\x00" * 100)
        sha256 = hashlib.sha256(p.read_bytes()).hexdigest()

        sb_storage = self._make_sb_storage(existing=False)
        sb_storage.from_.return_value.upload.side_effect = Exception("connection refused")

        result = upload_anlz_asset(
            sb_storage, DEFAULT_BUCKET, "import-1/anlz/PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            str(p), sha256,
        )

        assert not result.ok
        assert result.error is not None
        assert "connection refused" in result.error

    def test_missing_file_gives_error_result(self, tmp_path):
        sha256 = "a" * 64
        sb_storage = self._make_sb_storage()
        result = upload_anlz_asset(
            sb_storage, DEFAULT_BUCKET, "import-1/anlz/PIONEER/P001/ANLZ0000.DAT",
            str(tmp_path / "MISSING.DAT"), sha256,
        )
        assert not result.ok
        assert result.error is not None

    def test_allow_overwrite_skips_existence_check(self, tmp_path):
        p = tmp_path / "ANLZ0000.DAT"
        p.write_bytes(b"PMAI" + b"\x00" * 100)
        sha256 = hashlib.sha256(p.read_bytes()).hexdigest()

        sb_storage = self._make_sb_storage(existing=True)
        result = upload_anlz_asset(
            sb_storage, DEFAULT_BUCKET, "import-1/anlz/PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            str(p), sha256, allow_overwrite=True,
        )

        assert result.ok
        assert not result.was_skipped
        sb_storage.from_.return_value.upload.assert_called_once()

    def test_storage_path_is_deterministic(self):
        canonical = "PIONEER/USBANLZ/P001/ANLZ0000.DAT"
        k1 = build_storage_path(_USER_ID, "import-aaa", canonical)
        k2 = build_storage_path(_USER_ID, "import-aaa", canonical)
        assert k1 == k2


# ── 14. Structured warning serialization ──────────────────────────────────────


class TestWarningSerializaiton:
    def test_warning_as_dict_has_all_fields(self):
        w = AnalysisParseWarning(
            code="TAG_UNSUPPORTED",
            asset_type="2EX",
            message="Unrecognized tags found",
            detail="FUTX",
        )
        d = w.as_dict()
        assert d["code"] == "TAG_UNSUPPORTED"
        assert d["asset_type"] == "2EX"
        assert d["message"] == "Unrecognized tags found"
        assert d["detail"] == "FUTX"

    def test_warning_with_no_detail(self):
        w = AnalysisParseWarning(
            code="SIBLING_MISSING",
            asset_type="DAT",
            message="DAT not provided",
        )
        d = w.as_dict()
        assert d["detail"] is None

    def test_warnings_list_from_asset_is_json_compatible(self, tmp_path):
        """Verify warning objects are serializable via as_dict (no circular refs)."""
        import json

        p = _write_bad_file(tmp_path, "ANLZ0000.DAT")
        asset = parse_anlz_asset(str(p))
        serialized = [w.as_dict() for w in asset.warnings]
        json_str = json.dumps(serialized)
        parsed = json.loads(json_str)
        assert isinstance(parsed, list)
        assert all("code" in item for item in parsed)

    def test_parse_status_values_are_strings(self, tmp_path):
        p = _write_anlz_file(tmp_path, "ANLZ0000.DAT", (b"PQTZ", b""))
        mock_anlz = _make_mock_anlz_file(["PQTZ"])

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            MockCls.parse.return_value = mock_anlz
            asset = parse_anlz_asset(str(p))

        assert isinstance(asset.parse_status, str)
        assert asset.parse_status in ("completed", "partial", "failed")

    def test_parser_version_is_constant(self, tmp_path):
        p = _write_anlz_file(tmp_path, "ANLZ0000.DAT", (b"PQTZ", b""))
        mock_anlz = _make_mock_anlz_file(["PQTZ"])

        with patch("dropdex_importer.anlz_parser.AnlzFile") as MockCls:
            MockCls.parse.return_value = mock_anlz
            asset = parse_anlz_asset(str(p))

        assert asset.parser_version == DROPDEX_ANLZ_PARSER_VERSION
        assert isinstance(DROPDEX_ANLZ_PARSER_VERSION, str)
        assert "." in DROPDEX_ANLZ_PARSER_VERSION  # semver-like
