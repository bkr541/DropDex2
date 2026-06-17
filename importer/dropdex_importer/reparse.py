"""
Administrative CLI for reparsing retained ANLZ assets.

Security:
- Service-role key read from env (SUPABASE_SECRET_KEY), never from stdin prompt
  in non-TTY contexts
- Dry-run mode is always safe (no mutations)
- Existing valid data is preserved until replacement succeeds
- Never deletes normalized data before writing new data

Usage:
  python -m dropdex_importer reparse --import-id <uuid>
  python -m dropdex_importer reparse --track-id <uuid>
  python -m dropdex_importer reparse --older-than-parser-version 1.0.0
  python -m dropdex_importer reparse --dry-run --older-than-parser-version 2.0.0
"""

from __future__ import annotations

import argparse
import logging
import os
import shutil
import sys
import tempfile
from typing import List, Optional

from .anlz_parser import DROPDEX_ANLZ_PARSER_VERSION

logger = logging.getLogger(__name__)


def main(argv=None) -> int:
    """
    Entry point for `python -m dropdex_importer reparse`.
    Returns exit code 0 (success) or 1 (error).
    """
    parser = argparse.ArgumentParser(
        prog="dropdex_importer.reparse",
        description="Reparse retained ANLZ assets without re-uploading",
    )
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--import-id", help="Reparse all tracks in one import")
    g.add_argument("--track-id", help="Reparse one specific track")
    g.add_argument(
        "--older-than-parser-version",
        metavar="VERSION",
        help="Reparse all tracks parsed with a version older than VERSION",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Describe what would be reparsed without modifying data",
    )
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    if args.verbose:
        logging.basicConfig(level=logging.DEBUG)
    else:
        logging.basicConfig(level=logging.INFO)

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    if not supabase_url or not service_key:
        print(
            "ERROR: SUPABASE_URL and SUPABASE_SECRET_KEY must be set",
            file=sys.stderr,
        )
        return 1

    result = run_reparse(
        supabase_url=supabase_url,
        service_key=service_key,
        import_id=args.import_id,
        track_id=args.track_id,
        older_than_version=args.older_than_parser_version,
        dry_run=args.dry_run,
    )

    print(f"Completed: {result['completed']}")
    print(f"Partial:   {result['partial']}")
    print(f"Failed:    {result['failed']}")
    print(f"Skipped:   {result['skipped']}")
    if args.dry_run:
        print("(Dry run — no data was modified)")
    return 0 if result["failed"] == 0 else 1


def run_reparse(
    supabase_url: str,
    service_key: str,
    import_id: Optional[str] = None,
    track_id: Optional[str] = None,
    older_than_version: Optional[str] = None,
    dry_run: bool = False,
) -> dict:
    """
    Core reparse logic. Returns dict with completed/partial/failed/skipped counts.

    For each target track:
    1. Find the retained analysis assets in rekordbox_analysis_assets
       where upload_status='uploaded'
    2. Download each asset from Storage to a temp dir
       (same pattern as complete_analysis_import)
    3. Re-run parse_track_analysis_bundle
    4. Re-run all feature writers (beat grid, waveform, cues, phrases)
    5. Write new data BEFORE deleting old data
    6. On success: mark track analysis_parse_status = 'completed'
    7. On failure: preserve old data, mark as 'failed', continue to next track
    8. Delete temp files
    """
    try:
        import supabase as _sb  # noqa: PLC0415
        sb = _sb.create_client(supabase_url, service_key)
    except ImportError:
        raise ImportError("supabase package not installed")

    tracks = _query_target_tracks(sb, import_id, track_id, older_than_version)

    if dry_run:
        logger.info("DRY RUN: would reparse %d tracks", len(tracks))
        return {"completed": 0, "partial": 0, "failed": 0, "skipped": len(tracks)}

    counts: dict[str, int] = {"completed": 0, "partial": 0, "failed": 0, "skipped": 0}
    for track in tracks:
        status = _reparse_track(sb, track)
        counts[status] = counts.get(status, 0) + 1
    return counts


