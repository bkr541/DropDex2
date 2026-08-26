"""Internal Stage 5 models for saved cue plans and staging evidence."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping, Optional, Tuple

CueFamily = Literal["hot", "memory"]
CuePointType = Literal["cue", "loop"]


@dataclass(frozen=True)
class PlannedCue:
    family: CueFamily
    hot_cue_slot: Optional[int]
    point_type: CuePointType
    start_ms: float
    end_ms: Optional[float]
    color_table_index: Optional[int]
    color_hex: Optional[str]
    color_name: Optional[str]
    comment: Optional[str]
    is_active_loop: Optional[bool]
    beat_loop_numerator: Optional[int]
    beat_loop_denominator: Optional[int]
    rekordbox_kind: Optional[int]
    imported_cue_id: Optional[str] = None
    rekordbox_cue_id: Optional[str] = None
    dedupe_key: Optional[str] = None
    rekordbox_color: Optional[int] = None
    source_db_present: bool = False


@dataclass(frozen=True)
class PlannedTrack:
    import_id: str
    track_id: str
    content_id: str
    rekordbox_content_id: str
    master_db_id: Optional[str]
    master_content_id: Optional[str]
    draft_revision: int
    desired_fingerprint: str
    imported_baseline_fingerprint: str
    imported_baseline_local_cue_fingerprint: Optional[str]
    cues: Tuple[PlannedCue, ...]


@dataclass(frozen=True)
class CueApplyPlan:
    schema_version: int
    plan_fingerprint: str
    tracks: Tuple[PlannedTrack, ...]


@dataclass(frozen=True)
class TargetSafetyResult:
    eligible: bool
    code: str
    message: str
    source_identity: Optional[str] = None


@dataclass(frozen=True)
class ProcessSafetyResult:
    state: Literal["closed", "running", "unknown"]
    code: str
    message: str

    @property
    def eligible(self) -> bool:
        return self.state == "closed"


@dataclass(frozen=True)
class StagingGeneration:
    """Internal paths plus non-sensitive identities for one isolated generation."""

    operation_id: str
    source_path: Path
    backup_path: Path
    staging_path: Path
    source_identity: str
    backup_identity: str
    staging_identity: str


@dataclass(frozen=True)
class VerificationMismatch:
    content_id: str
    expected_count: int
    actual_count: int
    details: str


@dataclass(frozen=True)
class StagingVerificationResult:
    ok: bool
    verified_content_ids: Tuple[str, ...]
    mismatches: Tuple[VerificationMismatch, ...] = ()


@dataclass(frozen=True)
class StagingOperationResult:
    ok: bool
    operation_id: str
    plan_fingerprint: str
    source_identity: str
    backup_identity: str
    staging_identity: str
    verification: StagingVerificationResult
    blockers: Tuple[Mapping[str, str], ...] = ()
    warnings: Tuple[str, ...] = ()
