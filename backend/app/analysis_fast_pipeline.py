"""Bounded, staged Rekordbox analysis pipeline.

Parser workers only decode local files and build normalized feature payloads.
A single writer consumes bounded batches, reconciles cues in bulk, persists
features and checkpoints progress. Raw source archival runs later on an
independent worker so compression/storage cannot stall useful analysis. This prevents each parser from independently producing a cloud
request storm.
"""

from __future__ import annotations

import logging
import hashlib
import os
import queue
import shutil
import tempfile
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterator, Sequence

from .analysis_performance import ImportMetrics, merge_import_metrics
from .analysis_staging import (
    build_staging_key,
    copy_staged_file,
    resolve_staging_key,
    staged_file_exists,
)
from .config import settings

logger = logging.getLogger(__name__)

_FINAL_TRACK_STATUSES = frozenset({"completed", "partial", "reused", "skipped"})
_REQUIRED_ASSET_TYPES = frozenset({"DAT", "EXT"})


@dataclass
class AssetSource:
    row: dict[str, Any]
    local_path: str | None = None
    temporary_path: str | None = None


@dataclass
class ParsedTrack:
    track: dict[str, Any]
    assets: list[dict[str, Any]]
    parse_status: str
    warnings: list[dict[str, Any]] = field(default_factory=list)
    beat_grid: Any | None = None
    waveform: Any | None = None
    cue_entries: list[Any] = field(default_factory=list)
    cue_warnings: list[Any] = field(default_factory=list)
    phrases: list[Any] = field(default_factory=list)
    asset_parse_updates: list[dict[str, Any]] = field(default_factory=list)
    temporary_paths: list[str] = field(default_factory=list)
    parse_elapsed_ms: float = 0.0


def _persistable_asset(asset: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in asset.items() if not str(key).startswith("_")}


def _chunks(rows: Sequence[Any], size: int) -> Iterator[Sequence[Any]]:
    safe_size = max(1, int(size))
    for offset in range(0, len(rows), safe_size):
        yield rows[offset : offset + safe_size]


def _load_all(query_factory: Callable[[], Any], order_column: str = "id") -> list[dict[str, Any]]:
    from .supabase_pagination import fetch_all_rows

    return fetch_all_rows(query_factory, order_column=order_column)


def _load_tracks(sb: Any, import_id: str, affected_track_ids: Sequence[str] | None) -> list[dict[str, Any]]:
    def factory():
        query = (
            sb.table("rekordbox_tracks")
            .select(
                "id, rekordbox_content_id, title, artist, analysis_data_file_path, "
                "analysis_parse_status, analysis_manifest_status, analysis_source_fingerprint, "
                "analysis_reused_from_track_id"
            )
            .eq("import_id", import_id)
        )
        if affected_track_ids:
            query = query.in_("id", list(dict.fromkeys(affected_track_ids)))
        return query

    rows = _load_all(factory)
    return [
        row
        for row in rows
        if str(row.get("analysis_parse_status") or "") not in _FINAL_TRACK_STATUSES
        and str(row.get("analysis_manifest_status") or "needs_analysis")
        not in {"reused", "metadata_only", "unavailable"}
    ]


def _load_assets(
    sb: Any,
    import_id: str,
    tracks: Sequence[dict[str, Any]],
) -> list[dict[str, Any]]:
    track_ids = [str(track["id"]) for track in tracks]
    if not track_ids:
        return []

    rows: list[dict[str, Any]] = []
    # Keep URL/query sizes bounded for large imports.
    for track_chunk in _chunks(list(track_ids), 250):
        def factory(chunk=track_chunk):
            return (
                sb.table("rekordbox_analysis_assets")
                .select("*")
                .eq("import_id", import_id)
                .in_("track_id", list(chunk))
                .in_("upload_status", ["staged", "uploaded", "archived"])
            )

        rows.extend(_load_all(factory))

    # Reparse-from-retained tracks deliberately upload nothing from USB. Resolve
    # their prior DAT/EXT rows as source references; materialization then copies
    # those bytes into durable staging owned by the new import.
    retained_targets: dict[str, list[str]] = {}
    for track in tracks:
        if str(track.get("analysis_manifest_status") or "") != "reparse_from_retained":
            continue
        source_track_id = str(track.get("analysis_reused_from_track_id") or "")
        if source_track_id:
            retained_targets.setdefault(source_track_id, []).append(str(track["id"]))

    if retained_targets:
        existing_types = {
            (str(row.get("track_id")), str(row.get("asset_type"))) for row in rows
        }
        source_ids = list(retained_targets)
        for source_chunk in _chunks(source_ids, 250):
            def retained_factory(chunk=source_chunk):
                return (
                    sb.table("rekordbox_analysis_assets")
                    .select("*")
                    .in_("track_id", list(chunk))
                    .in_("asset_type", ["DAT", "EXT"])
                    .in_("upload_status", ["staged", "uploaded", "archived"])
                )

            for source_asset in _load_all(retained_factory):
                for target_track_id in retained_targets.get(
                    str(source_asset.get("track_id")), []
                ):
                    asset_type = str(source_asset.get("asset_type"))
                    if (target_track_id, asset_type) in existing_types:
                        continue
                    retained = dict(source_asset)
                    retained["track_id"] = target_track_id
                    retained["_retained_reference"] = True
                    retained["_source_track_id"] = source_asset.get("track_id")
                    rows.append(retained)
                    existing_types.add((target_track_id, asset_type))
    return rows


