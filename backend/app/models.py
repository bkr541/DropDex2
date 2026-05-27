"""Pydantic response models for the DropDex API."""

from typing import List

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
