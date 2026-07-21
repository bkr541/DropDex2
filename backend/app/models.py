"""Pydantic response models for the DropDex API."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class ImportJobCreateRequest(BaseModel):
    source_filename: str
    source_bundle_type: str
    device_name: str | None = None


class ImportJobResponse(BaseModel):
    import_id: str
    status: str
    source_filename: str
    source_bundle_type: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    retryable: bool = False


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


class CompleteRequest(BaseModel):
    """Optional body for POST /api/rekordbox/import/{import_id}/complete."""

    # When provided, only reparse these track IDs (selective reprocessing).
    # Omit or pass null/empty to reparse all tracks.
    affected_track_ids: Optional[List[str]] = None


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


class ResumeTargetItem(BaseModel):
    """One unresolved analysis target returned by /analysis-status."""

    track_id: str
    rekordbox_content_id: Optional[str] = None
    relative_path: str
    asset_type: str  # DAT | EXT | 2EX
    required: bool
    status: str  # missing | upload_failed | parse_failed | optional_missing
    reason: Optional[str] = None
    attempt_count: Optional[int] = None


class AnalysisStatusResponse(BaseModel):
    """Response for GET /api/rekordbox/import/{import_id}/analysis-status."""

    import_id: str
    analysis_status: str
    expected_track_count: int
    matched_track_count: int
    parsed_track_count: int
    failed_track_count: int
    asset_count: int
    # Legacy flat path arrays — preserved for backward compatibility.
    missing_required_paths: List[str]
    missing_optional_ext: List[str] = []
    missing_optional_2ex: List[str] = []
    parser_version: Optional[str] = None
    warnings: List[Dict[str, Any]] = []
    # Live parsing progress persisted on the import row so every worker and a
    # restarted backend reports the same state.
    current_track_id: Optional[str] = None
    current_track_title: Optional[str] = None
    current_track_artist: Optional[str] = None
    current_track_label: Optional[str] = None
    progress_percent: int = 0
    # Structured per-track targets (richer data for selective reprocessing).
    unresolved_targets: List[ResumeTargetItem] = []
    # Top-level summary counts derived from unresolved_targets.
    missing_required_count: int = 0
    missing_optional_count: int = 0
    failed_upload_count: int = 0
    failed_parse_count: int = 0
    affected_track_count: int = 0


# ── Related Tracks import models ───────────────────────────────────────────────


class RelatedTrackMemberInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    master_content_id: str = Field(validation_alias="masterContentId")
    position: int
    source_payload: Dict[str, Any] = Field(default_factory=dict, validation_alias="sourcePayload")


class RelatedTrackListInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source_list_id: str = Field(validation_alias="sourceListId")
    parent_source_list_id: Optional[str] = Field(
        default=None, validation_alias="parentSourceListId"
    )
    name: str
    sort_order: Optional[int] = Field(default=None, validation_alias="sortOrder")
    is_folder: bool = Field(default=False, validation_alias="isFolder")
    attribute: int = 0
    criteria_raw: Dict[str, Any] = Field(default_factory=dict, validation_alias="criteriaRaw")
    members: List[RelatedTrackMemberInput] = []


class RelatedTracksPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_version: int = Field(validation_alias="schemaVersion")
    generated_at: str = Field(validation_alias="generatedAt")
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