def _download_legacy_asset(sb: Any, asset: dict[str, Any], temp_dir: str) -> str | None:
    storage_path = asset.get("storage_path")
    if not storage_path:
        return None
    suffix = f".{str(asset.get('asset_type') or 'dat').lower()}"
    destination = os.path.join(temp_dir, f"{asset['id']}{suffix}")
    payload = sb.storage.from_(asset.get("storage_bucket") or "rekordbox-analysis-assets").download(storage_path)
    with open(destination, "wb") as handle:
        handle.write(payload)
    return destination


def _download_archive_member(
    sb: Any,
    asset: dict[str, Any],
    temp_dir: str,
    archive_cache: dict[tuple[str, str], str],
) -> str | None:
    archive_path = asset.get("archive_storage_path")
    member = asset.get("archive_member_path")
    if not archive_path or not member:
        return None
    import tarfile

    archive_bucket = asset.get("archive_storage_bucket") or "rekordbox-analysis-assets"
    cache_key = (str(archive_bucket), str(archive_path))
    archive_local = archive_cache.get(cache_key)
    if archive_local is None:
        archive_local = os.path.join(temp_dir, f"archive-{len(archive_cache):06d}.tar.gz")
        payload = sb.storage.from_(archive_bucket).download(archive_path)
        with open(archive_local, "wb") as handle:
            handle.write(payload)
        archive_cache[cache_key] = archive_local
    output = os.path.join(temp_dir, f"{asset['id']}.{str(asset.get('asset_type')).lower()}")
    with tarfile.open(archive_local, "r:gz") as archive:
        source = archive.extractfile(member)
        if source is None:
            return None
        with open(output, "wb") as handle:
            handle.write(source.read())
    return output


def _resolve_asset_source(
    sb: Any,
    asset: dict[str, Any],
    temp_dir: str,
    archive_cache: dict[tuple[str, str], str],
) -> AssetSource:
    staging_key = asset.get("staging_key")
    if staged_file_exists(staging_key, settings.analysis_staging_root):
        return AssetSource(
            row=asset,
            local_path=str(resolve_staging_key(staging_key, settings.analysis_staging_root)),
        )
    try:
        archived = _download_archive_member(sb, asset, temp_dir, archive_cache)
        if archived:
            return AssetSource(row=asset, local_path=archived, temporary_path=archived)
    except Exception as exc:
        logger.warning("Could not restore archived asset %s: %s", asset.get("id"), exc)
    try:
        legacy = _download_legacy_asset(sb, asset, temp_dir)
        if legacy:
            return AssetSource(row=asset, local_path=legacy, temporary_path=legacy)
    except Exception as exc:
        logger.warning("Could not restore legacy asset %s: %s", asset.get("id"), exc)
    return AssetSource(row=asset)


