"""
DropDex-owned normalized models for ANLZ analysis data.

No pyrekordbox types appear in any field that crosses the importer boundary.
The private `_anlz_file` field on ParsedAnalysisAsset is the only place where
a pyrekordbox object is retained, and it is explicitly excluded from repr and
serialization.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class AnalysisParseWarning:
    """Structured diagnostic emitted during ANLZ parsing."""

    code: str
    """Short machine-readable code, e.g. TAG_UNSUPPORTED, SIBLING_MISSING, PARSE_ERROR."""
    asset_type: str
    """Which asset produced this warning: DAT | EXT | 2EX | BUNDLE."""
    message: str
    detail: Optional[str] = None
    """Optional extra context — tag code, exception message, path fragment."""

    def as_dict(self) -> dict:
        return {
            "code": self.code,
            "asset_type": self.asset_type,
            "message": self.message,
            "detail": self.detail,
        }


@dataclass
class ParsedAnalysisAsset:
    """
    Result of parsing one ANLZ file (.DAT, .EXT, or .2EX).

    Represents only DropDex-owned data.  The private _anlz_file field
    holds the pyrekordbox AnlzFile object for use by anlz_parser accessors
    (get_first_tag, get_all_tags, has_tag) within the importer layer only.
    It must never be returned to the API or serialized.

    No raw binary data is stored in this model.
    """

    asset_type: str
    """DAT | EXT | 2EX"""
    original_path: str
    """Path as it was given to the parser — preserved for display and diagnostics."""
    canonical_path: str
    """Normalized path for storage key derivation and cross-platform comparison."""
    sha256: Optional[str]
    """Hex SHA-256 of the file bytes, or None if hashing failed."""
    file_size: Optional[int]
    """File size in bytes, or None if stat failed."""
    tag_types: List[str]
    """Tag type codes successfully parsed by pyrekordbox, e.g. ['PQTZ', 'PCOB']."""
    unknown_tag_types: List[str]
    """Tag type codes present in the raw file but not in the known TAGS registry.
    Preserved here so future pipeline stages can decide how to handle them."""
    parse_status: str
    """completed | partial | failed"""
    parser_version: str
    """DROPDEX_ANLZ_PARSER_VERSION constant at time of parsing."""
    warnings: List[AnalysisParseWarning] = field(default_factory=list)
    # ── Private pyrekordbox object ──────────────────────────────────────────────
    _anlz_file: Optional[Any] = field(default=None, repr=False, compare=False)
    """pyrekordbox AnlzFile.  Private; do not access outside anlz_parser.py."""


@dataclass
class TrackAnalysisBundle:
    """
    Groups the up-to-three ANLZ files that belong to a single Rekordbox track.

    Overall status rules:
    - completed  — all provided assets parsed without error (warnings allowed)
    - partial    — at least one asset succeeded AND at least one failed/missing
                   (including DAT missing or failed, since DAT is primary)
    - failed     — no asset could be parsed at all
    """

    dat: Optional[ParsedAnalysisAsset]
    ext: Optional[ParsedAnalysisAsset]
    two_ex: Optional[ParsedAnalysisAsset]
    overall_status: str
    """completed | partial | failed"""
    warnings: List[AnalysisParseWarning] = field(default_factory=list)
    """Bundle-level warnings (e.g. sibling missing, conflict between siblings)."""

    @property
    def assets(self) -> List[ParsedAnalysisAsset]:
        return [a for a in (self.dat, self.ext, self.two_ex) if a is not None]


@dataclass
class AnalysisParseResult:
    """
    Top-level result covering parsed analysis data across multiple tracks.

    The `bundles` dict maps Rekordbox content_id (string) to the bundle for
    that track.  Keys absent from the dict mean no ANLZ files were attempted
    for that track.
    """

    parser_version: str
    bundles: Dict[str, TrackAnalysisBundle] = field(default_factory=dict)
    total_tracks: int = 0
    completed_count: int = 0
    partial_count: int = 0
    failed_count: int = 0
    warnings: List[AnalysisParseWarning] = field(default_factory=list)
    """Cross-bundle warnings (e.g. import-level path conflicts)."""
