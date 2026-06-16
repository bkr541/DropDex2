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

    # Forward any parse-time warnings from the library
    result.warnings.extend(library.parse_warnings)

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

    # ── Referential integrity — placements ────────────────────────────────────
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

    # ── Cue validation ────────────────────────────────────────────────────────
    _validate_cues(library, content_ids, result)

    # ── recommendedLike edge validation ──────────────────────────────────────
    _validate_recommendation_edges(library, content_ids, result)

    # ── Analysis manifest validation ──────────────────────────────────────────
    _validate_manifest(library, content_ids, result)

    return result


# ── Private validation helpers ────────────────────────────────────────────────


def _validate_cues(
    library: ParsedLibrary,
    content_ids: set[str],
    result: ValidationResult,
) -> None:
    """Validate cue referential integrity and detect duplicate cue IDs."""
    orphan_cues = [
        c for c in library.cues if c.rekordbox_content_id not in content_ids
    ]
    if orphan_cues:
        result.warnings.append(
            f"{len(orphan_cues)} cue(s) reference content IDs not in the track list "
            f"(e.g. cue_id={orphan_cues[0].rekordbox_cue_id}) — "
            "these cues will be skipped during write"
        )

    seen_cue_ids: set[str] = set()
    dup_cue_ids = 0
    for c in library.cues:
        if c.rekordbox_cue_id in seen_cue_ids:
            dup_cue_ids += 1
        seen_cue_ids.add(c.rekordbox_cue_id)
    if dup_cue_ids:
        result.warnings.append(
            f"{dup_cue_ids} duplicate cue ID(s) detected — "
            "later rows will be skipped or overwrite earlier ones"
        )


def _validate_recommendation_edges(
    library: ParsedLibrary,
    content_ids: set[str],
    result: ValidationResult,
) -> None:
    """Validate recommendation edges for orphans, duplicates, and self-references."""
    orphan_edges = [
        e
        for e in library.recommendation_edges
        if e.source_rekordbox_content_id not in content_ids
        or e.target_rekordbox_content_id not in content_ids
    ]
    if orphan_edges:
        result.warnings.append(
            f"{len(orphan_edges)} recommendation edge(s) reference content IDs "
            "not in the track list — these edges will be skipped during write"
        )

    self_edges = [
        e
        for e in library.recommendation_edges
        if e.source_rekordbox_content_id == e.target_rekordbox_content_id
    ]
    if self_edges:
        result.warnings.append(
            f"{len(self_edges)} self-referencing recommendation edge(s) detected "
            f"(e.g. content_id={self_edges[0].source_rekordbox_content_id})"
        )

    seen_pairs: set[tuple[str, str]] = set()
    dup_pairs = 0
    for e in library.recommendation_edges:
        pair = (e.source_rekordbox_content_id, e.target_rekordbox_content_id)
        if pair in seen_pairs:
            dup_pairs += 1
        seen_pairs.add(pair)
    if dup_pairs:
        result.warnings.append(
            f"{dup_pairs} duplicate recommendation pair(s) detected"
        )


def _validate_manifest(
    library: ParsedLibrary,
    content_ids: set[str],
    result: ValidationResult,
) -> None:
    """Validate that manifest entries resolve to known tracks.

    Missing analysis paths are always warnings, not errors — a metadata-only
    import remains fully valid even if no ANLZ files are present.
    """
    orphan_manifest = [
        e
        for e in library.analysis_manifest
        if e.rekordbox_content_id not in content_ids
    ]
    if orphan_manifest:
        result.warnings.append(
            f"{len(orphan_manifest)} analysis manifest entry/entries reference "
            "content IDs not in the track list"
        )

    tracks_without_analysis = sum(
        1 for t in library.tracks if not t.analysis_data_file_path
    )
    if tracks_without_analysis:
        pct = tracks_without_analysis * 100 // max(len(library.tracks), 1)
        result.warnings.append(
            f"{tracks_without_analysis} track(s) ({pct}%) have no analysis data path — "
            "analysis files cannot be uploaded for these tracks"
        )