def _materialize_asset_sources(
    sb: Any,
    assets: Sequence[dict[str, Any]],
    temp_root: str,
    checkpoint: Callable[[str, str | None], None] | None = None,
    import_id: str | None = None,
) -> list[dict[str, Any]]:
    """Resolve every parser input before CPU workers start.

    Newly uploaded assets resolve directly to durable staging without a cloud
    round trip. Legacy or archived assets are restored through this controlled
    preparation phase so parser workers never issue independent network calls.
    """
    prepared: list[dict[str, Any]] = []
    retained_rows: list[dict[str, Any]] = []
    archive_cache: dict[tuple[str, str], str] = {}
    for asset in assets:
        if checkpoint is not None:
            checkpoint("materializing_asset", str(asset.get("track_id") or "") or None)
        asset_temp = os.path.join(temp_root, f"asset-{str(asset.get('id') or 'unknown')[:16]}")
        os.makedirs(asset_temp, exist_ok=True)
        source = _resolve_asset_source(sb, asset, asset_temp, archive_cache)
        row = dict(asset)
        if asset.get("_retained_reference") and source.local_path and import_id:
            source_asset_id = asset.get("id")
            sha256 = str(asset.get("sha256") or "")
            if not sha256:
                digest = hashlib.sha256()
                with open(source.local_path, "rb") as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        digest.update(chunk)
                sha256 = digest.hexdigest()
            staging_key = build_staging_key(
                import_id,
                str(asset.get("track_id") or "unknown"),
                str(asset.get("asset_type") or "DAT"),
                sha256,
            )
            if not staged_file_exists(staging_key, settings.analysis_staging_root):
                copy_staged_file(
                    staging_key,
                    source.local_path,
                    settings.analysis_staging_root,
                )
            retained = _persistable_asset(asset)
            for key in (
                "id",
                "created_at",
                "updated_at",
                "uploaded_at",
                "parsed_at",
            ):
                retained.pop(key, None)
            retained.update({
                "import_id": import_id,
                "track_id": asset.get("track_id"),
                "sha256": sha256,
                "storage_path": None,
                "staging_key": staging_key,
                "archive_storage_bucket": None,
                "archive_storage_path": None,
                "archive_member_path": None,
                "upload_status": "staged",
                "parse_status": asset.get("parse_status") or "completed",
                "archival_status": "queued" if settings.analysis_archive_raw_assets else "skipped",
                "retained_from_asset_id": source_asset_id,
            })
            retained_rows.append(retained)
            row = dict(retained)
            row["_retained_from_asset_id"] = source_asset_id
            row["_local_path"] = str(
                resolve_staging_key(staging_key, settings.analysis_staging_root)
            )
            row["_temporary_path"] = source.temporary_path
        else:
            row["_local_path"] = source.local_path
            row["_temporary_path"] = source.temporary_path
        prepared.append(row)

    if retained_rows:
        response = sb.table("rekordbox_analysis_assets").upsert(
            retained_rows,
            on_conflict="import_id,relative_path",
        ).execute()
        persisted = list(response.data or []) if response is not None else []
        if not persisted:
            response = (
                sb.table("rekordbox_analysis_assets")
                .select("*")
                .eq("import_id", import_id)
                .in_("relative_path", [row["relative_path"] for row in retained_rows])
                .execute()
            )
            persisted = list(response.data or [])
        by_path = {
            str(row.get("relative_path") or "").lower(): row for row in persisted
        }
        for index, row in enumerate(prepared):
            if not row.get("_retained_from_asset_id"):
                continue
            persisted_row = by_path.get(str(row.get("relative_path") or "").lower())
            if persisted_row:
                prepared[index] = {
                    **persisted_row,
                    "track_id": row.get("track_id"),
                    "_local_path": row.get("_local_path"),
                    "_temporary_path": row.get("_temporary_path"),
                    "_retained_from_asset_id": row.get("_retained_from_asset_id"),
                }
    return prepared


