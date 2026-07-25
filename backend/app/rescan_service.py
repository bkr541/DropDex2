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
    parser_version: Optional[str] = None
    feature_schema_version: Optional[str] = None
    retained_source_available: bool = False


@dataclass
class ReuseDecision:
    """Decision for one track in the new import."""

    new_track_id: str
    manifest_status: (
        str  # 'reused', 'needs_dat', 'reparse_from_retained', 'metadata_only', 'needs_ext'
    )
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
    *,
    parser_version: Optional[str] = None,
    feature_schema_version: Optional[str] = None,
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
    parser_changed = bool(
        parser_version
        and prior_track.parser_version
        and parser_version != prior_track.parser_version
    )
    schema_changed = bool(
        feature_schema_version
        and prior_track.feature_schema_version
        and feature_schema_version != prior_track.feature_schema_version
    )

    if analysis_changed or path_changed:
        # Need to upload new analysis files
        status = "needs_dat"
        reuse_grid = False
        reuse_waveform = False
        reuse_phrases = False
        reuse_reason = "Analysis data changed" if analysis_changed else "Analysis path changed"
    elif parser_changed or schema_changed:
        # A retained DAT/EXT source lets a new parser/schema run without asking
        # the DJ to reconnect the USB. Legacy rows with no recorded version are
        # treated as compatible so the migration does not force a full reparse.
        status = "reparse_from_retained" if prior_track.retained_source_available else "needs_dat"
        reuse_grid = False
        reuse_waveform = False
        reuse_phrases = False
        reuse_reason = (
            "Retained source will be reprocessed for the current parser/schema"
            if prior_track.retained_source_available
            else "Parser/schema changed and no retained source is available"
        )
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
    *,
    parser_version: Optional[str] = None,
    feature_schema_version: Optional[str] = None,
) -> Dict[str, ReuseDecision]:
    """
    For each new track, find the best match in the user's prior completed imports.
    Returns dict of new_track_id -> ReuseDecision (only for tracks with a match).

    NEVER reuses across users.
    """
    # 1. Find all prior completed imports for this user (excluding the new import)
    prior_resp = (
        sb.table("rekordbox_imports")
        .select("id")
        .eq("user_id", user_id)
        .eq("status", "completed")
        .neq("id", new_import_id)
        .execute()
    )

    prior_import_ids = [r["id"] for r in (prior_resp.data or [])]
    if not prior_import_ids:
        return {}

    # 2. Fetch prior tracks for identity matching — paginated to handle libraries > 1,000 tracks.
    from .supabase_pagination import fetch_all_rows  # noqa: PLC0415

    prior_tracks = fetch_all_rows(
        lambda: (
            sb.table("rekordbox_tracks")
            .select(
                "id, import_id, master_db_id, master_content_id, rekordbox_content_id, "
                "analysis_data_file_path, analysis_data_update_count, cue_update_count, "
                "information_update_count, analysis_parse_status"
                ", analysis_feature_schema_version"
            )
            .in_("import_id", prior_import_ids)
        ),
        order_column="id",
    )

    # Load retained source provenance in bounded queries. Parser workers can
    # later restore these assets without requiring another USB upload.
    retained_by_track: Dict[str, Dict[str, Any]] = {}
    prior_track_ids = [str(row["id"]) for row in prior_tracks]
    for offset in range(0, len(prior_track_ids), 250):
        chunk = prior_track_ids[offset : offset + 250]
        asset_response = (
            sb.table("rekordbox_analysis_assets")
            .select(
                "track_id, asset_type, upload_status, storage_path, staging_key, "
                "archive_storage_path, parser_version, feature_schema_version"
            )
            .in_("track_id", chunk)
            .in_("asset_type", ["DAT", "EXT"])
            .execute()
        )
        for asset in asset_response.data or []:
            if str(asset.get("upload_status") or "") not in {"staged", "uploaded", "archived"}:
                continue
            if not (
                asset.get("staging_key")
                or asset.get("archive_storage_path")
                or asset.get("storage_path")
            ):
                continue
            track_id = str(asset.get("track_id") or "")
            retained = retained_by_track.setdefault(track_id, {})
            retained["available"] = True
            # DAT is the authoritative parser-version source; EXT is a fallback.
            if asset.get("asset_type") == "DAT" or not retained.get("parser_version"):
                retained["parser_version"] = asset.get("parser_version")
                retained["feature_schema_version"] = asset.get("feature_schema_version")

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
            parser_version=retained_by_track.get(str(pt["id"]), {}).get("parser_version"),
            feature_schema_version=(
                pt.get("analysis_feature_schema_version")
                or retained_by_track.get(str(pt["id"]), {}).get("feature_schema_version")
            ),
            retained_source_available=bool(
                retained_by_track.get(str(pt["id"]), {}).get("available")
            ),
        )

        if identity.master_db_id and identity.master_content_id:
            key = (identity.master_db_id, identity.master_content_id)
            if (
                key not in primary_idx
            ):  # take the most recent (first seen, prior imports ordered by recency)
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

        decision = decide_reuse(
            new_identity,
            prior,
            parser_version=parser_version,
            feature_schema_version=feature_schema_version,
        )
        decisions[nt["id"]] = decision

    return decisions


