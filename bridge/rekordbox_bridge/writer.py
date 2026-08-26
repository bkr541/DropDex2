"""Staging-only Rekordbox DjmdCue writer foundation.

This module has no CLI/Electron/renderer entry point. It only mutates an isolated
Stage 5 staging database produced by :mod:`rekordbox_bridge.security`.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from .writer_models import (
    CueApplyPlan,
    PlannedCue,
    PlannedTrack,
    StagingGeneration,
    StagingOperationResult,
    StagingVerificationResult,
    VerificationMismatch,
)
from .writer_plan import adapt_saved_cue_drafts
from .security import (
    StagingSafetyError,
    create_backup_and_staging,
    discover_trusted_writer_target,
    file_identity,
    require_rekordbox_closed,
)

HOT_KIND_BY_SLOT = {1: 1, 2: 2, 3: 3, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9}
MEMORY_COLOR_BY_NAME = {
    "red": 1,
    "orange": 2,
    "yellow": 3,
    "green": 4,
    "aqua": 5,
    "cyan": 5,
    "blue": 6,
    "purple": 7,
    "violet": 7,
}
VERIFY_FIELDS = (
    "ContentID",
    "ContentUUID",
    "InMsec",
    "InFrame",
    "InMpegFrame",
    "InMpegAbs",
    "OutMsec",
    "OutFrame",
    "OutMpegFrame",
    "OutMpegAbs",
    "Kind",
    "Color",
    "ColorTableIndex",
    "ActiveLoop",
    "Comment",
    "BeatLoopSize",
    "CueMicrosec",
)


class StagingWriterError(RuntimeError):
    """A staging-only cue write or verification failed."""

    def __init__(self, message: str, *, code: str = "writer-error") -> None:
        super().__init__(message)
        self.code = code


def _cue_color(cue: PlannedCue) -> int:
    """Map saved semantic color data to the local ``DjmdCue.Color`` field.

    DJCues-compatible hot cues primarily use ``ColorTableIndex`` and set Color
    to -1 (255 for loop-style hot cues). Memory cue Color is a small enum. When
    a saved memory cue carries a known color name or a 1-7 index, preserve it;
    otherwise use Rekordbox's no-color sentinel rather than inventing a color.
    """
    if cue.family == "hot":
        return 255 if cue.point_type == "loop" else -1
    if cue.color_name:
        mapped = MEMORY_COLOR_BY_NAME.get(cue.color_name.strip().lower())
        if mapped is not None:
            return mapped
    if cue.color_table_index is not None and 1 <= cue.color_table_index <= 7:
        return cue.color_table_index
    return -1


def build_djmdcue_values(
    cue: PlannedCue,
    *,
    content_id: str,
    content_uuid: str,
    cue_id: str,
    cue_uuid: str,
) -> dict[str, Any]:
    """Pure DJCues-compatible ``DjmdCue`` field construction."""
    if cue.family == "hot":
        if cue.hot_cue_slot not in HOT_KIND_BY_SLOT:
            raise StagingWriterError("Hot Cue plan is missing a valid A-H slot.")
        kind = HOT_KIND_BY_SLOT[cue.hot_cue_slot]
    else:
        kind = 0

    in_msec = int(cue.start_ms)
    is_loop = cue.point_type == "loop"
    if is_loop:
        if cue.end_ms is None or cue.end_ms <= cue.start_ms:
            raise StagingWriterError("Loop cue requires a valid end position.")
        out_msec = int(cue.end_ms)
    else:
        out_msec = -1

    return {
        "ID": str(cue_id),
        "ContentID": str(content_id),
        "ContentUUID": str(content_uuid),
        "UUID": str(cue_uuid),
        "InMsec": in_msec,
        "InFrame": 0,
        "InMpegFrame": 0,
        "InMpegAbs": 0,
        "OutMsec": out_msec,
        "OutFrame": 0 if is_loop else -1,
        "OutMpegFrame": 0 if is_loop else -1,
        "OutMpegAbs": 0 if is_loop else -1,
        "Kind": kind,
        "Color": _cue_color(cue),
        "ColorTableIndex": cue.color_table_index,
        "ActiveLoop": (1 if cue.is_active_loop is True else 0) if is_loop else -1,
        "Comment": cue.comment,
        "BeatLoopSize": 0,
        "CueMicrosec": 0,
    }


def _load_pyrekordbox() -> tuple[Callable[[str], Any], Any]:
    try:
        from pyrekordbox import Rekordbox6Database  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on local environment
        raise ImportError("pyrekordbox is required for the Rekordbox staging writer.") from exc
    try:
        from pyrekordbox.db6 import tables  # type: ignore
    except ImportError:
        try:
            from pyrekordbox.masterdb import models as tables  # type: ignore
        except ImportError as exc:  # pragma: no cover - version compatibility path
            raise ImportError("Installed pyrekordbox does not expose DjmdCue models.") from exc
    return Rekordbox6Database, tables


def _close_db(db: Any) -> None:
    close = getattr(db, "close", None)
    if callable(close):
        close()
        return
    session = getattr(db, "session", None)
    session_close = getattr(session, "close", None)
    if callable(session_close):
        session_close()


def _content_for_id(db: Any, content_id: str) -> Any:
    try:
        content = db.get_content(ID=content_id)
    except Exception as exc:
        raise StagingWriterError(f"Could not resolve planned ContentID {content_id}.") from exc
    if content is None:
        raise StagingWriterError(
            f"Planned ContentID {content_id} does not exist in the local database.",
            code="content-missing",
        )
    if isinstance(content, (list, tuple)):
        if len(content) != 1:
            raise StagingWriterError(
                f"Planned ContentID {content_id} is not uniquely resolvable.",
                code="content-ambiguous",
            )
        content = content[0]
    resolved_id = getattr(content, "ID", None)
    content_uuid = getattr(content, "UUID", None)
    if resolved_id is None or str(resolved_id) != content_id or not content_uuid:
        raise StagingWriterError(f"Planned ContentID {content_id} has invalid local identity data.")
    return content


def _content_master_db_id(content: Any) -> Optional[str]:
    for field in ("MasterDBID", "MasterDbID", "MasterDBId", "masterDbId", "master_db_id"):
        value = getattr(content, field, None)
        if value is not None and str(value).strip():
            return str(value)
    return None


def _content_for_track(db: Any, track: PlannedTrack) -> Any:
    """Resolve and verify the strongest persisted identity before cue mutation.

    DropDex import/reconciliation already treats ``master_content_id`` as the local
    master-library ``DjmdContent.ID``. This writer deliberately reuses that contract
    instead of inventing a second resolver or weakening a strong mismatch to ContentID.
    """
    if not track.master_content_id:
        raise StagingWriterError(
            f"Track {track.track_id} has no strong master ContentID; destructive apply is blocked.",
            code="strong-identity-missing",
        )
    if track.content_id != track.master_content_id:
        raise StagingWriterError(
            f"Track {track.track_id} planned target does not match its strong master ContentID.",
            code="strong-identity-mismatch",
        )

    content = _content_for_id(db, track.master_content_id)
    if track.master_db_id:
        local_master_db_id = _content_master_db_id(content)
        if local_master_db_id is None:
            raise StagingWriterError(
                f"Track {track.track_id} local master DB identity is unavailable; destructive apply is blocked.",
                code="strong-db-identity-unavailable",
            )
        if local_master_db_id != track.master_db_id:
            raise StagingWriterError(
                f"Track {track.track_id} strong master DB identity does not match current local Rekordbox.",
                code="strong-db-identity-mismatch",
            )
    return content


def _cue_rows_for_content(db: Any, content_id: str) -> list[Any]:
    try:
        rows = db.get_cue(ContentID=content_id)
        return list(rows) if rows is not None else []
    except Exception as exc:
        raise StagingWriterError(f"Could not read cue rows for ContentID {content_id}.") from exc


def _row_signature(values: Mapping[str, Any]) -> tuple[Any, ...]:
    return tuple(values.get(field) for field in VERIFY_FIELDS)


def _object_signature(row: Any) -> tuple[Any, ...]:
    return tuple(getattr(row, field, None) for field in VERIFY_FIELDS)


def _sort_signature(signature: tuple[Any, ...]) -> tuple[str, ...]:
    return tuple("" if item is None else str(item) for item in signature)


def mutate_staging_database(
    plan: CueApplyPlan,
    generation: StagingGeneration,
    *,
    database_factory: Optional[Callable[[str], Any]] = None,
    tables_module: Any = None,
    uuid_factory: Callable[[], Any] = uuid4,
) -> dict[str, list[dict[str, Any]]]:
    """Replace cues for planned ContentIDs on the isolated staging DB only."""
    source = Path(generation.source_path)
    staging = Path(generation.staging_path)
    if source.resolve(strict=True) == staging.resolve(strict=True):
        raise StagingWriterError("Staging path aliases the live source database.")
    try:
        source_stat = source.stat()
        staging_stat = staging.stat()
        if (
            source_stat.st_ino == staging_stat.st_ino
            and source_stat.st_dev == staging_stat.st_dev
        ):
            raise StagingWriterError(
                "Staging database is the same filesystem object as the live source."
            )
    except OSError as exc:
        raise StagingWriterError("Could not prove source/staging isolation.") from exc

    if file_identity(source) != generation.source_identity:
        raise StagingSafetyError("Live source database changed before staging mutation.")

    if database_factory is None or tables_module is None:
        loaded_factory, loaded_tables = _load_pyrekordbox()
        database_factory = database_factory or loaded_factory
        tables_module = tables_module or loaded_tables

    db = database_factory(str(staging))
    expected: dict[str, list[dict[str, Any]]] = {}
    try:
        # Validate every target and resolve ContentUUIDs before deleting anything.
        content_by_id = {
            track.content_id: _content_for_track(db, track)
            for track in plan.tracks
        }

        for track in plan.tracks:
            content = content_by_id[track.content_id]
            for existing in _cue_rows_for_content(db, track.content_id):
                db.delete(existing)

            expected_rows: list[dict[str, Any]] = []
            for cue in track.cues:
                cue_id = db.generate_unused_id(tables_module.DjmdCue)
                values = build_djmdcue_values(
                    cue,
                    content_id=track.content_id,
                    content_uuid=str(content.UUID),
                    cue_id=str(cue_id),
                    cue_uuid=str(uuid_factory()),
                )
                row = tables_module.DjmdCue.create(**values)
                db.add(row)
                expected_rows.append(values)
            expected[track.content_id] = expected_rows

        db.commit()
    except Exception:  # noqa: BLE001 - rollback database API failures before re-raising
        rollback = getattr(db, "rollback", None)
        if callable(rollback):
            rollback()
        raise
    finally:
        _close_db(db)

    if file_identity(source) != generation.source_identity:
        raise StagingSafetyError("Live source database changed during staging mutation.")
    return expected


def verify_database(
    plan: CueApplyPlan,
    database_path: Path,
    expected: Mapping[str, Sequence[Mapping[str, Any]]],
    *,
    database_factory: Optional[Callable[[str], Any]] = None,
    context: str = "database",
) -> StagingVerificationResult:
    """Reopen a closed DB generation and verify exact writer-relevant cue fields."""
    if database_factory is None:
        database_factory, _ = _load_pyrekordbox()

    db = database_factory(str(database_path))
    mismatches: list[VerificationMismatch] = []
    verified: list[str] = []
    try:
        for track in plan.tracks:
            actual_rows = _cue_rows_for_content(db, track.content_id)
            expected_rows = list(expected.get(track.content_id, ()))
            expected_signatures = sorted(
                (_row_signature(row) for row in expected_rows), key=_sort_signature
            )
            actual_signatures = sorted(
                (_object_signature(row) for row in actual_rows), key=_sort_signature
            )
            if expected_signatures != actual_signatures:
                mismatches.append(
                    VerificationMismatch(
                        content_id=track.content_id,
                        expected_count=len(expected_rows),
                        actual_count=len(actual_rows),
                        details=(
                            "Writer-relevant DjmdCue fields differ after reopening "
                            f"{context}."
                        ),
                    )
                )
            else:
                # Generated identity fields are required even though their exact
                # values are intentionally not part of semantic verification.
                missing_identity = any(
                    not getattr(row, "ID", None) or not getattr(row, "UUID", None)
                    for row in actual_rows
                )
                if missing_identity:
                    mismatches.append(
                        VerificationMismatch(
                            content_id=track.content_id,
                            expected_count=len(expected_rows),
                            actual_count=len(actual_rows),
                            details=(
                                "One or more committed cue rows is missing ID/UUID "
                                f"identity in {context}."
                            ),
                        )
                    )
                else:
                    verified.append(track.content_id)
    finally:
        _close_db(db)

    return StagingVerificationResult(
        ok=not mismatches,
        verified_content_ids=tuple(verified),
        mismatches=tuple(mismatches),
    )


def verify_staging_database(
    plan: CueApplyPlan,
    generation: StagingGeneration,
    expected: Mapping[str, Sequence[Mapping[str, Any]]],
    *,
    database_factory: Optional[Callable[[str], Any]] = None,
) -> StagingVerificationResult:
    """Reopen the committed staging DB and verify exact writer-relevant cue fields."""
    return verify_database(
        plan,
        Path(generation.staging_path),
        expected,
        database_factory=database_factory,
        context="staging",
    )


def stage_saved_cue_drafts(saved_rows: Sequence[Mapping[str, Any]]) -> StagingOperationResult:
    """Internal production Stage 5 orchestration. No renderer-facing path API."""
    plan = adapt_saved_cue_drafts(saved_rows)
    source, target_result = discover_trusted_writer_target()
    require_rekordbox_closed()
    generation = create_backup_and_staging(source)
    expected = mutate_staging_database(plan, generation)
    verification = verify_staging_database(plan, generation, expected)
    if not verification.ok:
        raise StagingWriterError("Staging verification failed; live source remains unchanged.")
    if file_identity(source) != generation.source_identity:
        raise StagingSafetyError("Live source database changed during Stage 5 operation.")

    return StagingOperationResult(
        ok=True,
        operation_id=generation.operation_id,
        plan_fingerprint=plan.plan_fingerprint,
        source_identity=target_result.source_identity or generation.source_identity,
        backup_identity=generation.backup_identity,
        staging_identity=file_identity(Path(generation.staging_path)),
        verification=verification,
    )
