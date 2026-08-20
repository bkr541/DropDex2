"""Domain models for guarded local Rekordbox cue staging.

These models intentionally contain track/cue intent only.  Filesystem paths,
SQL, and caller-supplied ContentUUID values are not part of the writer input
contract.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Literal, Mapping, Sequence

CueFamily = Literal["hot", "memory"]
CuePointType = Literal["cue", "loop"]
CueSource = Literal["imported", "manual", "auto", "unknown"]

HOT_SLOT_TO_KIND: dict[int, int] = {
    1: 1,
    2: 2,
    3: 3,
    4: 5,
    5: 6,
    6: 7,
    7: 8,
    8: 9,
}


class CuePlanValidationError(ValueError):
    """Raised when caller-provided cue intent is not safe/deterministic."""


@dataclass(frozen=True, slots=True)
class CueIntent:
    family: CueFamily
    point_type: CuePointType
    start_ms: int
    end_ms: int | None = None
    hot_cue_slot: int | None = None
    paired_hot_cue_slot: int | None = None
    color: int | None = None
    color_table_index: int | None = None
    comment: str | None = None
    is_active_loop: bool | None = None
    source: CueSource = "unknown"
    semantic: str | None = None
    strategy_version: str | None = None
    strategy_settings: Mapping[str, Any] | None = None

    def validate(self) -> None:
        if self.family not in ("hot", "memory"):
            raise CuePlanValidationError(f"Unsupported cue family: {self.family!r}")
        if self.point_type not in ("cue", "loop"):
            raise CuePlanValidationError(f"Unsupported cue point type: {self.point_type!r}")
        if (
            isinstance(self.start_ms, bool)
            or not isinstance(self.start_ms, int)
            or self.start_ms < 0
        ):
            raise CuePlanValidationError("Cue start_ms must be a non-negative integer")

        if self.point_type == "loop":
            if (
                isinstance(self.end_ms, bool)
                or not isinstance(self.end_ms, int)
                or self.end_ms <= self.start_ms
            ):
                raise CuePlanValidationError("Loop end_ms must be an integer greater than start_ms")
        elif self.end_ms is not None:
            raise CuePlanValidationError("Point cues must not include end_ms")

        if self.family == "hot":
            if self.hot_cue_slot not in HOT_SLOT_TO_KIND:
                raise CuePlanValidationError("Hot cues require a slot from 1 through 8 (A-H)")
            if self.paired_hot_cue_slot is not None:
                raise CuePlanValidationError("Hot cues must not include paired_hot_cue_slot")
        else:
            if self.hot_cue_slot is not None:
                raise CuePlanValidationError("Memory cues must not include hot_cue_slot")
            if (
                self.paired_hot_cue_slot is not None
                and self.paired_hot_cue_slot not in HOT_SLOT_TO_KIND
            ):
                raise CuePlanValidationError("paired_hot_cue_slot must be 1 through 8 when present")

        if self.comment is not None and len(self.comment) > 255:
            raise CuePlanValidationError("Cue comments must be 255 characters or fewer")
        if self.color_table_index is not None and isinstance(self.color_table_index, bool):
            raise CuePlanValidationError("color_table_index must be an integer or null")
        if self.color_table_index is not None and not isinstance(self.color_table_index, int):
            raise CuePlanValidationError("color_table_index must be an integer or null")
        if self.color is not None and isinstance(self.color, bool):
            raise CuePlanValidationError("color must be an integer or null")
        if self.color is not None and not isinstance(self.color, int):
            raise CuePlanValidationError("color must be an integer or null")


@dataclass(frozen=True, slots=True)
class TrackCueIntent:
    content_id: str
    cues: tuple[CueIntent, ...] = ()

    def validate(self) -> None:
        content_id = self.content_id.strip()
        if not content_id:
            raise CuePlanValidationError("Track content_id must be non-empty")
        if content_id != self.content_id:
            raise CuePlanValidationError("Track content_id must not contain surrounding whitespace")

        occupied_hot_slots: set[int] = set()
        for cue in self.cues:
            cue.validate()
            if cue.family == "hot":
                assert cue.hot_cue_slot is not None
                if cue.hot_cue_slot in occupied_hot_slots:
                    raise CuePlanValidationError(
                        f"Track {self.content_id} contains duplicate Hot Cue slot "
                        f"{cue.hot_cue_slot}"
                    )
                occupied_hot_slots.add(cue.hot_cue_slot)


@dataclass(frozen=True, slots=True)
class CueApplyPlan:
    """Complete desired cue state for one or more Rekordbox ContentIDs."""

    tracks: tuple[TrackCueIntent, ...]
    schema_version: int = 1
    baseline_fingerprint: str | None = None
    draft_revision: int | None = None

    def validate(self) -> None:
        if self.schema_version != 1:
            raise CuePlanValidationError(
                f"Unsupported cue plan schema_version: {self.schema_version}"
            )
        if not self.tracks:
            raise CuePlanValidationError("Cue apply plan must contain at least one track")
        if self.draft_revision is not None and self.draft_revision < 0:
            raise CuePlanValidationError("draft_revision must be non-negative when present")

        seen_content_ids: set[str] = set()
        for track in self.tracks:
            track.validate()
            if track.content_id in seen_content_ids:
                raise CuePlanValidationError(
                    f"Cue apply plan contains duplicate ContentID {track.content_id}"
                )
            seen_content_ids.add(track.content_id)

    def fingerprint(self) -> str:
        """Return a deterministic fingerprint of writer-relevant desired state."""
        self.validate()
        payload = {
            "schemaVersion": self.schema_version,
            "tracks": [
                {
                    "contentId": track.content_id,
                    "cues": [
                        {
                            "family": cue.family,
                            "pointType": cue.point_type,
                            "startMs": cue.start_ms,
                            "endMs": cue.end_ms,
                            "hotCueSlot": cue.hot_cue_slot,
                            "pairedHotCueSlot": cue.paired_hot_cue_slot,
                            "color": cue.color,
                            "colorTableIndex": cue.color_table_index,
                            "comment": cue.comment,
                            "isActiveLoop": cue.is_active_loop,
                            "source": cue.source,
                            "semantic": cue.semantic,
                            "strategyVersion": cue.strategy_version,
                            "strategySettings": cue.strategy_settings,
                        }
                        for cue in sorted(track.cues, key=_cue_sort_key)
                    ],
                }
                for track in sorted(self.tracks, key=lambda item: item.content_id)
            ],
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
        return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True, slots=True)
class ProcessState:
    safe_to_write: bool
    running: bool | None
    supported: bool
    reason: str


@dataclass(frozen=True, slots=True)
class LocalDbIdentity:
    display_name: str
    source_sha256: str
    storage_kind: str


@dataclass(frozen=True, slots=True)
class CueTrackSummary:
    content_id: str
    found: bool
    current_cue_count: int
    desired_cue_count: int
    current_fingerprint: str | None = None
    desired_fingerprint: str | None = None


@dataclass(frozen=True, slots=True)
class CueApplyVerification:
    verified: bool
    tracks_verified: int
    cues_verified: int
    mismatches: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RekordboxWritePreflight:
    """Display-safe result of the Stage 5 staging/preflight operation."""

    ok: bool
    operation_id: str | None
    local_db: LocalDbIdentity | None
    process_state: ProcessState
    plan_fingerprint: str | None
    backup_created: bool = False
    backup_name: str | None = None
    staging_created: bool = False
    staging_name: str | None = None
    tracks: tuple[CueTrackSummary, ...] = ()
    verification: CueApplyVerification | None = None
    warnings: tuple[str, ...] = ()
    blockers: tuple[str, ...] = ()


def _cue_sort_key(cue: CueIntent) -> tuple[int, int, int, int]:
    family_rank = 0 if cue.family == "hot" else 1
    slot = cue.hot_cue_slot or cue.paired_hot_cue_slot or 99
    point_rank = 0 if cue.point_type == "cue" else 1
    return (family_rank, slot, cue.start_ms, point_rank)


def cue_sequence(value: Sequence[CueIntent]) -> tuple[CueIntent, ...]:
    """Small helper for callers constructing immutable cue plans."""
    return tuple(value)
