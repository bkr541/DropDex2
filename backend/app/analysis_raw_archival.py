"""Trailing, grouped archival of staged Rekordbox DAT/EXT source assets.

Raw source preservation deliberately runs after normalized analysis is ready. It
compresses staged files into bounded tar.gz groups, uploads each group once,
then atomically points every asset row at its archive member before deleting the
local source file. A dedicated durable lease keeps archive work independent from
the parser lease while still participating in Pause/Delete safety.
"""

from __future__ import annotations

import hashlib
import logging
import threading
from pathlib import Path
from typing import Any, Iterable

from .analysis_performance import ImportMetrics, merge_import_metrics
from .analysis_staging import (
    create_archive,
    resolve_staging_key,
    staged_file_exists,
)
from .analysis_worker_lease import (
    DurableWorkerLease,
    WorkerLeaseConflict,
    WorkerLeaseLost,
)
from .config import settings
from .import_worker_registry import WorkerStopRequested
from .supabase_pagination import fetch_all_rows

logger = logging.getLogger(__name__)

_ANALYSIS_BUCKET = "rekordbox-analysis-assets"
_ARCHIVE_MAX_FILES = 100
_ARCHIVE_MAX_BYTES = 256 * 1024 * 1024
_RAW_ARCHIVE_WORKERS: dict[str, threading.Thread] = {}
_RAW_ARCHIVE_WORKERS_LOCK = threading.Lock()


def _create_supabase():
    import supabase as _sb  # noqa: PLC0415

    return _sb.create_client(settings.supabase_url, settings.supabase_secret_key)


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _update_import_status(
    sb: Any,
    import_id: str,
    user_id: str,
    status: str,
) -> None:
    (
        sb.table("rekordbox_imports")
        .update({"raw_archival_status": status, "updated_at": _now_iso()})
        .eq("id", import_id)
        .eq("user_id", user_id)
        .execute()
    )


def _load_raw_assets(sb: Any, import_id: str) -> list[dict[str, Any]]:
    rows = fetch_all_rows(
        lambda: (
            sb.table("rekordbox_analysis_assets")
            .select(
                "id, import_id, track_id, asset_type, relative_path, original_filename, "
                "sha256, size_bytes, storage_bucket, storage_path, staging_key, "
                "upload_status, parse_status, parser_version, parse_warnings, uploaded_at, "
                "parsed_at, source_mtime_ms, source_fingerprint, feature_schema_version, "
                "archive_storage_bucket, archive_storage_path, archive_member_path, "
                "retained_from_asset_id, archival_status"
            )
            .eq("import_id", import_id)
            .in_("asset_type", ["DAT", "EXT"])
        ),
        order_column="id",
    )
    result = [dict(row) for row in rows]
    result.sort(
        key=lambda row: (
            str(row.get("relative_path") or "").lower(),
            str(row.get("id") or ""),
        )
    )
    return result


