"""Pydantic response models for the DropDex API."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class PlaylistSummary(BaseModel):
    name: str
    track_count: int


class ImportResponse(BaseModel):
    import_id: str
    status: str
    source_filename: str
    track_count: int
    playlist_count: int
    playlist_track_count: int
    playlists: List[PlaylistSummary]
    # Analysis pipeline status — populated once analysis files are processed.
    # None when the import was created before analysis support was added.
    analysis_status: Optional[str] = None
    analysis_expected_track_count: int = 0
    analysis_matched_track_count: int = 0
    analysis_parsed_track_count: int = 0
    analysis_failed_track_count: int = 0
    analysis_asset_count: int = 0


# ── Staged analysis import models ─────────────────────────────────────────────


class ManifestEntryResponse(BaseModel):
    """One track's expected ANLZ analysis files."""

    track_id: str
    rekordbox_content_id: str
    dat_path: Optional[str] = None
    ext_path: Optional[str] = None
    two_ex_path: Optional[str] = None
    dat_required: bool = True
    # Incremental rescan fields (Part D / F)
    manifest_status: str = "needs_dat"  # reused | needs_dat | metadata_only | reparse_from_retained | needs_ext | needs_2ex | unavailable
    reused_from_track_id: Optional[str] = None
    reuse_reason: Optional[str] = None  # human-readable explanation
    cue_changed: bool = False
    analysis_changed: bool = False
    information_changed: bool = False


class ImportStartResponse(BaseModel):
    """Response for POST /api/rekordbox/import/start."""

    import_id: str
    analysis_status: str
    expected_track_count: int
    manifest: List[ManifestEntryResponse]
    # Reuse summary counts (Part D)
    tracks_reused: int = 0
    tracks_needing_upload: int = 0
    tracks_reparse_from_retained: int = 0
    tracks_metadata_only: int = 0


class BatchFileResult(BaseModel):
    """Per-file outcome within a batch upload."""

    canonical_path: str
    status: str  # received | already_received | rejected | error
    sha256: Optional[str] = None
    file_size: Optional[int] = None
    reject_reason: Optional[str] = None


class BatchUploadResponse(BaseModel):
    """Response for POST /api/rekordbox/import/{import_id}/analysis-batch."""

    import_id: str
    received_count: int
    already_received_count: int
    rejected_count: int
    error_count: int = 0
    received_bytes: int = 0
    files: List[BatchFileResult]


class TrackCompleteStatus(BaseModel):
    """Per-track outcome from the complete step."""

    track_id: str
    rekordbox_content_id: str
    parse_status: str  # completed | partial | failed | missing_required
    assets_parsed: int
    warnings: List[Dict[str, Any]] = []


class CompleteResponse(BaseModel):
    """Response for POST /api/rekordbox/import/{import_id}/complete."""

    import_id: str
    analysis_status: str
    total_tracks: int
    completed_count: int
    partial_count: int
    failed_count: int
    missing_required_count: int
    missing_optional_ext_count: int = 0
    missing_optional_2ex_count: int = 0
    parser_version: str
    tracks: List[TrackCompleteStatus]


class AnalysisStatusResponse(BaseModel):
    """Response for GET /api/rekordbox/import/{import_id}/analysis-status."""

    import_id: str
    analysis_status: str
    expected_track_count: int
    matched_track_count: int
    parsed_track_count: int
    failed_track_count: int
    asset_count: int
    missing_required_paths: List[str]
    missing_optional_ext: List[str] = []
    missing_optional_2ex: List[str] = []
    parser_version: Optional[str] = None
    warnings: List[Dict[str, Any]] = []


# ── Related Tracks import models ───────────────────────────────────────────────


class RelatedTrackMemberInput(BaseModel):
    master_content_id: str
    position: int
    source_payload: Dict[str, Any] = {}


class RelatedTrackListInput(BaseModel):
    source_list_id: str
    parent_source_list_id: Optional[str] = None
    name: str
    sort_order: Optional[int] = None
    is_folder: bool = False
    attribute: int = 0
    criteria_raw: Dict[str, Any] = {}
    members: List[RelatedTrackMemberInput] = []


class RelatedTracksPayload(BaseModel):
    schema_version: int
    generated_at: str
    source: Dict[str, Any] = {}
    lists: List[RelatedTrackListInput]


class RelatedTracksImportResponse(BaseModel):
    import_id: str
    lists_imported: int
    folders_imported: int
    members_imported: int
    unmatched_tracks: int
    ambiguous_tracks: int
    duplicate_records: int
    warnings: List[str]
