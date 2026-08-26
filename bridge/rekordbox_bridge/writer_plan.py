"""Adapt Stage 4 saved cue drafts into deterministic Stage 5 writer plans."""
from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from typing import Any, Optional

from .writer_models import CueApplyPlan, PlannedCue, PlannedTrack

CUE_DRAFT_SCHEMA_VERSION = 1
WRITER_PLAN_SCHEMA_VERSION = 2
_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_HOT_KIND_BY_SLOT = {1: 1, 2: 2, 3: 3, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9}


class CuePlanValidationError(ValueError):
    """Saved cue state cannot be represented safely as a writer plan."""


def _mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise CuePlanValidationError(f"{field} must be an object.")
    return value


def _required_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CuePlanValidationError(f"{field} is required.")
    return value


def _nullable_string(value: Any, field: str) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise CuePlanValidationError(f"{field} must be a string or null.")
    return value


def _nullable_int(value: Any, field: str) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise CuePlanValidationError(f"{field} must be an integer or null.")
    return value


def _finite_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CuePlanValidationError(f"{field} must be numeric.")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        raise CuePlanValidationError(f"{field} must be finite.")
    return round(number, 3)


def _nullable_number(value: Any, field: str) -> Optional[float]:
    if value is None:
        return None
    return _finite_number(value, field)


def _canonical_plan_payload(tracks: Sequence[PlannedTrack]) -> dict[str, Any]:
    return {
        "schemaVersion": WRITER_PLAN_SCHEMA_VERSION,
        "tracks": [
            {
                "importId": track.import_id,
                "trackId": track.track_id,
                "contentId": track.content_id,
                "rekordboxContentId": track.rekordbox_content_id,
                "masterDbId": track.master_db_id,
                "masterContentId": track.master_content_id,
                "draftRevision": track.draft_revision,
                "desiredFingerprint": track.desired_fingerprint,
                "importedBaselineFingerprint": track.imported_baseline_fingerprint,
                "importedBaselineLocalCueFingerprint": track.imported_baseline_local_cue_fingerprint,
                "cues": [
                    {
                        "family": cue.family,
                        "hotCueSlot": cue.hot_cue_slot,
                        "pointType": cue.point_type,
                        "startMs": cue.start_ms,
                        "endMs": cue.end_ms,
                        "colorTableIndex": cue.color_table_index,
                        "colorHex": cue.color_hex,
                        "colorName": cue.color_name,
                        "rekordboxColor": cue.rekordbox_color,
                        "comment": cue.comment,
                        "isActiveLoop": cue.is_active_loop,
                        "beatLoopNumerator": cue.beat_loop_numerator,
                        "beatLoopDenominator": cue.beat_loop_denominator,
                        "rekordboxKind": cue.rekordbox_kind,
                        "sourceDbPresent": cue.source_db_present,
                    }
                    for cue in track.cues
                ],
            }
            for track in tracks
        ],
    }


