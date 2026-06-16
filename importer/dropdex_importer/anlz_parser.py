"""
Read-only ANLZ file parser for Rekordbox analysis files (.DAT, .EXT, .2EX).

Architecture
------------
- pyrekordbox's AnlzFile is the only external parser used.
- AnlzFile objects are contained in ParsedAnalysisAsset._anlz_file (private).
- Public accessors (get_first_tag, get_all_tags, has_tag) provide controlled
  access for downstream importer stages without leaking the pyrekordbox type.
- No write methods (build, save, set) are called on any pyrekordbox object.
- Parsing one sibling never affects another: each file is parsed independently.

Parser version
--------------
Increment DROPDEX_ANLZ_PARSER_VERSION whenever a change alters what tags are
extracted or how they are interpreted.  The version is stored on every
ParsedAnalysisAsset so database records can be reprocessed selectively.
"""

from __future__ import annotations

import hashlib
import logging
import struct as _struct
from pathlib import Path
from typing import Any, List, Optional, Tuple

from .analysis_models import (
    AnalysisParseWarning,
    ParsedAnalysisAsset,
    TrackAnalysisBundle,
)
from .analysis_paths import normalize_anlz_path

logger = logging.getLogger(__name__)

# Module-level import so tests can patch dropdex_importer.anlz_parser.AnlzFile.
# Deferred behind a try/except to avoid failing when pyrekordbox is absent
# (e.g. lightweight CI environments that only test path/model logic).
try:
    from pyrekordbox.anlz.file import AnlzFile
except ImportError:  # pragma: no cover
    AnlzFile = None  # type: ignore[assignment,misc]

# ── Parser version ────────────────────────────────────────────────────────────

DROPDEX_ANLZ_PARSER_VERSION = "1.0.0"

# Set of tag type codes the installed pyrekordbox can parse.
# Maintained in sync with pyrekordbox.anlz.tags.TAGS.  Listed here so we can
# detect unknown codes without importing the full pyrekordbox TAGS dict at
# module load time (pyrekordbox has heavy transitive imports).
_KNOWN_TAG_CODES = frozenset({
    "PQTZ", "PQT2",
    "PCOB", "PCO2",
    "PPTH",
    "PVBR",
    "PSSI",
    "PWAV", "PWV2", "PWV3", "PWV4", "PWV5", "PWV6", "PWV7", "PWVC",
})

# Valid ANLZ file extensions (uppercase)
_VALID_EXTENSIONS = frozenset({".DAT", ".EXT", ".2EX"})

# Expected PMAI signature at file header
_ANLZ_SIGNATURE = b"PMAI"

# Chunk size for streaming hash computation
_HASH_CHUNK = 65_536


# ── Public constants exposed to downstream stages ─────────────────────────────

#: Tag type codes that can appear in .DAT files
DAT_TAG_TYPES = frozenset({"PQTZ", "PCOB", "PPTH", "PVBR", "PWAV", "PWV2"})

#: Tag type codes that can appear in .EXT files
EXT_TAG_TYPES = frozenset({"PQT2", "PCO2", "PPTH", "PSSI", "PWAV", "PWV3", "PWV4", "PWV5"})

#: Tag type codes that can appear in .2EX files
TWO_EX_TAG_TYPES = frozenset({"PWV6", "PWV7", "PWVC"})


# ── Hashing ───────────────────────────────────────────────────────────────────


def _hash_file_and_read(path: Path) -> Tuple[str, bytes]:
    """
    Compute SHA-256 via streamed reads and return ``(hex_digest, file_bytes)``.

    The hash is updated incrementally in ``_HASH_CHUNK``-byte windows so that
    the hash operation itself never loads the full file as a single allocation.
    The accumulated chunks are joined once for the caller; ANLZ files are
    typically small (< 10 MB) so keeping the bytes is acceptable.
    """
    h = hashlib.sha256()
    chunks: List[bytes] = []
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(_HASH_CHUNK)
            if not chunk:
                break
            h.update(chunk)
            chunks.append(chunk)
    return h.hexdigest(), b"".join(chunks)


