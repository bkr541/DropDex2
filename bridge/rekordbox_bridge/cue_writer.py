"""DJCues-compatible DjmdCue construction, staging mutation, and verification."""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Iterable
from uuid import uuid4

from .writer_models import HOT_SLOT_TO_KIND, CueApplyPlan, CueIntent, CueTrackSummary


# Values mirror DJCues' verified A-H cue-system defaults.  Explicit values from
# a saved DropDex cue document win over these deterministic fallbacks.
_HOT_DEFAULTS: dict[int, tuple[int, int | None, str]] = {
    1: (-1, 18, "First Beat"),
    2: (255, 18, "Loop In"),
    3: (-1, 32, "Vocal / Buildup"),
    4: (-1, 42, "Drop"),
    5: (-1, 1, "Breakdown"),
    6: (-1, 56, "Special"),
    7: (-1, 9, "Outro"),
    8: (255, 0, "Loop Out"),
}
_MEMORY_DEFAULTS: dict[int, tuple[int, int | None, str]] = {
    1: (4, None, "First Beat"),
    2: (4, 0, "Loop In"),
    3: (3, None, "Buildup"),
    4: (1, None, "Drop"),
    5: (6, None, "Breakdown"),
    6: (7, None, "Special"),
    7: (5, None, "Outro"),
    8: (2, 0, "Loop Out"),
}


class CueWriterError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class DjmdCueFields:
    Kind: int
    InMsec: int
    InFrame: int
    InMpegFrame: int
    InMpegAbs: int
    OutMsec: int
    OutFrame: int
    OutMpegFrame: int
    OutMpegAbs: int
    Color: int
    ColorTableIndex: int | None
    ActiveLoop: int
    Comment: str
    BeatLoopSize: int
    CueMicrosec: int


@dataclass(frozen=True, slots=True)
class VerificationResult:
    verified: bool
    tracks_verified: int
    cues_verified: int
    mismatches: tuple[str, ...]


def build_djmd_cue_fields(cue: CueIntent) -> DjmdCueFields:
    """Pure mapping from canonical cue intent to Rekordbox DjmdCue fields."""
    cue.validate()
    if cue.family == "hot":
        assert cue.hot_cue_slot is not None
        kind = HOT_SLOT_TO_KIND[cue.hot_cue_slot]
        default_color, default_index, default_comment = _HOT_DEFAULTS[cue.hot_cue_slot]
    else:
        kind = 0
        defaults = _MEMORY_DEFAULTS.get(cue.paired_hot_cue_slot or -1)
        default_color, default_index, default_comment = defaults or (-1, None, "Memory Cue")

    is_loop = cue.point_type == "loop"
    return DjmdCueFields(
        Kind=kind,
        InMsec=cue.start_ms,
        InFrame=0,
        InMpegFrame=0,
        InMpegAbs=0,
        OutMsec=cue.end_ms if is_loop and cue.end_ms is not None else -1,
        OutFrame=0 if is_loop else -1,
        OutMpegFrame=0 if is_loop else -1,
        OutMpegAbs=0 if is_loop else -1,
        Color=cue.color if cue.color is not None else default_color,
        ColorTableIndex=(
            cue.color_table_index if cue.color_table_index is not None else default_index
        ),
        # Rekordbox/DJCues uses 0 for stored loops and -1 for point cues.
        ActiveLoop=0 if is_loop else -1,
        Comment=cue.comment if cue.comment is not None else default_comment,
        BeatLoopSize=0,
        CueMicrosec=0,
    )


def _load_pyrekordbox() -> tuple[type[Any], Any]:
    try:
        from pyrekordbox import Rekordbox6Database  # type: ignore
    except ImportError as exc:
        raise CueWriterError("pyrekordbox is not installed") from exc
    try:
        from pyrekordbox.db6 import tables  # type: ignore
    except ImportError:
        try:
            from pyrekordbox.masterdb import models as tables  # type: ignore
        except ImportError as exc:
            raise CueWriterError("pyrekordbox DjmdCue model is unavailable") from exc
    return Rekordbox6Database, tables


def open_staging_database(path: Path) -> Any:
    database_type, _ = _load_pyrekordbox()
    try:
        return database_type(str(path))
    except Exception as exc:  # noqa: BLE001
        raise CueWriterError("Could not open Rekordbox staging database") from exc


def _tables_module() -> Any:
    _, tables = _load_pyrekordbox()
    return tables


def _close_db(db: Any) -> None:
    close = getattr(db, "close", None)
    if callable(close):
        try:
            close()
        except Exception:  # noqa: BLE001
            pass


def _rollback_db(db: Any) -> None:
    rollback = getattr(db, "rollback", None)
    if callable(rollback):
        rollback()
        return
    session = getattr(db, "session", None)
    session_rollback = getattr(session, "rollback", None)
    if callable(session_rollback):
        session_rollback()


def _lookup_content(db: Any, content_id: str) -> Any | None:
    content = db.get_content(ID=content_id)
    if content is None and content_id.isdigit():
        content = db.get_content(ID=int(content_id))
    return content