def _fingerprint(payload: Mapping[str, Any]) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _parse_cue(raw_value: Any, index: int) -> PlannedCue:
    raw = _mapping(raw_value, f"desiredDocument.cues[{index}]")
    family = raw.get("family")
    if family not in ("hot", "memory"):
        raise CuePlanValidationError(f"Cue {index + 1} has an invalid family.")
    point_type = raw.get("pointType")
    if point_type not in ("cue", "loop"):
        raise CuePlanValidationError(f"Cue {index + 1} has an invalid pointType.")

    slot = _nullable_int(raw.get("hotCueSlot"), f"Cue {index + 1} hotCueSlot")
    if family == "hot":
        if slot not in _HOT_KIND_BY_SLOT:
            raise CuePlanValidationError(f"Cue {index + 1} must own Hot Cue slot A-H.")
    elif slot is not None:
        raise CuePlanValidationError(f"Memory Cue {index + 1} cannot own a Hot Cue slot.")

    start_ms = _finite_number(raw.get("startMs"), f"Cue {index + 1} startMs")
    if start_ms < 0:
        raise CuePlanValidationError(f"Cue {index + 1} startMs must be non-negative.")
    end_ms = _nullable_number(raw.get("endMs"), f"Cue {index + 1} endMs")
    if point_type == "loop":
        if end_ms is None or end_ms <= start_ms:
            raise CuePlanValidationError(f"Loop cue {index + 1} requires endMs after startMs.")
    elif end_ms is not None and end_ms < start_ms:
        raise CuePlanValidationError(f"Cue {index + 1} endMs cannot precede startMs.")

    is_active_loop = raw.get("isActiveLoop")
    if is_active_loop is not None and not isinstance(is_active_loop, bool):
        raise CuePlanValidationError(f"Cue {index + 1} isActiveLoop must be boolean or null.")
    if point_type != "loop" and is_active_loop is True:
        raise CuePlanValidationError(f"Point cue {index + 1} cannot be an active loop.")

    color_table_index = _nullable_int(
        raw.get("colorTableIndex"), f"Cue {index + 1} colorTableIndex"
    )
    if color_table_index is not None and color_table_index < 0:
        raise CuePlanValidationError(f"Cue {index + 1} colorTableIndex cannot be negative.")

    rekordbox_kind = _nullable_int(raw.get("rekordboxKind"), f"Cue {index + 1} rekordboxKind")
    if family == "hot" and rekordbox_kind is not None and rekordbox_kind != _HOT_KIND_BY_SLOT[slot]:
        raise CuePlanValidationError(
            f"Cue {index + 1} rekordboxKind conflicts with Hot Cue slot."
        )
    if family == "memory" and rekordbox_kind not in (None, 0):
        raise CuePlanValidationError(f"Memory Cue {index + 1} has an invalid rekordboxKind.")

    source_db_present = raw.get("sourceDbPresent", False)
    if not isinstance(source_db_present, bool):
        raise CuePlanValidationError(f"Cue {index + 1} sourceDbPresent must be boolean.")
    rekordbox_color = _nullable_int(raw.get("rekordboxColor"), f"Cue {index + 1} rekordboxColor")
    if family == "memory":
        if rekordbox_color is None:
            qualifier = "Imported " if source_db_present else ""
            raise CuePlanValidationError(
                f"{qualifier}Memory Cue {index + 1} is missing canonical Rekordbox Color metadata; "
                "refresh/re-import and rebase this draft before destructive apply."
            )
        if rekordbox_color != -1 and not 1 <= rekordbox_color <= 7:
            raise CuePlanValidationError(
                f"Memory Cue {index + 1} has an unsupported Rekordbox Color value."
            )

    beat_num = _nullable_int(raw.get("beatLoopNumerator"), f"Cue {index + 1} beatLoopNumerator")
    beat_den = _nullable_int(raw.get("beatLoopDenominator"), f"Cue {index + 1} beatLoopDenominator")
    if beat_num is not None and beat_num < 0:
        raise CuePlanValidationError(f"Cue {index + 1} beatLoopNumerator cannot be negative.")
    if beat_den is not None and beat_den <= 0:
        raise CuePlanValidationError(f"Cue {index + 1} beatLoopDenominator must be positive.")

    return PlannedCue(
        family=family,
        hot_cue_slot=slot,
        point_type=point_type,
        start_ms=start_ms,
        end_ms=end_ms,
        color_table_index=color_table_index,
        color_hex=_nullable_string(raw.get("colorHex"), f"Cue {index + 1} colorHex"),
        color_name=_nullable_string(raw.get("colorName"), f"Cue {index + 1} colorName"),
        comment=_nullable_string(raw.get("comment"), f"Cue {index + 1} comment"),
        is_active_loop=is_active_loop,
        beat_loop_numerator=beat_num,
        beat_loop_denominator=beat_den,
        rekordbox_kind=rekordbox_kind,
        imported_cue_id=_nullable_string(raw.get("importedCueId"), f"Cue {index + 1} importedCueId"),
        rekordbox_cue_id=_nullable_string(raw.get("rekordboxCueId"), f"Cue {index + 1} rekordboxCueId"),
        dedupe_key=_nullable_string(raw.get("dedupeKey"), f"Cue {index + 1} dedupeKey"),
        rekordbox_color=rekordbox_color,
        source_db_present=source_db_present,
    )