# ── Binary scanner for unknown tag codes ──────────────────────────────────────


def _scan_raw_tag_codes(data: bytes) -> List[str]:
    """
    Walk the raw ANLZ bytes and return every tag type code found, including
    those not present in pyrekordbox's TAGS registry.

    Uses ``struct.unpack_from`` directly (no pyrekordbox structs) so this
    scanner never fails because of an unhandled ``construct`` type.

    Returns an empty list if the file is not a valid ANLZ container.
    """
    if len(data) < 28:
        return []
    try:
        sig = data[0:4]
        if sig != _ANLZ_SIGNATURE:
            return []
        len_header = _struct.unpack_from(">I", data, 4)[0]
        len_file = _struct.unpack_from(">I", data, 8)[0]
    except _struct.error:
        return []

    codes: List[str] = []
    i = len_header
    while i + 12 <= len(data) and i < len_file:
        try:
            code = data[i : i + 4].decode("ascii")
            len_tag = _struct.unpack_from(">I", data, i + 8)[0]
        except (UnicodeDecodeError, _struct.error):
            break
        if len_tag < 12:
            break  # malformed tag — stop scanning
        codes.append(code)
        i += len_tag
    return codes


# ── Per-file parsing ──────────────────────────────────────────────────────────


def _parse_single_asset(
    file_path: Path,
    asset_type: str,
    original_path: str,
) -> ParsedAnalysisAsset:
    """
    Parse one ANLZ file and return a ``ParsedAnalysisAsset``.

    Failures are captured as structured warnings rather than exceptions;
    the ``parse_status`` field communicates what succeeded.

    This function is intentionally isolated per-asset so a corrupt sibling
    never discards the results for a valid sibling.
    """
    canonical = normalize_anlz_path(original_path) or original_path
    warnings: List[AnalysisParseWarning] = []

    # ── Validate extension ────────────────────────────────────────────────────
    ext = file_path.suffix.upper()
    if ext not in _VALID_EXTENSIONS:
        warnings.append(AnalysisParseWarning(
            code="INVALID_EXTENSION",
            asset_type=asset_type,
            message=f"File extension '{ext}' is not a valid ANLZ extension",
            detail=str(file_path),
        ))
        return ParsedAnalysisAsset(
            asset_type=asset_type,
            original_path=original_path,
            canonical_path=canonical,
            sha256=None,
            file_size=None,
            tag_types=[],
            unknown_tag_types=[],
            parse_status="failed",
            parser_version=DROPDEX_ANLZ_PARSER_VERSION,
            warnings=warnings,
        )

    # ── Hash + read ───────────────────────────────────────────────────────────
    sha256: Optional[str] = None
    file_size: Optional[int] = None
    file_bytes: Optional[bytes] = None
    try:
        sha256, file_bytes = _hash_file_and_read(file_path)
        file_size = len(file_bytes)
    except OSError as exc:
        warnings.append(AnalysisParseWarning(
            code="READ_ERROR",
            asset_type=asset_type,
            message=f"Could not read file: {exc}",
            detail=str(file_path),
        ))
        return ParsedAnalysisAsset(
            asset_type=asset_type,
            original_path=original_path,
            canonical_path=canonical,
            sha256=None,
            file_size=None,
            tag_types=[],
            unknown_tag_types=[],
            parse_status="failed",
            parser_version=DROPDEX_ANLZ_PARSER_VERSION,
            warnings=warnings,
        )

    # ── Signature check ───────────────────────────────────────────────────────
    if file_bytes[:4] != _ANLZ_SIGNATURE:
        warnings.append(AnalysisParseWarning(
            code="INVALID_SIGNATURE",
            asset_type=asset_type,
            message="File does not begin with PMAI signature",
            detail=f"Got {file_bytes[:4]!r}",
        ))
        return ParsedAnalysisAsset(
            asset_type=asset_type,
            original_path=original_path,
            canonical_path=canonical,
            sha256=sha256,
            file_size=file_size,
            tag_types=[],
            unknown_tag_types=[],
            parse_status="failed",
            parser_version=DROPDEX_ANLZ_PARSER_VERSION,
            warnings=warnings,
        )

    # ── Binary scan for all tag codes (before pyrekordbox parse) ─────────────
    all_raw_codes = _scan_raw_tag_codes(file_bytes)
    unknown_codes = [c for c in all_raw_codes if c not in _KNOWN_TAG_CODES]
    if unknown_codes:
        warnings.append(AnalysisParseWarning(
            code="TAG_UNSUPPORTED",
            asset_type=asset_type,
            message=f"File contains {len(unknown_codes)} unrecognized tag type(s)",
            detail=", ".join(unknown_codes),
        ))
        logger.info(
            "ANLZ %s %s: unknown tag codes: %s",
            asset_type, file_path.name, unknown_codes,
        )

    # ── pyrekordbox parse ─────────────────────────────────────────────────────
    anlz_file: Optional[Any] = None
    tag_types: List[str] = []
    parse_status = "completed"

    try:
        if AnlzFile is None:
            raise ImportError(
                "pyrekordbox is not installed; cannot parse ANLZ files"
            )
        anlz_file = AnlzFile.parse(file_bytes)
        tag_types = list(anlz_file.tag_types)

        logger.debug(
            "Parsed %s %s: %d tags %s",
            asset_type, file_path.name, len(tag_types), tag_types,
        )

    except AssertionError:
        # AnlzFile._parse raises AssertionError if the PMAI header check fails.
        # We already checked the signature above, so this means internal corruption.
        warnings.append(AnalysisParseWarning(
            code="PARSE_ERROR",
            asset_type=asset_type,
            message="pyrekordbox assertion failed during parse (PMAI header mismatch)",
            detail=str(file_path),
        ))
        parse_status = "failed"

    except Exception as exc:
        warnings.append(AnalysisParseWarning(
            code="PARSE_ERROR",
            asset_type=asset_type,
            message=f"Unexpected error during parse: {type(exc).__name__}: {exc}",
            detail=str(file_path),
        ))
        parse_status = "failed"

    # If there are unsupported tags but the file parsed, report partial rather
    # than completed so callers know some data was silently skipped.
    if parse_status == "completed" and unknown_codes:
        parse_status = "partial"

    return ParsedAnalysisAsset(
        asset_type=asset_type,
        original_path=original_path,
        canonical_path=canonical,
        sha256=sha256,
        file_size=file_size,
        tag_types=tag_types,
        unknown_tag_types=unknown_codes,
        parse_status=parse_status,
        parser_version=DROPDEX_ANLZ_PARSER_VERSION,
        warnings=warnings,
        _anlz_file=anlz_file,
    )