def _parse_track(
    track: dict[str, Any],
    assets: list[dict[str, Any]],
    temp_root: str,
) -> ParsedTrack:
    from dropdex_importer.anlz_parser import parse_track_analysis_bundle
    from dropdex_importer.beatgrid_parser import extract_beat_grid
    from dropdex_importer.cue_parser import parse_anlz_cues
    from dropdex_importer.phrase_parser import extract_phrases
    from dropdex_importer.waveform_parser import extract_waveforms

    del temp_root  # Inputs are materialized before entering the parser pool.
    started = time.perf_counter()
    by_type = {
        str(asset.get("asset_type")): asset
        for asset in assets
        if asset.get("_local_path")
    }
    temporary_paths = [asset.get("_temporary_path") for asset in assets if asset.get("_temporary_path")]
    dat = by_type.get("DAT")
    ext = by_type.get("EXT")

    if dat is None:
        return ParsedTrack(
            track=track,
            assets=assets,
            parse_status="missing_required",
            warnings=[{
                "code": "SIBLING_MISSING",
                "asset_type": "DAT",
                "message": "Required DAT file is not available in staging or retained storage.",
                "detail": None,
            }],
            temporary_paths=[str(path) for path in temporary_paths],
            parse_elapsed_ms=(time.perf_counter() - started) * 1000.0,
        )

    # .2EX is intentionally absent from the blocking/normal analysis path. Old
    # retained files remain compatible and may be archived, but PWV6/7/PWVC are
    # not decoded until parser capabilities make them useful.
    bundle = parse_track_analysis_bundle(
        dat_path=dat.get("_local_path"),
        ext_path=ext.get("_local_path") if ext else None,
        two_ex_path=None,
    )
    warnings = [warning.as_dict() for warning in bundle.warnings]
    asset_updates: list[dict[str, Any]] = []
    parsed_by_type = {asset.asset_type: asset for asset in bundle.assets}
    for asset in assets:
        asset_type = str(asset.get("asset_type"))
        parsed = parsed_by_type.get(asset_type)
        if parsed is None:
            if asset_type == "2EX":
                asset_updates.append({
                    **_persistable_asset(asset),
                    "parse_status": "skipped",
                    "parser_version": bundle.dat.parser_version if bundle.dat else None,
                })
            continue
        if not asset.get("_retained_reference") and not asset.get("_retained_from_asset_id"):
            asset_updates.append({
                **_persistable_asset(asset),
                "parse_status": parsed.parse_status,
                "parser_version": parsed.parser_version,
                "parse_warnings": [warning.as_dict() for warning in parsed.warnings],
            })

    beat_grid = extract_beat_grid(bundle.dat, bundle.ext)
    waveform = extract_waveforms(bundle.dat, bundle.ext, None)
    cue_entries, cue_warnings = parse_anlz_cues(bundle.dat, bundle.ext)
    phrases, phrase_warnings = extract_phrases(bundle.ext, beat_grid)
    warnings.extend(warning.as_dict() for warning in phrase_warnings)
    return ParsedTrack(
        track=track,
        assets=assets,
        parse_status=bundle.overall_status,
        warnings=warnings,
        beat_grid=beat_grid,
        waveform=waveform,
        cue_entries=cue_entries,
        cue_warnings=cue_warnings,
        phrases=phrases,
        asset_parse_updates=asset_updates,
        temporary_paths=[str(path) for path in temporary_paths],
        parse_elapsed_ms=(time.perf_counter() - started) * 1000.0,
    )


def _beat_grid_row(import_id: str, parsed: ParsedTrack, parser_version: str) -> dict[str, Any] | None:
    result = parsed.beat_grid
    if result is None:
        return None
    assets = {str(asset.get("asset_type")): asset for asset in parsed.assets}
    return {
        "import_id": import_id,
        "track_id": parsed.track["id"],
        "source_tag": result.source_tag,
        "beats": [beat.as_dict() for beat in result.beats],
        "beat_count": result.beat_count,
        "downbeat_count": result.downbeat_count,
        "bar_count": result.bar_count,
        "first_beat_ms": result.first_beat_ms,
        "first_downbeat_ms": result.first_downbeat_ms,
        "minimum_bpm": result.minimum_bpm,
        "maximum_bpm": result.maximum_bpm,
        "is_variable_tempo": result.is_variable_tempo,
        "parser_version": parser_version,
        "source_asset_id": (assets.get("DAT") or assets.get("EXT") or {}).get("id"),
    }


def _waveform_row(
    sb: Any,
    user_id: str,
    import_id: str,
    parsed: ParsedTrack,
    parser_version: str,
) -> dict[str, Any] | None:
    result = parsed.waveform
    if result is None:
        return None
    assets = {str(asset.get("asset_type")): asset for asset in parsed.assets}
    row: dict[str, Any] = {
        "import_id": import_id,
        "track_id": parsed.track["id"],
        "source_dat_asset_id": (assets.get("DAT") or {}).get("id"),
        "source_ext_asset_id": (assets.get("EXT") or {}).get("id"),
        "source_2ex_asset_id": None,
        "parser_version": parser_version,
    }
    if result.preview is not None:
        row.update({
            "preview_format": result.preview.format,
            "preview_column_count": result.preview.column_count,
            "preview_columns": result.preview.columns,
        })
    if result.detail is not None:
        storage_path = f"{user_id}/{import_id}/waveform/{parsed.track['id']}/detail.v{parser_version}.json.gz"
        try:
            sb.storage.from_("rekordbox-analysis-assets").upload(
                path=storage_path,
                file=result.detail.compressed_bytes,
                file_options={"upsert": "true", "content-type": "application/gzip"},
            )
            row.update({
                "detail_format": result.detail.format,
                "detail_column_count": result.detail.column_count,
                "detail_storage_bucket": "rekordbox-analysis-assets",
                "detail_storage_path": storage_path,
            })
        except Exception as exc:
            logger.warning("Detail waveform archival failed for track %s: %s", parsed.track["id"], exc)
    return row