def _query_target_tracks(
    sb,
    import_id: Optional[str],
    track_id: Optional[str],
    older_than_version: Optional[str],
) -> List[dict]:
    """
    Build the list of tracks to reparse.

    Returns a list of dicts, each containing at minimum:
      id, import_id, analysis_parse_status
    """
    query = sb.table("rekordbox_tracks").select(
        "id, import_id, analysis_parse_status, analysis_feature_statuses"
    )

    if import_id:
        query = query.eq("import_id", import_id)
    elif track_id:
        query = query.eq("id", track_id)
    elif older_than_version:
        # Fetch all tracks whose stored parser version is older than the given
        # version. We use a simple string-prefix comparison that works for
        # semver-like "M.m.p" versions with the same number of digits.
        # Production would use a proper semver library; this covers the common case.
        result = query.execute()
        all_tracks: List[dict] = result.data or []
        return [
            t for t in all_tracks
            if _version_is_older(
                t.get("analysis_parser_version") or "0.0.0",
                older_than_version,
            )
        ]
    else:
        # Unreachable: argparse enforces mutual exclusivity, but guard anyway.
        return []

    result = query.execute()
    return result.data or []


def _version_is_older(stored: str, threshold: str) -> bool:
    """
    Return True when ``stored`` version is strictly older than ``threshold``.

    Compares three-part semver tuples (major, minor, patch) as integers.
    Non-parseable strings are treated as "0.0.0" (always older).
    """
    def _parse(v: str):
        try:
            parts = v.split(".")
            return tuple(int(p) for p in parts[:3])
        except (ValueError, AttributeError):
            return (0, 0, 0)

    return _parse(stored) < _parse(threshold)


def _reparse_track(sb, track: dict) -> str:
    """
    Reparse one track's uploaded ANLZ assets and persist new analysis data.

    Returns one of: 'completed', 'partial', 'failed', 'skipped'.

    Failure modes are isolated — a failure for one track does not abort others.
    """
    track_id = track["id"]
    import_id = track.get("import_id", "")

    # Step 1: Find uploaded assets for this track
    assets_result = (
        sb.table("rekordbox_analysis_assets")
        .select("id, asset_type, storage_path, sha256")
        .eq("track_id", track_id)
        .eq("upload_status", "uploaded")
        .execute()
    )
    assets: List[dict] = assets_result.data or []
    if not assets:
        logger.info("Track %s has no uploaded assets; skipping", track_id)
        return "skipped"

    # Group assets by type for the bundle parser
    asset_by_type: dict[str, dict] = {a["asset_type"].upper(): a for a in assets}
    dat_asset = asset_by_type.get("DAT")
    if dat_asset is None:
        logger.warning("Track %s has no DAT asset; skipping", track_id)
        return "skipped"

    tmp_dir = tempfile.mkdtemp(prefix="dropdex_reparse_")
    try:
        # Step 2: Download each asset
        # TODO: extract _download_asset_from_storage from analysis_import_service
        # and call it here in the same pattern as complete_analysis_import.
        # For now, we download bytes directly from storage.
        dat_path: Optional[str] = None
        ext_path: Optional[str] = None
        two_ex_path: Optional[str] = None

        for asset in assets:
            atype = asset["asset_type"].upper()
            storage_path = asset["storage_path"]
            try:
                raw: bytes = sb.storage.from_("rekordbox-analysis-assets").download(storage_path)
            except Exception as exc:
                logger.error(
                    "Failed to download %s asset for track %s: %s",
                    atype,
                    track_id,
                    exc,
                )
                return "failed"

            local_name = f"ANLZ.{atype.lower()}"
            local_path = os.path.join(tmp_dir, local_name)
            with open(local_path, "wb") as fh:
                fh.write(raw)

            if atype == "DAT":
                dat_path = local_path
            elif atype == "EXT":
                ext_path = local_path
            elif atype == "2EX":
                two_ex_path = local_path

        # Step 3: Re-parse the bundle
        from .anlz_parser import parse_track_analysis_bundle  # noqa: PLC0415

        try:
            bundle = parse_track_analysis_bundle(
                dat_path=dat_path,
                ext_path=ext_path,
                two_ex_path=two_ex_path,
            )
        except Exception as exc:
            logger.error("Parse failed for track %s: %s", track_id, exc)
            sb.table("rekordbox_tracks").update(
                {"analysis_parse_status": "failed"}
            ).eq("id", track_id).execute()
            return "failed"

        # Step 4-5: Re-run all feature extractors and write to DB
        feature_statuses: dict = {}
        asset_ids = _get_asset_ids_for_track(sb, track_id)
        bg = None

        # Beat grid
        try:
            from .beatgrid_parser import extract_beat_grid  # noqa: PLC0415
            bg = extract_beat_grid(bundle.dat, bundle.ext)
            if bg is not None:
                src_id = asset_ids.get("DAT") or asset_ids.get("EXT")
                _write_beat_grid_row(sb, import_id, track_id, bg, src_id)
                feature_statuses["beat_grid"] = "completed"
            else:
                feature_statuses["beat_grid"] = "skipped"
        except Exception as exc:
            logger.error("Beat grid write failed for track %s: %s", track_id, exc)
            feature_statuses["beat_grid"] = "failed"

        # Waveform
        try:
            from .waveform_parser import extract_waveforms  # noqa: PLC0415
            wf = extract_waveforms(bundle.dat, bundle.ext)
            _write_waveform_row(sb, import_id, track_id, wf, asset_ids)
            has_content = wf.preview is not None or wf.detail is not None
            feature_statuses["waveform"] = "completed" if has_content else "skipped"
        except Exception as exc:
            logger.error("Waveform write failed for track %s: %s", track_id, exc)
            feature_statuses["waveform"] = "failed"

        # Cues
        try:
            from .cue_parser import parse_anlz_cues, CUE_MATCH_TOLERANCE_MS  # noqa: PLC0415
            cue_entries, _ = parse_anlz_cues(bundle.dat, bundle.ext)
            _reconcile_cues(sb, import_id, track_id, cue_entries, CUE_MATCH_TOLERANCE_MS)
            feature_statuses["cues"] = "completed"
        except Exception as exc:
            logger.error("Cue write failed for track %s: %s", track_id, exc)
            feature_statuses["cues"] = "failed"

        # Phrases
        try:
            from .phrase_parser import extract_phrases  # noqa: PLC0415
            phrase_entries, _ = extract_phrases(bundle.ext, bg)
            _write_phrase_rows(sb, import_id, track_id, phrase_entries)
            feature_statuses["phrases"] = "completed" if phrase_entries else "skipped"
        except Exception as exc:
            logger.error("Phrase write failed for track %s: %s", track_id, exc)
            feature_statuses["phrases"] = "failed"

        # Step 6: Determine overall status from feature results and mark track
        overall = getattr(bundle, "overall_status", "completed")
        failed_features = [k for k, v in feature_statuses.items() if v == "failed"]
        completed_features = [k for k, v in feature_statuses.items() if v == "completed"]

        if completed_features and not failed_features:
            final_status = "completed"
        elif completed_features or (not failed_features):
            final_status = "partial"
        else:
            final_status = "failed"

        # Use the bundle's parse status when it's a failure; otherwise use features
        if overall == "failed":
            final_status = "failed"

        sb.table("rekordbox_tracks").update({
            "analysis_parse_status": final_status,
            "analysis_parser_version": DROPDEX_ANLZ_PARSER_VERSION,
            "analysis_feature_statuses": feature_statuses,
        }).eq("id", track_id).execute()

        logger.info("Reparsed track %s → %s", track_id, final_status)
        return final_status if final_status in ("completed", "partial") else "failed"

    except Exception as exc:
        logger.exception("Unexpected error reparsing track %s: %s", track_id, exc)
        try:
            sb.table("rekordbox_tracks").update(
                {"analysis_parse_status": "failed"}
            ).eq("id", track_id).execute()
        except Exception:
            pass
        return "failed"
    finally:
        # Step 8: Clean up temp files regardless of outcome
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ── Feature writer helpers (direct Supabase writes for reparse context) ────────