def copy_normalized_data_for_track(
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
        _copy_beat_grid(sb, source_track_id, target_track_id, target_import_id)

    if reuse_decision.reuse_waveform:
        _copy_waveform(sb, source_track_id, target_track_id, target_import_id)

    if reuse_decision.reuse_phrases:
        _copy_phrases(sb, source_track_id, target_track_id, target_import_id)

    if reuse_decision.reuse_cues:
        _copy_cues(sb, source_track_id, target_track_id, target_import_id)

    # Mark the target track as reused
    sb.table("rekordbox_tracks").update(
        {
            "analysis_reused_from_track_id": source_track_id,
            "analysis_parse_status": "reused",
        }
    ).eq("id", target_track_id).execute()


def _counter_changed(new_val: Optional[int], prior_val: Optional[int]) -> bool:
    """Return True if the counter has definitely changed. False when ambiguous."""
    if new_val is None or prior_val is None:
        return False  # Missing counters -> assume unchanged (conservative)
    return new_val != prior_val


def _copy_beat_grid(sb, source_id: str, target_id: str, target_import_id: str) -> None:
    """Copy beat grid from source track to target track."""
    resp = (
        sb.table("rekordbox_track_beat_grids")
        .select("*")
        .eq("track_id", source_id)
        .maybeSingle()
        .execute()
    )
    if not resp.data:
        return
    row = dict(resp.data)
    row.pop("id", None)
    row.pop("created_at", None)
    row.pop("updated_at", None)
    row["track_id"] = target_id
    row["import_id"] = target_import_id
    sb.table("rekordbox_track_beat_grids").upsert(row, on_conflict="track_id").execute()


def _copy_waveform(sb, source_id: str, target_id: str, target_import_id: str) -> None:
    resp = (
        sb.table("rekordbox_track_waveforms")
        .select("*")
        .eq("track_id", source_id)
        .maybeSingle()
        .execute()
    )
    if not resp.data:
        return
    row = dict(resp.data)
    row.pop("id", None)
    row.pop("created_at", None)
    row.pop("updated_at", None)
    row["track_id"] = target_id
    row["import_id"] = target_import_id
    sb.table("rekordbox_track_waveforms").upsert(row, on_conflict="track_id").execute()


def _copy_phrases(sb, source_id: str, target_id: str, target_import_id: str) -> None:
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
    sb.table("rekordbox_track_phrases").upsert(
        new_rows, on_conflict="track_id,phrase_index"
    ).execute()


def _copy_cues(sb, source_id: str, target_id: str, target_import_id: str) -> None:
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


def copy_normalized_data_for_tracks_bulk(
    sb,
    target_import_id: str,
    mappings: List[Tuple[str, str, ReuseDecision]],
    *,
    batch_size: int = 500,
) -> Dict[str, int]:
    """Copy reusable normalized rows with bounded table operations.

    ``mappings`` contains ``(source_track_id, target_track_id, decision)``.
    The function intentionally groups reads by table instead of issuing four
    reads and writes for every unchanged track.
    """
    if not mappings:
        return {"read_batches": 0, "write_batches": 0, "rows_copied": 0}

    # A Rekordbox export can contain duplicate references to the same retained
    # source track. Keep every target instead of silently letting the last one
    # win in a dict comprehension.
    mappings_by_source: Dict[str, List[Tuple[str, ReuseDecision]]] = {}
    for source, target, decision in mappings:
        mappings_by_source.setdefault(source, []).append((target, decision))
    read_batches = 0
    write_batches = 0
    rows_copied = 0

    table_specs = (
        ("rekordbox_track_beat_grids", "track_id", "track_id", "reuse_grid"),
        ("rekordbox_track_waveforms", "track_id", "track_id", "reuse_waveform"),
        ("rekordbox_track_phrases", "track_id,phrase_index", "track_id", "reuse_phrases"),
        ("rekordbox_cues", "track_id,dedupe_key", "track_id", "reuse_cues"),
    )

    for table, conflict, track_column, flag_name in table_specs:
        eligible_sources = [
            source
            for source, targets in mappings_by_source.items()
            if any(bool(getattr(decision, flag_name)) for _, decision in targets)
        ]
        if not eligible_sources:
            continue
        for offset in range(0, len(eligible_sources), 250):
            source_chunk = eligible_sources[offset : offset + 250]
            response = sb.table(table).select("*").in_(track_column, source_chunk).execute()
            read_batches += 1
            remapped: List[Dict[str, Any]] = []
            for source_row in response.data or []:
                source_track_id = str(source_row.get(track_column) or "")
                mapped_targets = mappings_by_source.get(source_track_id)
                if not mapped_targets:
                    continue
                for target_track_id, decision in mapped_targets:
                    if not bool(getattr(decision, flag_name)):
                        continue
                    row = dict(source_row)
                    row.pop("id", None)
                    row.pop("created_at", None)
                    row.pop("updated_at", None)
                    row[track_column] = target_track_id
                    row["import_id"] = target_import_id
                    remapped.append(row)
            for write_offset in range(0, len(remapped), max(1, batch_size)):
                write_rows = remapped[write_offset : write_offset + max(1, batch_size)]
                if not write_rows:
                    continue
                sb.table(table).upsert(write_rows, on_conflict=conflict).execute()
                write_batches += 1
                rows_copied += len(write_rows)

    return {
        "read_batches": read_batches,
        "write_batches": write_batches,
        "rows_copied": rows_copied,
    }