def _phrase_rows(import_id: str, parsed: ParsedTrack, parser_version: str) -> list[dict[str, Any]]:
    return [
        {
            "import_id": import_id,
            "track_id": parsed.track["id"],
            "phrase_index": entry.phrase_index,
            "source_mood": entry.source_mood,
            "source_kind": entry.source_kind,
            "source_bank": entry.source_bank,
            "normalized_label": entry.normalized_label,
            "start_beat": entry.start_beat,
            "end_beat": entry.end_beat,
            "start_ms": entry.start_ms,
            "end_ms": entry.end_ms,
            "fill_start_beat": entry.fill_start_beat,
            "fill_start_ms": entry.fill_start_ms,
            "source_flags": entry.source_flags,
            "source_payload": entry.source_payload,
            "parser_version": parser_version,
        }
        for entry in parsed.phrases
    ]


def _reconcile_cues_bulk(sb: Any, import_id: str, parsed_batch: Sequence[ParsedTrack]) -> None:
    from dropdex_importer.cue_parser import CUE_MATCH_TOLERANCE_MS
    from .analysis_feature_writer import _find_db_match

    track_ids = [str(parsed.track["id"]) for parsed in parsed_batch]
    if not track_ids:
        return
    try:
        response = sb.table("rekordbox_cues").select("*").in_("track_id", track_ids).execute()
        existing_rows = list(response.data or [])
    except Exception as exc:
        logger.warning("Bulk cue preload failed; cue batch skipped: %s", exc)
        return

    by_track: dict[str, list[dict[str, Any]]] = {}
    for row in existing_rows:
        by_track.setdefault(str(row.get("track_id")), []).append(row)

    upserts: list[dict[str, Any]] = []
    for parsed in parsed_batch:
        track_id = str(parsed.track["id"])
        existing = by_track.get(track_id, [])
        matched: set[str] = set()
        for entry in parsed.cue_entries:
            match = _find_db_match(entry, existing, matched, CUE_MATCH_TOLERANCE_MS)
            if match:
                matched.add(match["id"])
                merged = dict(match)
                merged["source_anlz_present"] = True
                if entry.hot_cue_slot is not None:
                    merged["hot_cue_slot"] = entry.hot_cue_slot
                if entry.color_hex is not None:
                    merged["color_hex"] = entry.color_hex
                if entry.color_id is not None:
                    merged["color_table_index"] = entry.color_id
                if entry.comment is not None:
                    merged["comment"] = entry.comment
                if entry.beat_loop_numerator is not None:
                    merged["beat_loop_numerator"] = entry.beat_loop_numerator
                if entry.beat_loop_denominator is not None:
                    merged["beat_loop_denominator"] = entry.beat_loop_denominator
                upserts.append(merged)
            else:
                upserts.append({
                    "import_id": import_id,
                    "track_id": track_id,
                    "dedupe_key": f"anlz:{import_id}:{entry.source_tag}:{entry.source_index}",
                    "cue_family": entry.cue_family,
                    "hot_cue_slot": entry.hot_cue_slot,
                    "point_type": entry.point_type,
                    "start_ms": entry.start_ms,
                    "end_ms": entry.end_ms,
                    "color_hex": entry.color_hex,
                    "color_table_index": entry.color_id,
                    "comment": entry.comment,
                    "is_active_loop": entry.is_active_loop,
                    "beat_loop_numerator": entry.beat_loop_numerator,
                    "beat_loop_denominator": entry.beat_loop_denominator,
                    "source_db_present": False,
                    "source_anlz_present": True,
                    "source_conflict": False,
                    "source_payload": entry.source_payload,
                })
    if upserts:
        sb.table("rekordbox_cues").upsert(upserts, on_conflict="track_id,dedupe_key").execute()