# ── Public API ────────────────────────────────────────────────────────────────


def parse_anlz_asset(path: str) -> ParsedAnalysisAsset:
    """
    Parse a single ANLZ file and return a ``ParsedAnalysisAsset``.

    Parameters
    ----------
    path:
        Absolute or relative filesystem path to the .DAT, .EXT, or .2EX file.

    Returns
    -------
    ParsedAnalysisAsset with ``parse_status`` indicating success.

    Raises
    ------
    Never.  All errors are captured as structured warnings in the returned model.
    """
    file_path = Path(path)
    ext = file_path.suffix.upper().lstrip(".")
    asset_type = ext if ext in ("DAT", "EXT", "2EX") else "UNKNOWN"
    return _parse_single_asset(file_path, asset_type, str(path))


def parse_track_analysis_bundle(
    dat_path: Optional[str] = None,
    ext_path: Optional[str] = None,
    two_ex_path: Optional[str] = None,
) -> TrackAnalysisBundle:
    """
    Parse up to three ANLZ siblings for one Rekordbox track.

    Each file is parsed independently so a corrupt sibling never discards
    valid results from another sibling.  EXT and 2EX are optional.

    Overall status rules
    --------------------
    - ``completed``  — all provided assets parsed without error (warnings OK)
    - ``partial``    — at least one asset succeeded AND one failed, or DAT
                       was missing or failed (DAT is the primary file)
    - ``failed``     — no asset could be parsed at all

    Parameters
    ----------
    dat_path, ext_path, two_ex_path:
        Absolute filesystem paths, or ``None`` to skip that sibling.
    """
    dat: Optional[ParsedAnalysisAsset] = None
    ext: Optional[ParsedAnalysisAsset] = None
    two_ex: Optional[ParsedAnalysisAsset] = None
    bundle_warnings: List[AnalysisParseWarning] = []

    if dat_path is not None:
        dat = _parse_single_asset(Path(dat_path), "DAT", dat_path)
    else:
        bundle_warnings.append(AnalysisParseWarning(
            code="SIBLING_MISSING",
            asset_type="DAT",
            message="DAT file was not provided (it is the primary ANLZ file)",
        ))

    if ext_path is not None:
        ext = _parse_single_asset(Path(ext_path), "EXT", ext_path)

    if two_ex_path is not None:
        two_ex = _parse_single_asset(Path(two_ex_path), "2EX", two_ex_path)

    overall_status = _compute_overall_status(dat, ext, two_ex)

    return TrackAnalysisBundle(
        dat=dat,
        ext=ext,
        two_ex=two_ex,
        overall_status=overall_status,
        warnings=bundle_warnings,
    )