def adapt_saved_cue_drafts(saved_rows: Sequence[Mapping[str, Any]]) -> CueApplyPlan:
    """Create a deterministic plan from **persisted Stage 4 rows only**.

    The adapter intentionally accepts no database path, SQL, ContentUUID, shell
    command, or arbitrary destination field. Those values belong to the trusted
    desktop boundary and current local database, never cloud/renderer intent.
    """
    if not saved_rows:
        raise CuePlanValidationError("At least one saved cue draft is required.")

    tracks: list[PlannedTrack] = []
    seen_content_ids: set[str] = set()
    for row_index, row_value in enumerate(saved_rows):
        row = _mapping(row_value, f"savedRows[{row_index}]")
        revision = row.get("revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision <= 0:
            raise CuePlanValidationError("Saved cue draft revision must be a positive integer.")

        desired_fingerprint = _required_string(
            row.get("desiredFingerprint", row.get("desired_fingerprint")), "desiredFingerprint"
        )
        # Stage 10 separates immutable import provenance from the moving
        # comparison baseline. Prefer the explicit current baseline while
        # retaining the Stage 1/9 field as a backward-compatible fallback.
        baseline_fingerprint = _required_string(
            row.get(
                "currentBaselineFingerprint",
                row.get(
                    "current_baseline_fingerprint",
                    row.get("importedBaselineFingerprint", row.get("imported_baseline_fingerprint")),
                ),
            ),
            "currentBaselineFingerprint",
        )
        if not _HASH_RE.fullmatch(desired_fingerprint):
            raise CuePlanValidationError("desiredFingerprint must be a SHA-256 hex digest.")
        if not _HASH_RE.fullmatch(baseline_fingerprint):
            raise CuePlanValidationError(
                "currentBaselineFingerprint must be a SHA-256 hex digest."
            )

        document = _mapping(
            row.get("desiredDocument", row.get("desired_document")), "desiredDocument"
        )
        if document.get("schemaVersion") != CUE_DRAFT_SCHEMA_VERSION:
            raise CuePlanValidationError(
                f"Unsupported cue draft schema version: {document.get('schemaVersion')!r}."
            )

        import_id = _required_string(document.get("importId"), "desiredDocument.importId")
        track_id = _required_string(document.get("trackId"), "desiredDocument.trackId")
        rekordbox_content_id = _required_string(
            document.get("rekordboxContentId"), "desiredDocument.rekordboxContentId"
        )
        master_db_id = _nullable_string(
            row.get("masterDbId", row.get("master_db_id")), "masterDbId"
        )
        master_content_id = _nullable_string(
            row.get("masterContentId", row.get("master_content_id")), "masterContentId"
        )
        imported_baseline_local = _nullable_string(
            row.get(
                "currentBaselineLocalCueFingerprint",
                row.get(
                    "current_baseline_local_cue_fingerprint",
                    row.get(
                        "importedBaselineLocalCueFingerprint",
                        row.get("imported_baseline_local_cue_fingerprint"),
                    ),
                ),
            ),
            "currentBaselineLocalCueFingerprint",
        )
        if imported_baseline_local is not None and not _HASH_RE.fullmatch(imported_baseline_local):
            raise CuePlanValidationError(
                "currentBaselineLocalCueFingerprint must be a SHA-256 hex digest or null."
            )
        imported_baseline_local = imported_baseline_local.lower() if imported_baseline_local else None
        # DropDex already uses imported master_content_id as the local master-library
        # DjmdContent.ID in the existing Rekordbox bridge. Preserve that repository-native
        # identity contract here and let preflight fail closed when it is unavailable.
        content_id = master_content_id or rekordbox_content_id

        row_import = row.get("importId", row.get("import_id"))
        row_track = row.get("trackId", row.get("track_id"))
        row_content = row.get("rekordboxContentId", row.get("rekordbox_content_id"))
        if row_import is not None and str(row_import) != import_id:
            raise CuePlanValidationError("Saved draft import identity does not match its document.")
        if row_track is not None and str(row_track) != track_id:
            raise CuePlanValidationError("Saved draft track identity does not match its document.")
        if row_content is not None and str(row_content) != rekordbox_content_id:
            raise CuePlanValidationError("Saved draft ContentID does not match its document.")

        if content_id in seen_content_ids:
            raise CuePlanValidationError(f"Duplicate planned ContentID: {content_id}.")
        seen_content_ids.add(content_id)

        cue_values = document.get("cues")
        if not isinstance(cue_values, list):
            raise CuePlanValidationError("desiredDocument.cues must be an array.")
        cues = tuple(_parse_cue(raw, i) for i, raw in enumerate(cue_values))

        hot_slots = [cue.hot_cue_slot for cue in cues if cue.family == "hot"]
        if len(hot_slots) != len(set(hot_slots)):
            raise CuePlanValidationError("Saved draft contains duplicate Hot Cue slots.")

        tracks.append(
            PlannedTrack(
                import_id=import_id,
                track_id=track_id,
                content_id=content_id,
                rekordbox_content_id=rekordbox_content_id,
                master_db_id=master_db_id,
                master_content_id=master_content_id,
                draft_revision=revision,
                desired_fingerprint=desired_fingerprint,
                imported_baseline_fingerprint=baseline_fingerprint,
                imported_baseline_local_cue_fingerprint=imported_baseline_local,
                cues=cues,
            )
        )

    tracks.sort(key=lambda item: item.content_id)
    immutable_tracks = tuple(tracks)
    return CueApplyPlan(
        schema_version=WRITER_PLAN_SCHEMA_VERSION,
        plan_fingerprint=_fingerprint(_canonical_plan_payload(immutable_tracks)),
        tracks=immutable_tracks,
    )