def _bulk_track_status(sb: Any, import_id: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    try:
        sb.rpc(
            "bulk_update_rekordbox_track_analysis",
            {"p_import_id": import_id, "p_rows": rows},
        ).execute()
        return
    except Exception as exc:
        logger.warning("Bulk track status RPC unavailable, using compatibility fallback: %s", exc)
    for row in rows:
        payload = dict(row)
        track_id = payload.pop("track_id")
        sb.table("rekordbox_tracks").update(payload).eq("id", track_id).eq("import_id", import_id).execute()


def _write_batch(
    sb: Any,
    user_id: str,
    import_id: str,
    parsed_batch: Sequence[ParsedTrack],
    parser_version: str,
    feature_schema_version: str,
) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    beat_rows = [row for parsed in parsed_batch if (row := _beat_grid_row(import_id, parsed, parser_version))]
    waveform_rows = [
        row for parsed in parsed_batch
        if (row := _waveform_row(sb, user_id, import_id, parsed, parser_version))
    ]
    phrase_rows = [row for parsed in parsed_batch for row in _phrase_rows(import_id, parsed, parser_version)]
    asset_rows = [row for parsed in parsed_batch for row in parsed.asset_parse_updates]

    if beat_rows:
        sb.table("rekordbox_track_beat_grids").upsert(beat_rows, on_conflict="track_id").execute()
    _reconcile_cues_bulk(sb, import_id, parsed_batch)
    if waveform_rows:
        sb.table("rekordbox_track_waveforms").upsert(waveform_rows, on_conflict="track_id").execute()
    if phrase_rows:
        sb.table("rekordbox_track_phrases").upsert(
            phrase_rows, on_conflict="track_id,phrase_index"
        ).execute()
    if asset_rows:
        for row in asset_rows:
            row["parsed_at"] = now_iso
            row["feature_schema_version"] = feature_schema_version
        sb.table("rekordbox_analysis_assets").upsert(
            asset_rows, on_conflict="import_id,relative_path"
        ).execute()

    status_rows: list[dict[str, Any]] = []
    for parsed in parsed_batch:
        reason = None
        if parsed.parse_status in {"failed", "missing_required"}:
            reason = next((warning.get("message") for warning in parsed.warnings if warning.get("message")), None)
        status_rows.append({
            "track_id": parsed.track["id"],
            "analysis_parse_status": parsed.parse_status,
            "analysis_parse_warnings": parsed.warnings,
            "analysis_failure_reason": reason,
            "analysis_feature_schema_version": feature_schema_version,
            "analysis_completed_at": now_iso,
        })
    _bulk_track_status(sb, import_id, status_rows)


def _write_batch_resilient(
    sb: Any,
    user_id: str,
    import_id: str,
    parsed_batch: Sequence[ParsedTrack],
    parser_version: str,
    feature_schema_version: str,
) -> int:
    """Write a bounded batch while isolating row-specific persistence failures.

    The normal path performs one set of bulk operations. If a malformed payload
    causes a batch-level database rejection, recursively bisect the batch until
    the offending track is isolated. Successful siblings remain committed and
    the single bad track is checkpointed as failed for a later resume/reparse.
    The returned value is the number of write attempts for observability.
    """
    if not parsed_batch:
        return 0
    try:
        _write_batch(
            sb,
            user_id,
            import_id,
            parsed_batch,
            parser_version,
            feature_schema_version,
        )
        return 1
    except Exception as exc:
        logger.exception(
            "Bulk feature write failed for import %s (%s tracks)",
            import_id,
            len(parsed_batch),
        )
        if len(parsed_batch) > 1:
            midpoint = len(parsed_batch) // 2
            return 1 + _write_batch_resilient(
                sb,
                user_id,
                import_id,
                parsed_batch[:midpoint],
                parser_version,
                feature_schema_version,
            ) + _write_batch_resilient(
                sb,
                user_id,
                import_id,
                parsed_batch[midpoint:],
                parser_version,
                feature_schema_version,
            )

        parsed = parsed_batch[0]
        parsed.parse_status = "failed"
        parsed.warnings.append({
            "code": "FEATURE_WRITE_ERROR",
            "asset_type": "BUNDLE",
            "message": "Parsed features could not be persisted for this track.",
            "detail": type(exc).__name__,
        })
        _bulk_track_status(sb, import_id, [{
            "track_id": parsed.track["id"],
            "analysis_parse_status": "failed",
            "analysis_parse_warnings": parsed.warnings,
            "analysis_failure_reason": "Parsed features could not be persisted for this track.",
            "analysis_feature_schema_version": feature_schema_version,
            "analysis_completed_at": datetime.now(timezone.utc).isoformat(),
        }])
        return 1


def _rolling_parse_results(
    tracks: Sequence[dict[str, Any]],
    assets_by_track: dict[str, list[dict[str, Any]]],
    temp_root: str,
    workers: int,
    result_queue_size: int,
    checkpoint: Callable[[str, str | None], None],
) -> Iterator[ParsedTrack]:
    """Yield parser results through a bounded producer/consumer queue.

    The coordinator keeps at most ``workers`` futures alive and blocks on the
    bounded queue when the bulk writer is busy. This provides backpressure
    without allowing thousands of parsed payloads to accumulate in memory.
    """
    max_workers = max(1, int(workers))
    bounded_results: queue.Queue[ParsedTrack | object] = queue.Queue(
        maxsize=max(1, int(result_queue_size))
    )
    sentinel = object()
    coordinator_error: list[BaseException] = []
    stop_requested = threading.Event()

    def put_result(item: ParsedTrack | object) -> bool:
        while not stop_requested.is_set():
            try:
                bounded_results.put(item, timeout=0.1)
                return True
            except queue.Full:
                continue
        return False

    def produce() -> None:
        iterator = iter(tracks)
        try:
            with ThreadPoolExecutor(
                max_workers=max_workers,
                thread_name_prefix="dropdex-anlz",
            ) as executor:
                futures: dict[Future[ParsedTrack], dict[str, Any]] = {}

                def submit_next() -> bool:
                    if stop_requested.is_set():
                        return False
                    try:
                        track = next(iterator)
                    except StopIteration:
                        return False
                    track_id = str(track["id"])
                    checkpoint("queueing_track", track_id)
                    future = executor.submit(
                        _parse_track,
                        track,
                        assets_by_track.get(track_id, []),
                        temp_root,
                    )
                    futures[future] = track
                    return True

                for _ in range(max_workers):
                    if not submit_next():
                        break

                while futures:
                    done, _ = wait(tuple(futures), return_when=FIRST_COMPLETED)
                    for future in done:
                        track = futures.pop(future)
                        try:
                            parsed = future.result()
                        except Exception as exc:
                            logger.exception(
                                "Isolated parser failure for track %s", track.get("id")
                            )
                            parsed = ParsedTrack(
                                track=track,
                                assets=assets_by_track.get(str(track["id"]), []),
                                parse_status="failed",
                                warnings=[{
                                    "code": "PARSE_ERROR",
                                    "asset_type": "BUNDLE",
                                    "message": "The analysis files for this track could not be parsed.",
                                    "detail": type(exc).__name__,
                                }],
                            )
                        if not put_result(parsed):
                            return
                        submit_next()
        except BaseException as exc:  # propagate coordinator setup/checkpoint failures
            coordinator_error.append(exc)
        finally:
            put_result(sentinel)

    coordinator = threading.Thread(
        target=produce,
        name=f"dropdex-anlz-coordinator-{str(tracks[0].get('id', 'empty'))[:8] if tracks else 'empty'}",
        daemon=True,
    )
    coordinator.start()
    try:
        while True:
            item = bounded_results.get()
            if item is sentinel:
                break
            assert isinstance(item, ParsedTrack)
            yield item
    finally:
        stop_requested.set()
        coordinator.join()
    if coordinator_error:
        raise coordinator_error[0]


def run_fast_analysis_import(
    sb: Any,
    import_id: str,
    user_id: str,
    *,
    affected_track_ids: Sequence[str] | None,
    parser_version: str,
    checkpoint: Callable[[str, str | None], None],
    progress: Callable[[dict[str, Any] | None, int, int], None],
) -> dict[str, Any]:
    metrics = ImportMetrics(import_id)
    started = time.perf_counter()
    with metrics.timed("asset_loading"):
        tracks = _load_tracks(sb, import_id, affected_track_ids)
        track_ids = [str(track["id"]) for track in tracks]
        assets = _load_assets(sb, import_id, tracks)
    metrics.increment("tracks_selected", len(tracks))
    metrics.increment("assets_loaded", len(assets))
    metrics.increment("track_map_builds", 1)
    assets_by_track: dict[str, list[dict[str, Any]]] = {}
    for asset in assets:
        assets_by_track.setdefault(str(asset.get("track_id")), []).append(asset)

    total = len(tracks)
    progress(None, 0, total)
    if total == 0:
        return {
            "total_tracks": 0,
            "completed_count": 0,
            "partial_count": 0,
            "failed_count": 0,
            "missing_required_count": 0,
            "archived_asset_count": 0,
            "metrics": metrics,
        }

    now_iso = datetime.now(timezone.utc).isoformat()
    _bulk_track_status(sb, import_id, [
        {
            "track_id": track_id,
            "analysis_parse_status": "queued",
            "analysis_queued_at": now_iso,
            "analysis_feature_schema_version": settings.analysis_feature_schema_version,
        }
        for track_id in track_ids
    ])

    completed = partial = failed = missing_required = 0
    processed = 0
    writer_batch: list[ParsedTrack] = []
    temp_root = tempfile.mkdtemp(prefix=f"dropdex-fast-{str(import_id)[:8]}-")
    try:
        with metrics.timed("temporary_staging"):
            prepared_assets = _materialize_asset_sources(
                sb,
                assets,
                temp_root,
                checkpoint,
                import_id,
            )
        assets_by_track.clear()
        for asset in prepared_assets:
            assets_by_track.setdefault(str(asset.get("track_id")), []).append(asset)

        parsing_started_at = datetime.now(timezone.utc).isoformat()
        _bulk_track_status(sb, import_id, [
            {
                "track_id": track_id,
                "analysis_parse_status": "parsing",
                "analysis_started_at": parsing_started_at,
                "analysis_feature_schema_version": settings.analysis_feature_schema_version,
            }
            for track_id in track_ids
        ])

        results = _rolling_parse_results(
            tracks,
            assets_by_track,
            temp_root,
            settings.analysis_parser_workers,
            settings.analysis_result_queue_size,
            checkpoint,
        )
        for parsed in results:
            metrics.timings_ms["asset_parsing"] = round(
                metrics.timings_ms.get("asset_parsing", 0.0) + parsed.parse_elapsed_ms,
                3,
            )
            checkpoint("parsed_track_waiting_for_writer", str(parsed.track["id"]))
            writer_batch.append(parsed)
            if len(writer_batch) < max(1, settings.analysis_writer_batch_size):
                continue
            with metrics.timed("feature_writing"):
                write_attempts = _write_batch_resilient(
                    sb,
                    user_id,
                    import_id,
                    writer_batch,
                    parser_version,
                    settings.analysis_feature_schema_version,
                )
            metrics.increment("feature_write_batches")
            metrics.increment("feature_write_attempts", write_attempts)
            for result in writer_batch:
                completed += int(result.parse_status == "completed")
                partial += int(result.parse_status == "partial")
                failed += int(result.parse_status == "failed")
                missing_required += int(result.parse_status == "missing_required")
            processed += len(writer_batch)
            # Publish useful feature readiness immediately. Raw DAT/EXT
            # archival is queued only after analysis finalizes on a separate
            # lease and never stalls the parser/writer pipeline.
            progress(writer_batch[-1].track, processed, total)
            writer_batch.clear()
        if writer_batch:
            with metrics.timed("feature_writing"):
                write_attempts = _write_batch_resilient(
                    sb,
                    user_id,
                    import_id,
                    writer_batch,
                    parser_version,
                    settings.analysis_feature_schema_version,
                )
            metrics.increment("feature_write_batches")
            metrics.increment("feature_write_attempts", write_attempts)
            for result in writer_batch:
                completed += int(result.parse_status == "completed")
                partial += int(result.parse_status == "partial")
                failed += int(result.parse_status == "failed")
                missing_required += int(result.parse_status == "missing_required")
            processed += len(writer_batch)
            progress(writer_batch[-1].track, processed, total)

        metrics.increment("tracks_processed", processed)
        metrics.timings_ms["total_time_to_full_analysis"] = round((time.perf_counter() - started) * 1000.0, 3)
        merge_import_metrics(sb, import_id, metrics)
        return {
            "total_tracks": total,
            "completed_count": completed,
            "partial_count": partial,
            "failed_count": failed,
            "missing_required_count": missing_required,
            "archived_asset_count": 0,
            "metrics": metrics,
        }
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)
