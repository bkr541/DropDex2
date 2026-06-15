"""Normalized data models produced by the parser and consumed by the writer."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


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
class ParsedLibrary:
    tracks: List[NormalizedTrack] = field(default_factory=list)
    playlists: List[NormalizedPlaylist] = field(default_factory=list)
    placements: List[NormalizedPlacement] = field(default_factory=list)
    source_filename: str = ""
    device_name: Optional[str] = None
    database_version: Optional[str] = None
    rekordbox_created_date: Optional[str] = None