def _get_asset_ids_for_track(sb, track_id: str) -> dict:
    """Return a mapping of asset_type → asset_id for all assets of the track."""
    resp = (
        sb.table("rekordbox_analysis_assets")
        .select("id, asset_type")
        .eq("track_id", track_id)
        .execute()
    )
    return {a["asset_type"]: a["id"] for a in (resp.data or [])}


def _write_beat_grid_row(sb, import_id: str, track_id: str, bg, source_asset_id) -> None:
    """Upsert one rekordbox_track_beat_grids row."""
    row = {
        "import_id": import_id,
        "track_id": track_id,
        "source_tag": bg.source_tag,
        "beats": [b.as_dict() for b in bg.beats],
        "beat_count": bg.beat_count,
        "downbeat_count": bg.downbeat_count,
        "bar_count": bg.bar_count,
        "first_beat_ms": bg.first_beat_ms,
        "first_downbeat_ms": bg.first_downbeat_ms,
        "minimum_bpm": bg.minimum_bpm,
        "maximum_bpm": bg.maximum_bpm,
        "is_variable_tempo": bg.is_variable_tempo,
        "parser_version": DROPDEX_ANLZ_PARSER_VERSION,
        "source_asset_id": source_asset_id,
    }
    sb.table("rekordbox_track_beat_grids").upsert(row, on_conflict="track_id").execute()


