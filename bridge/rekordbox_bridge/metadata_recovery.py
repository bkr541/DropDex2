"""Read-only Genre recovery verification for Stage 6A cloud finalization.

Recovery is deliberately separate from the Stage 5 writer. It rediscovers the
trusted Rekordbox target, verifies strong master identity and the currently
resolved semantic Genre from an isolated read-only snapshot, and never calls a
mutation/staging/replacement path.
"""
from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Optional

from .metadata_preflight import (
    MetadataPlanValidationError,
    _genre_catalog,
    _genre_id_or_none,
    _load_database_factory,
    normalize_genre,
)
from .security import (
    discover_trusted_writer_target,
    file_identity,
    readonly_snapshot,
    require_rekordbox_closed,
)
from .writer import StagingWriterError, _close_db, _content_for_strong_identity

_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_RECOVERY_KEYS = {
    "operationId",
    "trackId",
    "field",
    "masterDbId",
    "masterContentId",
    "appliedRevision",
    "draftFingerprint",
    "planFingerprint",
    "appliedValue",
    "sourceIdentityAfter",
}


@dataclass(frozen=True)
class MetadataRecoveryDiagnostic:
    code: str
    message: str


@dataclass(frozen=True)
class MetadataRecoveryVerificationResult:
    ok: bool
    state: Literal["verified", "blocked"]
    operation_id: str
    track_id: str
    applied_revision: int
    draft_fingerprint: str
    plan_fingerprint: str
    expected_applied_value: Optional[str]
    current_value: Optional[str]
    source_identity_after_apply: str
    current_source_identity: Optional[str]
    source_generation_comparison: Literal["match", "changed", "unavailable"]
    master_identity_comparison: Literal["match", "mismatch", "unavailable"]
    blockers: tuple[MetadataRecoveryDiagnostic, ...] = ()


@dataclass(frozen=True)
class _RecoveryRequest:
    operation_id: str
    track_id: str
    master_db_id: str
    master_content_id: str
    applied_revision: int
    draft_fingerprint: str
    plan_fingerprint: str
    applied_value: Optional[str]
    source_identity_after: str


def _required_string(value: Any, label: str, *, max_length: int = 256) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > max_length:
        raise ValueError(f"{label} is invalid")
    return value.strip()