def _classify_raw_assets(
    rows: Iterable[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    pending: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    for row in rows:
        has_group_archive = bool(
            row.get("archive_storage_path") and row.get("archive_member_path")
        )
        has_legacy_object = bool(
            row.get("storage_path")
            and str(row.get("upload_status") or "") in {"uploaded", "archived"}
        )
        if has_group_archive or has_legacy_object:
            continue
        staging_key = row.get("staging_key")
        if staging_key and staged_file_exists(
            str(staging_key), settings.analysis_staging_root
        ):
            pending.append(dict(row))
        else:
            missing.append(dict(row))
    return pending, missing


def _bounded_groups(
    rows: Iterable[dict[str, Any]],
) -> list[list[dict[str, Any]]]:
    groups: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_bytes = 0
    for row in rows:
        row_bytes = max(0, int(row.get("size_bytes") or 0))
        would_overflow = bool(current) and (
            len(current) >= _ARCHIVE_MAX_FILES
            or current_bytes + row_bytes > _ARCHIVE_MAX_BYTES
        )
        if would_overflow:
            groups.append(current)
            current = []
            current_bytes = 0
        current.append(row)
        current_bytes += row_bytes
    if current:
        groups.append(current)
    return groups


def _archive_member_name(row: dict[str, Any]) -> str:
    track_id = str(row.get("track_id") or "unmatched")
    asset_type = str(row.get("asset_type") or "asset").lower()
    filename = Path(
        str(row.get("relative_path") or row.get("original_filename") or asset_type)
    ).name
    return f"{track_id}/{asset_type}/{filename}"


def _mark_group_archiving(sb: Any, rows: list[dict[str, Any]]) -> None:
    ids = [str(row["id"]) for row in rows if row.get("id")]
    if not ids:
        return
    (
        sb.table("rekordbox_analysis_assets")
        .update({"archival_status": "archiving"})
        .in_("id", ids)
        .execute()
    )


def _persist_archived_group(
    sb: Any,
    rows: list[dict[str, Any]],
    *,
    archive_storage_path: str,
    member_map: dict[str, str],
) -> int:
    updates: list[dict[str, Any]] = []
    by_staging_key = {
        str(row.get("staging_key")): row
        for row in rows
        if row.get("staging_key")
    }
    for staging_key, member_path in member_map.items():
        source = by_staging_key.get(staging_key)
        if source is None:
            continue
        row = dict(source)
        row.update(
            {
                "upload_status": "archived",
                "archival_status": "archived",
                "archive_storage_bucket": _ANALYSIS_BUCKET,
                "archive_storage_path": archive_storage_path,
                "archive_member_path": member_path,
            }
        )
        updates.append(row)
    if updates:
        (
            sb.table("rekordbox_analysis_assets")
            .upsert(updates, on_conflict="import_id,relative_path")
            .execute()
        )
    return len(updates)


def _mark_group_failed(sb: Any, rows: list[dict[str, Any]]) -> None:
    ids = [str(row["id"]) for row in rows if row.get("id")]
    if not ids:
        return
    try:
        (
            sb.table("rekordbox_analysis_assets")
            .update({"archival_status": "failed"})
            .in_("id", ids)
            .execute()
        )
    except Exception:
        logger.exception("Could not persist raw archive failure state")


def _archive_raw_assets(
    sb: Any,
    import_id: str,
    user_id: str,
    worker_lease: DurableWorkerLease,
) -> int:
    metrics = ImportMetrics(import_id)
    metrics.start("raw_archival")
    archived_count = 0
    total_archive_bytes = 0
    rows = _load_raw_assets(sb, import_id)
    pending_rows, missing_rows = _classify_raw_assets(rows)
    if missing_rows:
        _mark_group_failed(sb, missing_rows)
        raise RuntimeError(
            f"{len(missing_rows)} raw analysis asset(s) have no staged or archived source"
        )
    groups = _bounded_groups(pending_rows)

    _update_import_status(sb, import_id, user_id, "running")
    for group in groups:
        worker_lease.checkpoint("raw_archive_preparing", force=True)
        _mark_group_archiving(sb, group)
        members = [
            (str(row["staging_key"]), _archive_member_name(row))
            for row in group
            if row.get("staging_key")
        ]
        archive_path: Path | None = None
        try:
            group_token = hashlib.sha256(
                "\n".join(sorted(staging_key for staging_key, _ in members)).encode("utf-8")
            ).hexdigest()[:20]
            archive_path, member_map = create_archive(
                import_id,
                f"raw-{group_token}",
                members,
                settings.analysis_staging_root,
            )
            if not member_map:
                raise RuntimeError("Raw archive group contained no readable staged files")
            worker_lease.checkpoint("raw_archive_uploading", force=True)
            storage_path = f"{user_id}/{import_id}/archives/{archive_path.name}"
            with archive_path.open("rb") as archive_file:
                sb.storage.from_(_ANALYSIS_BUCKET).upload(
                    path=storage_path,
                    file=archive_file,
                    file_options={
                        "upsert": "true",
                        "content-type": "application/gzip",
                    },
                )
            worker_lease.checkpoint("raw_archive_persisting", force=True)
            persisted = _persist_archived_group(
                sb,
                group,
                archive_storage_path=storage_path,
                member_map=member_map,
            )
            if persisted != len(member_map):
                raise RuntimeError("Raw archive metadata was only partially persisted")
            archived_count += persisted
            group_bytes = sum(max(0, int(row.get("size_bytes") or 0)) for row in group)
            total_archive_bytes += group_bytes
            metrics.increment("raw_assets_archived", persisted)
            metrics.increment("raw_archive_groups", 1)
            metrics.add_bytes("raw_assets_archived", group_bytes)

            # Database provenance is durable before local sources are removed.
            for staging_key in member_map:
                try:
                    resolve_staging_key(
                        staging_key, settings.analysis_staging_root
                    ).unlink(missing_ok=True)
                except OSError:
                    logger.warning(
                        "Archived staging source could not be removed for import %s",
                        import_id,
                    )
        except (WorkerStopRequested, WorkerLeaseLost):
            # Keep staged files and reset this group to queued so resume can
            # safely recreate the deterministic object.
            ids = [str(row["id"]) for row in group if row.get("id")]
            if ids:
                (
                    sb.table("rekordbox_analysis_assets")
                    .update({"archival_status": "queued"})
                    .in_("id", ids)
                    .execute()
                )
            raise
        except Exception:
            _mark_group_failed(sb, group)
            raise
        finally:
            if archive_path is not None:
                archive_path.unlink(missing_ok=True)

    metrics.stop("raw_archival")
    if not groups:
        metrics.increment("raw_assets_archived", 0)
    metrics.add_bytes("raw_archive_source_bytes", total_archive_bytes)
    merge_import_metrics(sb, import_id, metrics)
    _update_import_status(sb, import_id, user_id, "completed")
    return archived_count


def _raw_archival_entry(
    import_id: str,
    user_id: str,
    worker_lease: DurableWorkerLease,
) -> None:
    try:
        _archive_raw_assets(worker_lease.sb, import_id, user_id, worker_lease)
    except WorkerStopRequested as exc:
        logger.info(
            "Raw archival for %s stopped at %s (%s)",
            import_id,
            exc.stage,
            exc.reason,
        )
        try:
            _update_import_status(worker_lease.sb, import_id, user_id, "paused")
        except Exception:
            logger.exception("Could not persist paused raw archival for %s", import_id)
    except WorkerLeaseLost:
        logger.warning("Raw archival for %s lost its durable lease", import_id)
    except Exception:
        logger.exception("Raw archival failed for import %s", import_id)
        try:
            _update_import_status(worker_lease.sb, import_id, user_id, "failed")
        except Exception:
            logger.exception("Could not persist failed raw archival for %s", import_id)
    finally:
        try:
            worker_lease.release()
        finally:
            with _RAW_ARCHIVE_WORKERS_LOCK:
                current = _RAW_ARCHIVE_WORKERS.get(import_id)
                if current is threading.current_thread():
                    _RAW_ARCHIVE_WORKERS.pop(import_id, None)


def start_raw_archival(sb: Any, import_id: str, user_id: str) -> bool:
    """Claim and start one trailing archive worker.

    Returns ``True`` only when this process started a new worker. A valid lease
    held elsewhere is treated as already running rather than an error.
    """
    if not settings.analysis_archive_raw_assets:
        _update_import_status(sb, import_id, user_id, "skipped")
        return False

    with _RAW_ARCHIVE_WORKERS_LOCK:
        existing = _RAW_ARCHIVE_WORKERS.get(import_id)
        if existing and existing.is_alive():
            return False
        try:
            worker_lease = DurableWorkerLease.claim(
                sb, import_id, user_id, "raw_archival"
            )
        except WorkerLeaseConflict:
            logger.info("Raw archival for %s is already leased", import_id)
            return False
        try:
            worker_lease.start_heartbeat()
            _update_import_status(sb, import_id, user_id, "running")
        except Exception:
            worker_lease.release()
            raise
        thread = threading.Thread(
            target=_raw_archival_entry,
            args=(import_id, user_id, worker_lease),
            name=f"dropdex-raw-archive-{import_id[:8]}",
            daemon=True,
        )
        _RAW_ARCHIVE_WORKERS[import_id] = thread
        try:
            thread.start()
        except Exception:
            _RAW_ARCHIVE_WORKERS.pop(import_id, None)
            worker_lease.release()
            raise
        return True


def resume_pending_raw_archival() -> int:
    """Reclaim queued/running/failed archival after expired ownership."""
    if not settings.analysis_archive_raw_assets:
        return 0

    sb = _create_supabase()
    response = (
        sb.table("rekordbox_imports")
        .select("id, user_id, status, raw_archival_status")
        .in_("raw_archival_status", ["queued", "running", "failed"])
        .execute()
    )
    restarted = 0
    for row in response.data or []:
        if str(row.get("status") or "") in {
            "cancel_requested",
            "stopping",
            "deleting",
            "cancelled",
            "failed",
        }:
            continue
        import_id = str(row.get("id") or "")
        user_id = str(row.get("user_id") or "")
        if not import_id or not user_id:
            continue
        # Give each background worker its own Supabase client/HTTP session.
        if start_raw_archival(_create_supabase(), import_id, user_id):
            restarted += 1
    return restarted