def _write_waveform_row(sb, import_id: str, track_id: str, wf, asset_ids: dict) -> None:
    """
    Upsert one rekordbox_track_waveforms row.

    Detail waveform Storage re-upload is intentionally skipped during reparse
    because the retained asset path in the DB remains valid.  Only the preview
    inline data and source-asset links are refreshed.
    """
    row = {
        "import_id": import_id,
        "track_id": track_id,
        "source_dat_asset_id": asset_ids.get("DAT"),
        "source_ext_asset_id": asset_ids.get("EXT"),
        "source_2ex_asset_id": asset_ids.get("2EX"),
        "parser_version": DROPDEX_ANLZ_PARSER_VERSION,
    }
    if wf.preview is not None:
        p = wf.preview
        row["preview_format"] = p.format
        row["preview_column_count"] = p.column_count
        row["preview_columns"] = p.columns
    sb.table("rekordbox_track_waveforms").upsert(row, on_conflict="track_id").execute()


def _find_best_cue_match(anlz, existing: list, already_matched: set, tolerance_ms: float):
    """
    Find the best-matching existing DB cue row for an ANLZ entry.

    - Same cue_family required.
    - Hot cues: reject only when both db and anlz slots are non-None and differ.
    - Timing must be within tolerance_ms.
    """
    for db_cue in existing:
        if db_cue["id"] in already_matched:
            continue
        if db_cue.get("cue_family") != anlz.cue_family:
            continue
        if anlz.cue_family == "hot":
            db_slot = db_cue.get("hot_cue_slot")
            anlz_slot = anlz.hot_cue_slot
            if db_slot is not None and anlz_slot is not None and db_slot != anlz_slot:
                continue
        db_ms = db_cue.get("start_ms")
        if db_ms is None:
            continue
        if abs(float(db_ms) - anlz.start_ms) <= tolerance_ms:
            return db_cue
    return None


def _reconcile_cues(
    sb, import_id: str, track_id: str, anlz_entries: list, tolerance_ms: float
) -> None:
    """
    Minimal reconciliation for reparse: update matched rows, insert new ones.
    Does not delete unmatched DB rows (preserves user data).
    """
    resp = (
        sb.table("rekordbox_cues")
        .select("id, cue_family, hot_cue_slot, start_ms")
        .eq("track_id", track_id)
        .execute()
    )
    existing = resp.data or []
    matched: set = set()

    for anlz in anlz_entries:
        match = _find_best_cue_match(anlz, existing, matched, tolerance_ms)
        if match:
            matched.add(match["id"])
            update: dict = {"source_anlz_present": True}
            if anlz.hot_cue_slot is not None:
                update["hot_cue_slot"] = anlz.hot_cue_slot
            if anlz.color_hex is not None:
                update["color_hex"] = anlz.color_hex
            sb.table("rekordbox_cues").update(update).eq("id", match["id"]).execute()
        else:
            key = f"anlz:{import_id}:{anlz.source_tag}:{anlz.source_index}"
            sb.table("rekordbox_cues").upsert({
                "import_id": import_id,
                "track_id": track_id,
                "dedupe_key": key,
                "cue_family": anlz.cue_family,
                "hot_cue_slot": anlz.hot_cue_slot,
                "point_type": anlz.point_type,
                "start_ms": anlz.start_ms,
                "end_ms": anlz.end_ms,
                "color_hex": anlz.color_hex,
                "source_anlz_present": True,
                "source_db_present": False,
                "source_conflict": False,
            }, on_conflict="dedupe_key").execute()


def _write_phrase_rows(sb, import_id: str, track_id: str, entries: list) -> None:
    """Upsert phrase rows for the track."""
    if not entries:
        return
    rows = [
        {
            "import_id": import_id,
            "track_id": track_id,
            "phrase_index": e.phrase_index,
            "source_mood": e.source_mood,
            "source_kind": e.source_kind,
            "source_bank": e.source_bank,
            "normalized_label": e.normalized_label,
            "start_beat": e.start_beat,
            "end_beat": e.end_beat,
            "start_ms": e.start_ms,
            "end_ms": e.end_ms,
            "fill_start_beat": e.fill_start_beat,
            "fill_start_ms": e.fill_start_ms,
            "source_flags": e.source_flags,
            "source_payload": e.source_payload,
            "parser_version": DROPDEX_ANLZ_PARSER_VERSION,
        }
        for e in entries
    ]
    sb.table("rekordbox_track_phrases").upsert(
        rows, on_conflict="track_id,phrase_index"
    ).execute()
