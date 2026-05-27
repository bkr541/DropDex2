"""Validate a ParsedLibrary and produce warnings / errors."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import List, Optional

from .models import ParsedLibrary


@dataclass
class ValidationResult:
    track_count: int = 0
    playlist_count: int = 0
    placement_count: int = 0
    folder_count: int = 0
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return len(self.errors) == 0


def validate(
    library: ParsedLibrary,
    expected_tracks: Optional[int] = None,
    expected_playlists: Optional[int] = None,
    expected_placements: Optional[int] = None,
) -> ValidationResult:
    """
    Cross-check a ParsedLibrary for missing metadata and referential integrity.

    Optional expected_* parameters assert exact counts; mismatches become errors.
    Returns a ValidationResult; call .ok to check whether any hard errors were found.
    Warnings are informational and do not prevent import.
    """
    result = ValidationResult(
        track_count=len(library.tracks),
        playlist_count=len(library.playlists),
        placement_count=len(library.placements),
        folder_count=sum(1 for p in library.playlists if p.is_folder),
    )

    if result.track_count == 0:
        result.errors.append("No tracks found — is this a valid exportLibrary.db?")
        return result  # nothing more to check

    # ── Expected-count assertions ─────────────────────────────────────────────
    if expected_tracks is not None and result.track_count != expected_tracks:
        result.errors.append(
            f"Track count mismatch: expected {expected_tracks}, got {result.track_count}"
        )
    if expected_playlists is not None and result.playlist_count != expected_playlists:
        result.errors.append(
            f"Playlist count mismatch: expected {expected_playlists}, got {result.playlist_count}"
        )
    if expected_placements is not None and result.placement_count != expected_placements:
        result.errors.append(
            f"Placement count mismatch: expected {expected_placements}, got {result.placement_count}"
        )

    content_ids = {t.rekordbox_content_id for t in library.tracks}
    playlist_ids = {p.rekordbox_playlist_id for p in library.playlists}

    # ── Missing metadata warnings ─────────────────────────────────────────────
    missing_artist = sum(1 for t in library.tracks if not t.artist)
    missing_bpm = sum(1 for t in library.tracks if t.bpm is None)
    missing_key = sum(1 for t in library.tracks if t.musical_key is None)

    if missing_artist:
        pct = missing_artist * 100 // result.track_count
        result.warnings.append(
            f"{missing_artist} track(s) ({pct}%) have no artist"
        )
    if missing_bpm:
        pct = missing_bpm * 100 // result.track_count
        result.warnings.append(
            f"{missing_bpm} track(s) ({pct}%) have no BPM"
        )
    if missing_key:
        pct = missing_key * 100 // result.track_count
        result.warnings.append(
            f"{missing_key} track(s) ({pct}%) have no musical key"
        )

    # ── Referential integrity ─────────────────────────────────────────────────
    orphan_content = [
        pc for pc in library.placements if pc.rekordbox_content_id not in content_ids
    ]
    if orphan_content:
        result.errors.append(
            f"{len(orphan_content)} placement(s) reference unknown content IDs"
        )

    orphan_playlist = [
        pc for pc in library.placements if pc.rekordbox_playlist_id not in playlist_ids
    ]
    if orphan_playlist:
        result.errors.append(
            f"{len(orphan_playlist)} placement(s) reference unknown playlist IDs"
        )

    # ── Position collision check ──────────────────────────────────────────────
    # Detect duplicate (playlist_id, position) pairs in the source data.
    # The writer reassigns positions as gapless 1-based integers, so duplicates
    # in the source are handled gracefully, but we warn so they're visible.
    pos_map: dict[str, set[int]] = defaultdict(set)
    collisions = 0
    for pc in library.placements:
        key = pc.rekordbox_playlist_id
        if pc.position in pos_map[key]:
            collisions += 1
        pos_map[key].add(pc.position)
    if collisions:
        result.warnings.append(
            f"{collisions} duplicate source position(s) detected "
            "(writer will reassign positions to gapless 1-based integers)"
        )

    # ── Zero-track playlist retention check ──────────────────────────────────
    # Playlists with zero placements must still be inserted (they are valid).
    # We only warn here; the writer handles them as long as they are in the
    # playlists list.
    playlist_ids_with_placements = {pc.rekordbox_playlist_id for pc in library.placements}
    playable_no_tracks = [
        p
        for p in library.playlists
        if not p.is_folder and p.rekordbox_playlist_id not in playlist_ids_with_placements
    ]
    if playable_no_tracks:
        names = ", ".join(f"'{p.name}'" for p in playable_no_tracks[:5])
        extra = f" (and {len(playable_no_tracks) - 5} more)" if len(playable_no_tracks) > 5 else ""
        result.warnings.append(
            f"{len(playable_no_tracks)} playable playlist(s) with zero tracks: {names}{extra}"
        )

    # ── Track deduplication check ─────────────────────────────────────────────
    # Each content_id must appear at most once in the tracks list (one row per
    # unique track regardless of how many playlists reference it).
    seen_content_ids: set[str] = set()
    dup_content = 0
    for t in library.tracks:
        if t.rekordbox_content_id in seen_content_ids:
            dup_content += 1
        seen_content_ids.add(t.rekordbox_content_id)
    if dup_content:
        result.errors.append(
            f"{dup_content} duplicate rekordbox_content_id(s) in tracks list — "
            "Supabase unique constraint will reject the insert"
        )

    # ── Parent playlist references ────────────────────────────────────────────
    for p in library.playlists:
        if (
            p.parent_rekordbox_playlist_id
            and p.parent_rekordbox_playlist_id not in playlist_ids
        ):
            result.warnings.append(
                f"Playlist '{p.name}' has unknown parent ID "
                f"{p.parent_rekordbox_playlist_id}"
            )

    return result