def _adapt_request(raw: Mapping[str, Any]) -> _RecoveryRequest:
    if set(raw) != _RECOVERY_KEYS:
        raise ValueError("metadata recovery request contains unsupported or missing fields")
    if raw.get("field") != "genre":
        raise ValueError("only Genre metadata recovery is supported")
    revision = raw.get("appliedRevision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision <= 0:
        raise ValueError("metadata recovery appliedRevision is invalid")

    draft_fingerprint = _required_string(raw.get("draftFingerprint"), "draftFingerprint", max_length=64)
    plan_fingerprint = _required_string(raw.get("planFingerprint"), "planFingerprint", max_length=64)
    source_identity_after = _required_string(raw.get("sourceIdentityAfter"), "sourceIdentityAfter", max_length=64)
    if not _HASH_RE.fullmatch(draft_fingerprint):
        raise ValueError("metadata recovery draftFingerprint is invalid")
    if not _HASH_RE.fullmatch(plan_fingerprint):
        raise ValueError("metadata recovery planFingerprint is invalid")
    if not _HASH_RE.fullmatch(source_identity_after):
        raise ValueError("metadata recovery sourceIdentityAfter is invalid")

    try:
        applied_value = normalize_genre(raw.get("appliedValue"), label="recovery appliedValue")
    except MetadataPlanValidationError as exc:
        raise ValueError(str(exc)) from exc

    return _RecoveryRequest(
        operation_id=_required_string(raw.get("operationId"), "operationId"),
        track_id=_required_string(raw.get("trackId"), "trackId"),
        master_db_id=_required_string(raw.get("masterDbId"), "masterDbId"),
        master_content_id=_required_string(raw.get("masterContentId"), "masterContentId"),
        applied_revision=revision,
        draft_fingerprint=draft_fingerprint,
        plan_fingerprint=plan_fingerprint,
        applied_value=applied_value,
        source_identity_after=source_identity_after,
    )


def _blocked(
    request: _RecoveryRequest,
    code: str,
    message: str,
    *,
    current_value: Optional[str] = None,
    current_source_identity: Optional[str] = None,
    master_identity_comparison: Literal["match", "mismatch", "unavailable"] = "unavailable",
) -> MetadataRecoveryVerificationResult:
    generation_comparison: Literal["match", "changed", "unavailable"] = "unavailable"
    if current_source_identity is not None:
        generation_comparison = (
            "match" if current_source_identity == request.source_identity_after else "changed"
        )
    return MetadataRecoveryVerificationResult(
        ok=False,
        state="blocked",
        operation_id=request.operation_id,
        track_id=request.track_id,
        applied_revision=request.applied_revision,
        draft_fingerprint=request.draft_fingerprint,
        plan_fingerprint=request.plan_fingerprint,
        expected_applied_value=request.applied_value,
        current_value=current_value,
        source_identity_after_apply=request.source_identity_after,
        current_source_identity=current_source_identity,
        source_generation_comparison=generation_comparison,
        master_identity_comparison=master_identity_comparison,
        blockers=(MetadataRecoveryDiagnostic(code=code, message=message),),
    )


def verify_metadata_recovery(
    raw_request: Mapping[str, Any],
    *,
    discover_target: Callable[[], tuple[Path, Any]] = discover_trusted_writer_target,
    require_closed: Callable[[], Any] = require_rekordbox_closed,
    database_factory: Optional[Callable[[str], Any]] = None,
) -> MetadataRecoveryVerificationResult:
    """Verify current local Genre/identity for a prior verified local operation.

    A changed whole-file generation is reported but does not by itself block
    recovery. Rekordbox may legitimately update unrelated data between the local
    apply and cloud retry. The safety gate is exact strong master identity plus
    the current semantic Genre for the scoped content row.
    """
    request = _adapt_request(raw_request)
    database_factory = database_factory or _load_database_factory()

    try:
        source, target_result = discover_target()
        require_closed()
        current_source_identity = getattr(target_result, "source_identity", None) or file_identity(source)
    except Exception as exc:  # noqa: BLE001 - structured fail-closed boundary
        return _blocked(
            request,
            "metadata-recovery-target-unavailable",
            str(exc),
        )

    try:
        with readonly_snapshot(source) as snapshot:
            db = database_factory(str(snapshot))
            try:
                content = _content_for_strong_identity(
                    db,
                    track_id=request.track_id,
                    content_id=request.master_content_id,
                    master_db_id=request.master_db_id,
                    master_content_id=request.master_content_id,
                    operation_label="metadata recovery verification",
                    require_master_db_id=True,
                )
                genres_by_id, _ = _genre_catalog(db)
                genre_id = _genre_id_or_none(getattr(content, "GenreID", None))
                if genre_id is None:
                    current_value = None
                else:
                    genre = genres_by_id.get(genre_id)
                    if genre is None:
                        return _blocked(
                            request,
                            "metadata-recovery-genre-relationship-missing",
                            "Current GenreID does not resolve to a DjmdGenre row.",
                            current_source_identity=current_source_identity,
                            master_identity_comparison="match",
                        )
                    current_value = normalize_genre(
                        getattr(genre, "Name", None),
                        label=f"DjmdGenre {genre_id}.Name",
                    )
            finally:
                _close_db(db)
    except StagingWriterError as exc:
        code = getattr(exc, "code", None) or "metadata-recovery-master-identity-mismatch"
        comparison: Literal["mismatch", "unavailable"] = (
            "unavailable" if "unavailable" in code or "missing" in code else "mismatch"
        )
        return _blocked(
            request,
            code,
            str(exc),
            current_source_identity=current_source_identity,
            master_identity_comparison=comparison,
        )
    except Exception as exc:  # noqa: BLE001
        return _blocked(
            request,
            "metadata-recovery-read-failed",
            str(exc),
            current_source_identity=current_source_identity,
        )

    if current_value != request.applied_value:
        return _blocked(
            request,
            "metadata-recovery-local-genre-changed",
            "Current local Genre no longer matches the previously verified applied value.",
            current_value=current_value,
            current_source_identity=current_source_identity,
            master_identity_comparison="match",
        )

    return MetadataRecoveryVerificationResult(
        ok=True,
        state="verified",
        operation_id=request.operation_id,
        track_id=request.track_id,
        applied_revision=request.applied_revision,
        draft_fingerprint=request.draft_fingerprint,
        plan_fingerprint=request.plan_fingerprint,
        expected_applied_value=request.applied_value,
        current_value=current_value,
        source_identity_after_apply=request.source_identity_after,
        current_source_identity=current_source_identity,
        source_generation_comparison=(
            "match" if current_source_identity == request.source_identity_after else "changed"
        ),
        master_identity_comparison="match",
    )
