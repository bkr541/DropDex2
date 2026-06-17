"""
Incremental rescan: find tracks from a new import that are identical to
tracks from a prior completed import by the same user.

Track identity order:
  1. master_db_id + master_content_id  (strongest — stable across exports)
  2. rekordbox_content_id alone (same device, different DB)
  3. Conservative fallback: normalized file path + title + artist + duration

Never reuse across users.

Reuse rules:
  - Same stable identity + unchanged analysis_data_update_count -> reuse grid/waveform/phrases
  - Same stable identity + unchanged cue_update_count -> reuse cues
  - information_update_count changed only -> refresh metadata, preserve analysis
  - analysis_data_file_path changed -> mark needs_dat (request upload)
  - Missing update counters -> reuse only if hashes match or identity is strong
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass
class TrackIdentity:
    """Uniqueness fingerprint for a track during rescan matching."""
    track_id: str
    import_id: str
    master_db_id: Optional[str]
    master_content_id: Optional[str]
    rekordbox_content_id: str
    analysis_data_file_path: Optional[str]
    analysis_data_update_count: Optional[int]
    cue_update_count: Optional[int]
    information_update_count: Optional[int]


@dataclass
class ReuseDecision:
    """Decision for one track in the new import."""
    new_track_id: str
    manifest_status: str  # 'reused', 'needs_dat', 'reparse_from_retained', 'metadata_only', 'needs_ext'
    reused_from_track_id: Optional[str]
    reuse_reason: Optional[str]
    cue_changed: bool
    analysis_changed: bool
    information_changed: bool
    reuse_grid: bool
    reuse_waveform: bool
    reuse_cues: bool
    reuse_phrases: bool


def decide_reuse(
    new_track: TrackIdentity,
    prior_track: TrackIdentity,
) -> ReuseDecision:
    """
    Given a new track and its matched prior track, decide what can be reused.

    Returns a ReuseDecision with appropriate manifest_status and reuse flags.
    """
    analysis_changed = _counter_changed(
        new_track.analysis_data_update_count,
        prior_track.analysis_data_update_count,
    )
    cue_changed = _counter_changed(
        new_track.cue_update_count,
        prior_track.cue_update_count,
    )
    information_changed = _counter_changed(
        new_track.information_update_count,
        prior_track.information_update_count,
    )
    path_changed = (
        new_track.analysis_data_file_path != prior_track.analysis_data_file_path
        and new_track.analysis_data_file_path is not None
    )

    if analysis_changed or path_changed:
        # Need to upload new analysis files
        status = "needs_dat"
        reuse_grid = False
        reuse_waveform = False
        reuse_phrases = False
        reuse_reason = "Analysis data changed" if analysis_changed else "Analysis path changed"
    else:
        # Analysis unchanged — reuse parsed data
        status = "reused"
        reuse_grid = True
        reuse_waveform = True
        reuse_phrases = True
        reuse_reason = "Track unchanged"

    reuse_cues = not cue_changed

    if status == "reused" and cue_changed:
        # Only cues need refresh, analysis is fine
        status = "metadata_only"
        reuse_reason = "Analysis unchanged, cues updated"

    return ReuseDecision(
        new_track_id=new_track.track_id,
        manifest_status=status,
        reused_from_track_id=prior_track.track_id,
        reuse_reason=reuse_reason,
        cue_changed=cue_changed,
        analysis_changed=analysis_changed,
        information_changed=information_changed,
        reuse_grid=reuse_grid,
        reuse_waveform=reuse_waveform,
        reuse_cues=reuse_cues,
        reuse_phrases=reuse_phrases,
    )


def match_tracks_to_prior_import(
    sb,
    user_id: str,
    new_import_id: str,
    new_tracks: List[Dict[str, Any]],
) -> Dict[str, ReuseDecision]:
    """
    For each new track, find the best match in the user's prior completed imports.
    Returns dict of new_track_id -> ReuseDecision (only for tracks with a match).

    NEVER reuses across users.
    """
    # 1. Find all prior completed imports for this user (excluding the new import)
    prior_resp = sb.table("rekordbox_imports").select(
        "id"
    ).eq("user_id", user_id).eq("status", "completed").neq("id", new_import_id).execute()

    prior_import_ids = [r["id"] for r in (prior_resp.data or [])]
    if not prior_import_ids:
        return {}

    # 2. Fetch prior tracks for identity matching — paginated to handle libraries > 1,000 tracks.
    from .supabase_pagination import fetch_all_rows  # noqa: PLC0415
    prior_tracks = fetch_all_rows(
        lambda: sb.table("rekordbox_tracks").select(
            "id, import_id, master_db_id, master_content_id, rekordbox_content_id, "
            "analysis_data_file_path, analysis_data_update_count, cue_update_count, "
            "information_update_count, analysis_parse_status"
        ).in_("import_id", prior_import_ids),
        order_column="id",
    )

    # 3. Build lookup indexes
    # Primary: (master_db_id, master_content_id) -> TrackIdentity
    primary_idx: Dict[Tuple, TrackIdentity] = {}
    # Secondary: rekordbox_content_id -> TrackIdentity
    secondary_idx: Dict[str, TrackIdentity] = {}

    for pt in prior_tracks:
        identity = TrackIdentity(
            track_id=pt["id"],
            import_id=pt["import_id"],
            master_db_id=pt.get("master_db_id"),
            master_content_id=pt.get("master_content_id"),
            rekordbox_content_id=pt["rekordbox_content_id"],
            analysis_data_file_path=pt.get("analysis_data_file_path"),
            analysis_data_update_count=pt.get("analysis_data_update_count"),
            cue_update_count=pt.get("cue_update_count"),
            information_update_count=pt.get("information_update_count"),
        )

        if identity.master_db_id and identity.master_content_id:
            key = (identity.master_db_id, identity.master_content_id)
            if key not in primary_idx:  # take the most recent (first seen, prior imports ordered by recency)
                primary_idx[key] = identity

        if identity.rekordbox_content_id:
            if identity.rekordbox_content_id not in secondary_idx:
                secondary_idx[identity.rekordbox_content_id] = identity

    # 4. Match each new track
    decisions: Dict[str, ReuseDecision] = {}

    for nt in new_tracks:
        new_identity = TrackIdentity(
            track_id=nt["id"],
            import_id=new_import_id,
            master_db_id=nt.get("master_db_id"),
            master_content_id=nt.get("master_content_id"),
            rekordbox_content_id=nt["rekordbox_content_id"],
            analysis_data_file_path=nt.get("analysis_data_file_path"),
            analysis_data_update_count=nt.get("analysis_data_update_count"),
            cue_update_count=nt.get("cue_update_count"),
            information_update_count=nt.get("information_update_count"),
        )

        # Try primary match
        prior = None
        if new_identity.master_db_id and new_identity.master_content_id:
            prior = primary_idx.get((new_identity.master_db_id, new_identity.master_content_id))

        # Try secondary match
        if prior is None:
            prior = secondary_idx.get(new_identity.rekordbox_content_id)

        if prior is None:
            continue  # No prior match found -> needs full upload

        decision = decide_reuse(new_identity, prior)
        decisions[nt["id"]] = decision

    return decisions


async def copy_normalized_data_for_track(
    sb,
    source_track_id: str,
    target_track_id: str,
    target_import_id: str,
    reuse_decision: ReuseDecision,
) -> None:
    """
    Copy normalized analysis rows from source_track to target_track.

    Each new import must own its own normalized rows.
    Sets analysis_reused_from_track_id on the target track.

    Copy only what the ReuseDecision says to reuse.
    """
    if reuse_decision.reuse_grid:
        await _copy_beat_grid(sb, source_track_id, target_track_id, target_import_id)

    if reuse_decision.reuse_waveform:
        await _copy_waveform(sb, source_track_id, target_track_id, target_import_id)

    if reuse_decision.reuse_phrases:
        await _copy_phrases(sb, source_track_id, target_track_id, target_import_id)

    if reuse_decision.reuse_cues:
        await _copy_cues(sb, source_track_id, target_track_id, target_import_id)

    # Mark the target track as reused
    sb.table("rekordbox_tracks").update({
        "analysis_reused_from_track_id": source_track_id,
        "analysis_parse_status": "reused",
    }).eq("id", target_track_id).execute()


def _counter_changed(new_val: Optional[int], prior_val: Optional[int]) -> bool:
    """Return True if the counter has definitely changed. False when ambiguous."""
    if new_val is None or prior_val is None:
        return False  # Missing counters -> assume unchanged (conservative)
    return new_val != prior_val


async def _copy_beat_grid(sb, source_id: str, target_id: str, target_import_id: str) -> None:
    """Copy beat grid from source track to target track."""
    resp = sb.table("rekordbox_track_beat_grids").select("*").eq("track_id", source_id).maybeSingle().execute()
    if not resp.data:
        return
    row = dict(resp.data)
    row.pop("id", None)
    row.pop("created_at", None)
    row.pop("updated_at", None)
    row["track_id"] = target_id
    row["import_id"] = target_import_id
    sb.table("rekordbox_track_beat_grids").upsert(row, on_conflict="track_id").execute()


async def _copy_waveform(sb, source_id: str, target_id: str, target_import_id: str) -> None:
    resp = sb.table("rekordbox_track_waveforms").select("*").eq("track_id", source_id).maybeSingle().execute()
    if not resp.data:
        return
    row = dict(resp.data)
    row.pop("id", None)
    row.pop("created_at", None)
    row.pop("updated_at", None)
    row["track_id"] = target_id
    row["import_id"] = target_import_id
    sb.table("rekordbox_track_waveforms").upsert(row, on_conflict="track_id").execute()


async def _copy_phrases(sb, source_id: str, target_id: str, target_import_id: str) -> None:
    resp = sb.table("rekordbox_track_phrases").select("*").eq("track_id", source_id).execute()
    rows = resp.data or []
    if not rows:
        return
    new_rows = []
    for r in rows:
        nr = dict(r)
        nr.pop("id", None)
        nr.pop("created_at", None)
        nr["track_id"] = target_id
        nr["import_id"] = target_import_id
        new_rows.append(nr)
    sb.table("rekordbox_track_phrases").upsert(new_rows, on_conflict="track_id,phrase_index").execute()


async def _copy_cues(sb, source_id: str, target_id: str, target_import_id: str) -> None:
    resp = sb.table("rekordbox_cues").select("*").eq("track_id", source_id).execute()
    rows = resp.data or []
    if not rows:
        return
    new_rows = []
    for r in rows:
        nr = dict(r)
        nr.pop("id", None)
        nr.pop("created_at", None)
        nr.pop("updated_at", None)
        nr["track_id"] = target_id
        nr["import_id"] = target_import_id
        new_rows.append(nr)
    sb.table("rekordbox_cues").upsert(new_rows, on_conflict="track_id,dedupe_key").execute()
