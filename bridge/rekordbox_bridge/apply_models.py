"""Internal Stage 6 models for verified local Rekordbox apply operations."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Mapping, Optional, Tuple

from .cue_diff import CueTrackDiff


@dataclass(frozen=True)
class ApplyDiagnostic:
    code: str
    message: str


@dataclass(frozen=True)
class PreflightTrackResult:
    content_id: str
    exists: bool
    current_cue_fingerprint: Optional[str]
    draft_revision: int
    desired_fingerprint: str
    imported_baseline_fingerprint: str
    imported_baseline_comparison: Literal["match", "diverged", "missing", "not-comparable"] = "not-comparable"
    identity_comparison: Literal["match", "missing", "mismatch", "not-comparable"] = "not-comparable"
    diff: Optional[CueTrackDiff] = None


@dataclass(frozen=True)
class ApplyPreflightResult:
    ok: bool
    preflight_id: str
    plan_fingerprint: str
    source_identity: Optional[str]
    tracks: Tuple[PreflightTrackResult, ...]
    blockers: Tuple[ApplyDiagnostic, ...] = ()
    warnings: Tuple[ApplyDiagnostic, ...] = ()
    token: Optional[str] = None
    expires_at: Optional[str] = None


@dataclass(frozen=True)
class ApplyTrackResult:
    content_id: str
    state: Literal["verified", "not-verified"]
    expected_count: int
    actual_count: int
    details: Optional[str] = None


@dataclass(frozen=True)
class VerifiedApplyResult:
    ok: bool
    operation_id: str
    state: Literal["applied", "rejected", "rolled-back", "recovery-unverified"]
    plan_fingerprint: str
    source_identity_before: Optional[str] = None
    source_identity_after: Optional[str] = None
    backup_identity: Optional[str] = None
    tracks: Tuple[ApplyTrackResult, ...] = ()
    blockers: Tuple[ApplyDiagnostic, ...] = ()
    warnings: Tuple[ApplyDiagnostic, ...] = ()
    rollback_verified: Optional[bool] = None
    recovery: Optional[Mapping[str, str]] = None