def _existing_cues(db: Any, content_id: str) -> list[Any]:
    result = db.get_cue(ContentID=content_id)
    try:
        rows = list(result)
    except TypeError:
        rows = [result] if result is not None else []
    if not rows and content_id.isdigit():
        result = db.get_cue(ContentID=int(content_id))
        try:
            rows = list(result)
        except TypeError:
            rows = [result] if result is not None else []
    return rows


def _row_payload(row: Any) -> dict[str, Any]:
    fields = (
        "Kind", "InMsec", "InFrame", "InMpegFrame", "InMpegAbs",
        "OutMsec", "OutFrame", "OutMpegFrame", "OutMpegAbs", "Color",
        "ColorTableIndex", "ActiveLoop", "Comment", "BeatLoopSize", "CueMicrosec",
    )
    return {field: getattr(row, field, None) for field in fields}


def _fingerprint_payload(rows: Iterable[dict[str, Any]]) -> str:
    normalized = sorted(
        rows,
        key=lambda item: (
            int(item.get("Kind") or 0),
            int(item.get("InMsec") or 0),
            int(item.get("OutMsec") or -1),
            str(item.get("Comment") or ""),
        ),
    )
    encoded = json.dumps(normalized, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def desired_track_fingerprint(cues: Iterable[CueIntent]) -> str:
    return _fingerprint_payload(asdict(build_djmd_cue_fields(cue)) for cue in cues)


def inspect_staging_plan(
    db_path: Path,
    plan: CueApplyPlan,
    *,
    db_factory: Callable[[Path], Any] = open_staging_database,
) -> tuple[CueTrackSummary, ...]:
    """Read current cue state and prove every planned ContentID exists before mutation."""
    plan.validate()
    db = db_factory(db_path)
    summaries: list[CueTrackSummary] = []
    try:
        for track in plan.tracks:
            content = _lookup_content(db, track.content_id)
            if content is None:
                summaries.append(
                    CueTrackSummary(
                        content_id=track.content_id,
                        found=False,
                        current_cue_count=0,
                        desired_cue_count=len(track.cues),
                        desired_fingerprint=desired_track_fingerprint(track.cues),
                    )
                )
                continue
            rows = [_row_payload(row) for row in _existing_cues(db, str(content.ID))]
            summaries.append(
                CueTrackSummary(
                    content_id=track.content_id,
                    found=True,
                    current_cue_count=len(rows),
                    desired_cue_count=len(track.cues),
                    current_fingerprint=_fingerprint_payload(rows),
                    desired_fingerprint=desired_track_fingerprint(track.cues),
                )
            )
    finally:
        _close_db(db)
    return tuple(summaries)


def write_plan_to_staging(
    db_path: Path,
    plan: CueApplyPlan,
    *,
    db_factory: Callable[[Path], Any] = open_staging_database,
    cue_table: Any | None = None,
) -> int:
    """Replace cues only for planned ContentIDs and commit staging as one unit."""
    plan.validate()
    db = db_factory(db_path)
    try:
        # Resolve every local ContentUUID before deleting anything.
        contents: dict[str, Any] = {}
        for track in plan.tracks:
            content = _lookup_content(db, track.content_id)
            if content is None:
                raise CueWriterError(
                    f"Planned ContentID is missing from local Rekordbox: {track.content_id}"
                )
            contents[track.content_id] = content

        table = cue_table or _tables_module().DjmdCue
        written = 0
        for track in plan.tracks:
            content = contents[track.content_id]
            local_content_id = str(content.ID)
            for existing in _existing_cues(db, local_content_id):
                db.delete(existing)
            for cue_intent in track.cues:
                row_fields = build_djmd_cue_fields(cue_intent)
                cue_id = db.generate_unused_id(table)
                cue_uuid = str(uuid4())
                row = table.create(
                    ID=str(cue_id),
                    ContentID=local_content_id,
                    ContentUUID=content.UUID,
                    UUID=cue_uuid,
                    **asdict(row_fields),
                )
                db.add(row)
                written += 1
        db.commit()
        return written
    except Exception:  # noqa: BLE001 - database adapters can raise backend-specific errors
        try:
            _rollback_db(db)
        finally:
            _close_db(db)
        raise
    finally:
        _close_db(db)


def verify_staging_plan(
    db_path: Path,
    plan: CueApplyPlan,
    *,
    db_factory: Callable[[Path], Any] = open_staging_database,
) -> VerificationResult:
    plan.validate()
    db = db_factory(db_path)
    mismatches: list[str] = []
    cues_verified = 0
    try:
        for track in plan.tracks:
            content = _lookup_content(db, track.content_id)
            if content is None:
                mismatches.append(f"ContentID {track.content_id} disappeared from staging")
                continue
            actual = [_row_payload(row) for row in _existing_cues(db, str(content.ID))]
            actual_fingerprint = _fingerprint_payload(actual)
            expected_fingerprint = desired_track_fingerprint(track.cues)
            if actual_fingerprint != expected_fingerprint or len(actual) != len(track.cues):
                mismatches.append(f"Cue verification mismatch for ContentID {track.content_id}")
                continue
            cues_verified += len(actual)
    finally:
        _close_db(db)

    return VerificationResult(
        verified=not mismatches,
        tracks_verified=len(plan.tracks) - len(mismatches),
        cues_verified=cues_verified,
        mismatches=tuple(mismatches),
    )
