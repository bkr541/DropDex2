"""Normalized data models produced by the parser and consumed by the writer."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class NormalizedTrack:
    rekordbox_content_id: str
    title: str
    artist: Optional[str]
    album: Optional[str]
    remixer: Optional[str]
    genre: Optional[str]
    label: Optional[str]
    musical_key: Optional[str]
    bpm: Optional[float]
    duration_seconds: Optional[int]
    rating: Optional[int]
    comments: Optional[str]
    file_path: Optional[str]
    file_format: Optional[str]
    date_added: Optional[str]
    # Derived from musical_key via music_keys.parse_key_identity; None when unparseable
    camelot_key: Optional[str] = None
    normalized_key_name: Optional[str] = None
    key_tonic: Optional[str] = None
    key_mode: Optional[str] = None
    # Analysis pipeline fields — populated from Device Library Plus content row.
    # None when Rekordbox did not record the value.
    master_db_id: Optional[str] = None
    master_content_id: Optional[str] = None
    # Original path as stored by Rekordbox; normalization lives in the manifest.
    analysis_data_file_path: Optional[str] = None
    analysed_bits: Optional[int] = None
    cue_update_count: Optional[int] = None
    analysis_data_update_count: Optional[int] = None
    information_update_count: Optional[int] = None
    # Fidelity fields retained from Device Library Plus. Existing presentation
    # fields remain for compatibility while these preserve exact source values.
    source_title: Optional[str] = None
    subtitle: Optional[str] = None
    original_artist: Optional[str] = None
    composer: Optional[str] = None
    lyricist: Optional[str] = None
    duration_ms: Optional[int] = None
    track_number: Optional[int] = None
    disc_number: Optional[int] = None
    release_year: Optional[int] = None
    release_date: Optional[str] = None
    color_name: Optional[str] = None
    artwork_path: Optional[str] = None
    file_name: Optional[str] = None
    file_size_bytes: Optional[int] = None
    file_type_code: Optional[int] = None
    file_extension: Optional[str] = None
    bitrate_kbps: Optional[int] = None
    bit_depth: Optional[int] = None
    sample_rate_hz: Optional[int] = None
    isrc: Optional[str] = None
    hot_cue_auto_load: Optional[bool] = None
    file_path_normalized: Optional[str] = None
    file_path_volume: Optional[str] = None
    file_path_casefold: Optional[str] = None
    source_metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class NormalizedPlaylist:
    rekordbox_playlist_id: str
    name: str
    parent_rekordbox_playlist_id: Optional[str]
    sort_order: Optional[int]
    is_folder: bool


@dataclass
class NormalizedPlacement:
    rekordbox_playlist_id: str
    rekordbox_content_id: str
    # source sequenceNo — reassigned to gapless 1-based positions at write time
    position: int


@dataclass
class AnalysisFileSpec:
    """One expected or optional ANLZ file for a track."""

    asset_type: str           # 'DAT', 'EXT', or '2EX'
    original_path: str        # path as Rekordbox recorded it (backslash or forward)
    normalized_path: str      # forward-slash, no drive letter, no duplicate slashes
    is_required: bool         # True for DAT; False for EXT and 2EX


@dataclass
class NormalizedAnalysisManifestEntry:
    """Associates a Rekordbox content ID with its expected ANLZ analysis files."""

    rekordbox_content_id: str
    original_analysis_path: str   # raw analysisDataFilePath from the DB
    normalized_analysis_path: str  # normalized version for case-insensitive matching
    files: List[AnalysisFileSpec] = field(default_factory=list)


@dataclass
class NormalizedCue:
    """
    A cue point extracted from the Device Library Plus Cue table.

    cue_family and point_type are provisional classifications derived from the DB
    fields alone.  They will be reconciled against ANLZ data in a later pipeline stage.

    Hot-cue slot assignment is NOT determined here — the colorTableIndex is a color
    reference, not a slot index, and the actual slot (A–H) requires ANLZ parsing.
    """

    rekordbox_cue_id: str               # str(cue_id) from the Cue table PK
    rekordbox_content_id: str           # str(content_id) FK → Content
    kind: int                           # raw kind integer; 0=cue/fade, 3=load, 4=loop
    color_table_index: Optional[int]    # Cue.colorTableIndex; index into Color table
    cue_comment: Optional[str]
    is_active_loop: Optional[bool]
    beat_loop_numerator: Optional[int]
    beat_loop_denominator: Optional[int]
    in_usec: Optional[int]
    out_usec: Optional[int]
    in_150_frames_per_second: Optional[int]
    out_150_frames_per_second: Optional[int]
    in_mpeg_frame_number: Optional[int]
    out_mpeg_frame_number: Optional[int]
    in_mpeg_abs: Optional[int]
    out_mpeg_abs: Optional[int]
    in_decoding_start_frame_position: Optional[int]
    out_decoding_start_frame_position: Optional[int]
    in_file_offset_in_block: Optional[int]
    out_file_offset_in_block: Optional[int]
    in_number_of_sample_in_block: Optional[int]
    out_number_of_sample_in_block: Optional[int]
    # Derived / resolved fields
    color_name: Optional[str] = None   # looked up from Color table; None if unavailable
    # Provisional cue_family: 'hot' when colorTableIndex > 0, else 'memory'.
    # This will be confirmed or corrected when ANLZ data is available.
    cue_family: str = "memory"
    # point_type: 'loop' when kind == 4, else 'cue'.
    point_type: str = "cue"
    # hot_cue_slot: not determinable from DB alone; set to None until ANLZ parsed.
    hot_cue_slot: Optional[int] = None
    # Stable dedupe key; prefixed so ANLZ-sourced keys can use a different namespace.
    dedupe_key: str = ""


@dataclass
class NormalizedRecommendationEdge:
    """
    A Device Library Plus recommendedLike row, direction-preserved.

    content_id_1 becomes source, content_id_2 becomes target, exactly as stored.
    No sorting or symmetrization is performed.
    """

    source_rekordbox_content_id: str   # content_id_1
    target_rekordbox_content_id: str   # content_id_2
    rating: Optional[int]
    source_created_at: Optional[str]   # ISO-format string from createdDate
    direction_preserved: bool = True
    source_payload: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ParsedLibrary:
    tracks: List[NormalizedTrack] = field(default_factory=list)
    playlists: List[NormalizedPlaylist] = field(default_factory=list)
    placements: List[NormalizedPlacement] = field(default_factory=list)
    cues: List[NormalizedCue] = field(default_factory=list)
    recommendation_edges: List[NormalizedRecommendationEdge] = field(default_factory=list)
    analysis_manifest: List[NormalizedAnalysisManifestEntry] = field(default_factory=list)
    source_filename: str = ""
    device_name: Optional[str] = None
    database_version: Optional[str] = None
    rekordbox_created_date: Optional[str] = None
    # Warnings accumulated during optional-table extraction
    parse_warnings: List[str] = field(default_factory=list)