def _compute_overall_status(
    dat: Optional[ParsedAnalysisAsset],
    ext: Optional[ParsedAnalysisAsset],
    two_ex: Optional[ParsedAnalysisAsset],
) -> str:
    """Determine bundle-level status from individual asset statuses."""
    assets = [a for a in (dat, ext, two_ex) if a is not None]

    if not assets:
        return "failed"

    succeeded = [a for a in assets if a.parse_status in ("completed", "partial")]
    failed = [a for a in assets if a.parse_status == "failed"]

    if not succeeded:
        return "failed"

    # DAT is primary: its absence or failure forces partial
    dat_missing = dat is None
    dat_failed = dat is not None and dat.parse_status == "failed"

    if dat_missing or dat_failed or failed:
        return "partial"

    # Any sibling with parse_status="partial" (e.g. unknown tags) pulls the bundle
    if any(a.parse_status == "partial" for a in assets):
        return "partial"

    return "completed"


# ── Tag accessors (controlled adapter pattern) ────────────────────────────────
#
# These return pyrekordbox AbstractAnlzTag objects, which is acceptable because:
# - They are called only from within the importer layer
# - The API layer (backend) never calls them
# - The JSON-facing fields on ParsedAnalysisAsset (tag_types, warnings) never
#   contain pyrekordbox objects


def get_first_tag(asset: ParsedAnalysisAsset, type_code: str) -> Optional[Any]:
    """
    Return the first pyrekordbox tag of the given type code, or ``None``.

    ``type_code`` must be a 4-character uppercase string, e.g. ``"PQTZ"``.

    For use by downstream importer stages (beat grid, waveform, cue
    reconciliation) that need raw tag data.  Do not call from API handlers.
    """
    if asset._anlz_file is None:
        return None
    matches = asset._anlz_file[type_code]
    return matches[0] if matches else None


def get_all_tags(asset: ParsedAnalysisAsset, type_code: str) -> List[Any]:
    """
    Return all pyrekordbox tags of the given type code as a list.

    Returns an empty list when no matching tags exist or when the asset
    failed to parse.
    """
    if asset._anlz_file is None:
        return []
    return list(asset._anlz_file[type_code])


def has_tag(asset: ParsedAnalysisAsset, type_code: str) -> bool:
    """
    Return True when the asset contains at least one tag of the given type.
    """
    if asset._anlz_file is None:
        return False
    return type_code in asset._anlz_file
