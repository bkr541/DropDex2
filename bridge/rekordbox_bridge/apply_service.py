"""Stage 6 verified transactional apply service for trusted local Rekordbox.

This module is intentionally internal. It has no CLI, Electron, preload, or
renderer entry point. Callers provide persisted Stage 4 saved draft rows, never
working editor state or filesystem paths.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import shutil
import stat
import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from .apply_models import (
    ApplyDiagnostic,
    ApplyPreflightResult,
    ApplyTrackResult,
    PreflightTrackResult,
    VerifiedApplyResult,
)
from .security import (
    StagingSafetyError,
    create_backup_and_staging,
    discover_trusted_writer_target,
    file_identity,
    readonly_snapshot,
    require_rekordbox_closed,
)
from .writer import (
    VERIFY_FIELDS,
    StagingWriterError,
    _close_db,
    _cue_rows_for_content,
    _load_pyrekordbox,
    mutate_staging_database,
    verify_database,
    verify_staging_database,
)
from .writer_models import CueApplyPlan, StagingGeneration, StagingVerificationResult
from .writer_plan import CuePlanValidationError, adapt_saved_cue_drafts

DEFAULT_TOKEN_TTL_SECONDS = 120
_SQLITE_SIDECAR_SUFFIXES = ("-wal", "-shm", "-journal")
_APPLY_LOCK = threading.Lock()


@dataclass(frozen=True)
class _ObservedTrack:
    content_id: str
    exists: bool
    cue_fingerprint: Optional[str]


@dataclass(frozen=True)
class _TokenRecord:
    preflight_id: str
    source_identity: str
    plan_fingerprint: str
    draft_identity: tuple[tuple[str, int, str], ...]
    track_fingerprints: tuple[tuple[str, Optional[str]], ...]
    issued_at: datetime
    expires_at: datetime


class _TokenClaimError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ApplyTokenStore:
    """Process-local single-use token registry.

    Stage 6 deliberately keeps the token authority inside the desktop bridge.
    A future renderer may carry an opaque token string, but it cannot mint,
    inspect, extend, or replay the bridge-owned record behind that string.
    """

    def __init__(self) -> None:
        self._records: dict[str, _TokenRecord] = {}
        self._consumed: set[str] = set()
        self._lock = threading.Lock()

    @staticmethod
    def _digest(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def issue(self, record: _TokenRecord) -> str:
        token = secrets.token_urlsafe(32)
        digest = self._digest(token)
        with self._lock:
            self._records[digest] = record
        return token

    def claim(self, token: str, now: datetime) -> _TokenRecord:
        if not isinstance(token, str) or not token:
            raise _TokenClaimError("token-invalid", "Apply token is missing or invalid.")
        digest = self._digest(token)
        with self._lock:
            if digest in self._consumed:
                raise _TokenClaimError("token-replayed", "Apply token has already been consumed.")
            record = self._records.pop(digest, None)
            if record is None:
                raise _TokenClaimError("token-invalid", "Apply token is unknown to this bridge.")
            self._consumed.add(digest)
        if now >= record.expires_at:
            raise _TokenClaimError("token-expired", "Apply token has expired; run preflight again.")
        return record


_TOKEN_STORE = ApplyTokenStore()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _diagnostic(code: str, message: str) -> ApplyDiagnostic:
    return ApplyDiagnostic(code=code, message=message)


def _sidecar_paths(database_path: Path) -> tuple[Path, ...]:
    return tuple(Path(f"{database_path}{suffix}") for suffix in _SQLITE_SIDECAR_SUFFIXES)


def _sidecar_names_present(database_path: Path) -> tuple[str, ...]:
    return tuple(path.name for path in _sidecar_paths(database_path) if path.exists())


def _require_single_file_generation(database_path: Path) -> None:
    present = _sidecar_names_present(database_path)
    if present:
        raise StagingSafetyError(
            "SQLite sidecar state is present; a single-file atomic master.db generation "
            f"cannot be proven safe ({', '.join(present)})."
        )


def _json_scalar(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return str(value)
        return round(value, 6)
    if isinstance(value, bytes):
        return {"bytesHex": value.hex()}
    return str(value)


def _cue_fingerprint(content_id: str, content_uuid: str, rows: Sequence[Any]) -> str:
    normalized = [
        {field: _json_scalar(getattr(row, field, None)) for field in VERIFY_FIELDS}
        for row in rows
    ]
    normalized.sort(
        key=lambda value: json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        )
    )
    payload = {
        "schemaVersion": 1,
        "contentId": content_id,
        "contentUuid": content_uuid,
        "cues": normalized,
    }
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _resolve_content(db: Any, content_id: str) -> Any | None:
    try:
        content = db.get_content(ID=content_id)
    except Exception as exc:  # noqa: BLE001 - database adapters vary
        raise StagingWriterError(f"Could not resolve planned ContentID {content_id}.") from exc
    if content is None:
        return None
    if isinstance(content, (list, tuple)):
        if len(content) != 1:
            raise StagingWriterError(f"Planned ContentID {content_id} is not uniquely resolvable.")
        content = content[0]
    resolved_id = getattr(content, "ID", None)
    content_uuid = getattr(content, "UUID", None)
    if resolved_id is None or str(resolved_id) != content_id or not content_uuid:
        raise StagingWriterError(f"Planned ContentID {content_id} has invalid local identity data.")
    return content


def _observe_snapshot(
    snapshot_path: Path,
    plan: CueApplyPlan,
    *,
    database_factory: Optional[Callable[[str], Any]] = None,
) -> tuple[_ObservedTrack, ...]:
    if database_factory is None:
        database_factory, _ = _load_pyrekordbox()
    db = database_factory(str(snapshot_path))
    observed: list[_ObservedTrack] = []
    try:
        for track in plan.tracks:
            content = _resolve_content(db, track.content_id)
            if content is None:
                observed.append(_ObservedTrack(track.content_id, False, None))
                continue
            rows = _cue_rows_for_content(db, track.content_id)
            observed.append(
                _ObservedTrack(
                    content_id=track.content_id,
                    exists=True,
                    cue_fingerprint=_cue_fingerprint(
                        track.content_id, str(getattr(content, "UUID")), rows
                    ),
                )
            )
    finally:
        _close_db(db)
    return tuple(observed)


def _observe_live_without_mutation(
    source: Path,
    plan: CueApplyPlan,
    *,
    database_factory: Optional[Callable[[str], Any]] = None,
) -> tuple[str, tuple[_ObservedTrack, ...]]:
    """Read a private copy and prove the live generation did not change."""
    _require_single_file_generation(source)
    before = file_identity(source)
    with readonly_snapshot(source) as snapshot:
        observed = _observe_snapshot(snapshot, plan, database_factory=database_factory)
    after = file_identity(source)
    _require_single_file_generation(source)
    if before != after:
        raise StagingSafetyError("Trusted local master.db changed during read-only observation.")
    return after, observed


def _draft_identity(plan: CueApplyPlan) -> tuple[tuple[str, int, str], ...]:
    return tuple(
        (track.content_id, track.draft_revision, track.desired_fingerprint)
        for track in plan.tracks
    )


def _observed_fingerprint_identity(
    observed: Sequence[_ObservedTrack],
) -> tuple[tuple[str, Optional[str]], ...]:
    return tuple((track.content_id, track.cue_fingerprint) for track in observed)


def _optional_imported_local_fingerprint(row: Mapping[str, Any]) -> Optional[str]:
    value = row.get(
        "importedBaselineLocalCueFingerprint",
        row.get("imported_baseline_local_cue_fingerprint"),
    )
    if not isinstance(value, str) or len(value) != 64:
        return None
    try:
        int(value, 16)
    except ValueError:
        return None
    return value.lower()


def _preflight_track_results(
    plan: CueApplyPlan,
    observed: Sequence[_ObservedTrack],
    saved_rows: Sequence[Mapping[str, Any]],
) -> tuple[PreflightTrackResult, ...]:
    observed_by_id = {item.content_id: item for item in observed}
    rows_by_content: dict[str, Mapping[str, Any]] = {}
    for row in saved_rows:
        content_id = row.get("rekordboxContentId", row.get("rekordbox_content_id"))
        document = row.get("desiredDocument", row.get("desired_document"))
        if content_id is None and isinstance(document, Mapping):
            content_id = document.get("rekordboxContentId")
        if content_id is not None:
            rows_by_content[str(content_id)] = row

    results: list[PreflightTrackResult] = []
    for track in plan.tracks:
        current = observed_by_id[track.content_id]
        comparable = _optional_imported_local_fingerprint(rows_by_content.get(track.content_id, {}))
        if comparable is None or current.cue_fingerprint is None:
            comparison = "not-comparable"
        elif comparable == current.cue_fingerprint:
            comparison = "match"
        else:
            comparison = "diverged"
        results.append(
            PreflightTrackResult(
                content_id=track.content_id,
                exists=current.exists,
                current_cue_fingerprint=current.cue_fingerprint,
                draft_revision=track.draft_revision,
                desired_fingerprint=track.desired_fingerprint,
                imported_baseline_fingerprint=track.imported_baseline_fingerprint,
                imported_baseline_comparison=comparison,
            )
        )
    return tuple(results)


def preflight_saved_cue_drafts(
    saved_rows: Sequence[Mapping[str, Any]],
    *,
    token_store: Optional[ApplyTokenStore] = None,
    token_ttl_seconds: int = DEFAULT_TOKEN_TTL_SECONDS,
    now: Optional[datetime] = None,
    discover_target: Callable[[], tuple[Path, Any]] = discover_trusted_writer_target,
    require_closed: Callable[[], Any] = require_rekordbox_closed,
    database_factory: Optional[Callable[[str], Any]] = None,
) -> ApplyPreflightResult:
    """Read-only Stage 6 preflight. No live DB, backup, staging, or renderer mutation."""
    preflight_id = uuid4().hex
    now = now or _utc_now()
    token_store = token_store or _TOKEN_STORE
    if token_ttl_seconds <= 0:
        return ApplyPreflightResult(
            ok=False,
            preflight_id=preflight_id,
            plan_fingerprint="",
            source_identity=None,
            tracks=(),
            blockers=(_diagnostic("token-ttl-invalid", "Token TTL must be positive."),),
        )

    try:
        plan = adapt_saved_cue_drafts(saved_rows)
    except CuePlanValidationError as exc:
        return ApplyPreflightResult(
            ok=False,
            preflight_id=preflight_id,
            plan_fingerprint="",
            source_identity=None,
            tracks=(),
            blockers=(_diagnostic("saved-plan-invalid", str(exc)),),
        )

    try:
        source, target_result = discover_target()
        require_closed()
        _require_single_file_generation(source)
        source_identity, observed = _observe_live_without_mutation(
            source, plan, database_factory=database_factory
        )
        if target_result.source_identity and target_result.source_identity != source_identity:
            raise StagingSafetyError("Trusted target identity changed during preflight.")
    except Exception as exc:  # noqa: BLE001 - preflight returns structured blockers
        return ApplyPreflightResult(
            ok=False,
            preflight_id=preflight_id,
            plan_fingerprint=plan.plan_fingerprint,
            source_identity=None,
            tracks=(),
            blockers=(_diagnostic("preflight-blocked", str(exc)),),
        )

    track_results = _preflight_track_results(plan, observed, saved_rows)
    blockers = tuple(
        _diagnostic(
            "target-track-missing",
            f"ContentID {track.content_id} is not present in current local Rekordbox.",
        )
        for track in track_results
        if not track.exists
    )
    warnings: list[ApplyDiagnostic] = []
    if any(track.imported_baseline_comparison == "diverged" for track in track_results):
        warnings.append(
            _diagnostic(
                "imported-baseline-diverged",
                "Imported baseline differs from current local Rekordbox; this is informational only.",
            )
        )
    if any(track.imported_baseline_comparison == "not-comparable" for track in track_results):
        warnings.append(
            _diagnostic(
                "imported-baseline-not-comparable",
                "Stage 4 stores its imported baseline document fingerprint, which is not the "
                "same canonical schema as Stage 6 local cue fingerprints; no stale-state "
                "decision is made from that baseline.",
            )
        )
    if blockers:
        return ApplyPreflightResult(
            ok=False,
            preflight_id=preflight_id,
            plan_fingerprint=plan.plan_fingerprint,
            source_identity=source_identity,
            tracks=track_results,
            blockers=blockers,
            warnings=tuple(warnings),
        )

    expires_at = now + timedelta(seconds=token_ttl_seconds)
    record = _TokenRecord(
        preflight_id=preflight_id,
        source_identity=source_identity,
        plan_fingerprint=plan.plan_fingerprint,
        draft_identity=_draft_identity(plan),
        track_fingerprints=_observed_fingerprint_identity(observed),
        issued_at=now,
        expires_at=expires_at,
    )
    token = token_store.issue(record)
    return ApplyPreflightResult(
        ok=True,
        preflight_id=preflight_id,
        plan_fingerprint=plan.plan_fingerprint,
        source_identity=source_identity,
        tracks=track_results,
        warnings=tuple(warnings),
        token=token,
        expires_at=expires_at.isoformat(),
    )


def _fsync_file(path: Path) -> None:
    with path.open("rb") as handle:
        os.fsync(handle.fileno())


def _fsync_directory(path: Path) -> None:
    # Windows does not provide portable directory fsync through Python. os.replace
    # still gives the platform's atomic rename semantics; Darwin/Unix additionally
    # persist the directory entry before this function returns.
    if os.name == "nt":  # pragma: no cover - platform behavior documented in final report
        return
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _copy_durable_exclusive(source: Path, destination: Path, mode: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    created = False
    try:
        with source.open("rb") as src, destination.open("xb") as dst:
            created = True
            shutil.copyfileobj(src, dst, length=1024 * 1024)
            dst.flush()
            os.fsync(dst.fileno())
        destination.chmod(mode)
        _fsync_directory(destination.parent)
    except Exception:  # noqa: BLE001 - remove only this invocation's partial file
        if created:
            try:
                destination.unlink(missing_ok=True)
            except OSError:
                pass
        raise


def _prepare_rollback_candidate(generation: StagingGeneration) -> Path:
    candidate = Path(generation.staging_path).parent / "rollback-master.db"
    source_mode = stat.S_IMODE(Path(generation.source_path).stat().st_mode)
    _copy_durable_exclusive(Path(generation.backup_path), candidate, source_mode)
    if file_identity(candidate) != generation.backup_identity:
        candidate.unlink(missing_ok=True)
        raise StagingSafetyError("Rollback candidate does not match the durable recovery backup.")
    _require_single_file_generation(candidate)
    return candidate


def _atomic_replace_generation(
    candidate: Path,
    target: Path,
    *,
    expected_target_identity: str,
) -> str:
    """Guard and atomically replace one trusted same-filesystem DB generation."""
    _require_single_file_generation(target)
    _require_single_file_generation(candidate)
    if file_identity(target) != expected_target_identity:
        raise StagingSafetyError("Live master.db changed immediately before atomic replacement.")
    candidate_stat = candidate.stat()
    target_stat = target.stat()
    parent_stat = target.parent.stat()
    if not stat.S_ISREG(candidate_stat.st_mode) or not stat.S_ISREG(target_stat.st_mode):
        raise StagingSafetyError("Atomic replacement requires regular database files.")
    if candidate_stat.st_dev != parent_stat.st_dev:
        raise StagingSafetyError("Atomic replacement candidate is not on the live filesystem.")

    candidate.chmod(stat.S_IMODE(target_stat.st_mode))
    _fsync_file(candidate)
    _fsync_directory(candidate.parent)
    os.replace(candidate, target)
    _fsync_file(target)
    _fsync_directory(target.parent)
    _require_single_file_generation(target)
    return file_identity(target)


def _verification_track_results(
    plan: CueApplyPlan,
    verification: Optional[StagingVerificationResult],
    expected: Mapping[str, Sequence[Mapping[str, Any]]],
) -> tuple[ApplyTrackResult, ...]:
    if verification is None:
        return ()
    mismatches = {mismatch.content_id: mismatch for mismatch in verification.mismatches}
    results: list[ApplyTrackResult] = []
    for track in plan.tracks:
        mismatch = mismatches.get(track.content_id)
        if mismatch is None and track.content_id in verification.verified_content_ids:
            count = len(expected.get(track.content_id, ()))
            results.append(ApplyTrackResult(track.content_id, "verified", count, count))
        else:
            expected_count = len(expected.get(track.content_id, ()))
            actual_count = mismatch.actual_count if mismatch else 0
            details = mismatch.details if mismatch else "Track did not reach verified state."
            results.append(
                ApplyTrackResult(
                    track.content_id,
                    "not-verified",
                    expected_count,
                    actual_count,
                    details,
                )
            )
    return tuple(results)


def _verify_live_copy(
    source: Path,
    plan: CueApplyPlan,
    expected: Mapping[str, Sequence[Mapping[str, Any]]],
    *,
    database_factory: Optional[Callable[[str], Any]] = None,
) -> tuple[str, StagingVerificationResult]:
    _require_single_file_generation(source)
    before = file_identity(source)
    with readonly_snapshot(source) as snapshot:
        verification = verify_database(
            plan,
            snapshot,
            expected,
            database_factory=database_factory,
            context="live database",
        )
    after = file_identity(source)
    _require_single_file_generation(source)
    if before != after:
        raise StagingSafetyError("Live master.db changed during final verification.")
    return after, verification


def _verify_rollback(
    source: Path,
    plan: CueApplyPlan,
    record: _TokenRecord,
    *,
    database_factory: Optional[Callable[[str], Any]] = None,
) -> bool:
    identity, observed = _observe_live_without_mutation(
        source, plan, database_factory=database_factory
    )
    return (
        identity == record.source_identity
        and _observed_fingerprint_identity(observed) == record.track_fingerprints
    )


def _cleanup_staging_paths(generation: StagingGeneration, rollback_candidate: Optional[Path]) -> None:
    for path in (rollback_candidate, Path(generation.staging_path)):
        if path is None:
            continue
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        for sidecar in _sidecar_paths(path):
            try:
                sidecar.unlink(missing_ok=True)
            except OSError:
                pass
    try:
        Path(generation.staging_path).parent.rmdir()
    except OSError:
        pass


def _rejected_result(
    operation_id: str,
    plan_fingerprint: str,
    code: str,
    message: str,
    *,
    source_identity_before: Optional[str] = None,
    backup_identity: Optional[str] = None,
    warnings: tuple[ApplyDiagnostic, ...] = (),
) -> VerifiedApplyResult:
    return VerifiedApplyResult(
        ok=False,
        operation_id=operation_id,
        state="rejected",
        plan_fingerprint=plan_fingerprint,
        source_identity_before=source_identity_before,
        backup_identity=backup_identity,
        blockers=(_diagnostic(code, message),),
        warnings=warnings,
    )


def apply_saved_cue_drafts(
    preflight_token: str,
    saved_rows: Sequence[Mapping[str, Any]],
    *,
    token_store: Optional[ApplyTokenStore] = None,
    now: Optional[datetime] = None,
    discover_target: Callable[[], tuple[Path, Any]] = discover_trusted_writer_target,
    require_closed: Callable[[], Any] = require_rekordbox_closed,
    database_factory: Optional[Callable[[str], Any]] = None,
    tables_module: Any = None,
    create_generation: Callable[..., StagingGeneration] = create_backup_and_staging,
    replace_generation: Callable[..., str] = _atomic_replace_generation,
    after_replace_hook: Optional[Callable[[Path], None]] = None,
    after_rollback_hook: Optional[Callable[[Path], None]] = None,
) -> VerifiedApplyResult:
    """Apply one saved plan as a verified old-generation -> new-generation transition."""
    operation_id = uuid4().hex
    now = now or _utc_now()
    token_store = token_store or _TOKEN_STORE

    try:
        plan = adapt_saved_cue_drafts(saved_rows)
    except CuePlanValidationError as exc:
        return _rejected_result(operation_id, "", "saved-plan-invalid", str(exc))

    if not _APPLY_LOCK.acquire(blocking=False):
        return _rejected_result(
            operation_id,
            plan.plan_fingerprint,
            "apply-in-progress",
            "Another verified Rekordbox apply operation is already in progress.",
        )

    generation: Optional[StagingGeneration] = None
    rollback_candidate: Optional[Path] = None
    expected: Mapping[str, Sequence[Mapping[str, Any]]] = {}
    final_verification: Optional[StagingVerificationResult] = None
    try:
        try:
            record = token_store.claim(preflight_token, now)
        except _TokenClaimError as exc:
            return _rejected_result(operation_id, plan.plan_fingerprint, exc.code, exc.message)

        if plan.plan_fingerprint != record.plan_fingerprint or _draft_identity(plan) != record.draft_identity:
            return _rejected_result(
                operation_id,
                plan.plan_fingerprint,
                "saved-plan-changed",
                "Saved draft revision or desired plan changed after preflight.",
                source_identity_before=record.source_identity,
            )

        try:
            source, target_result = discover_target()
            require_closed()
            _require_single_file_generation(source)
        except Exception as exc:  # noqa: BLE001 - apply safety failures are structured
            return _rejected_result(
                operation_id,
                plan.plan_fingerprint,
                "apply-safety-blocked",
                str(exc),
                source_identity_before=record.source_identity,
            )

        discovered_identity = target_result.source_identity or file_identity(source)
        try:
            observed_identity, observed = _observe_live_without_mutation(
                source, plan, database_factory=database_factory
            )
        except Exception as exc:  # noqa: BLE001 - local revalidation failures are structured
            return _rejected_result(
                operation_id,
                plan.plan_fingerprint,
                "local-revalidation-failed",
                str(exc),
                source_identity_before=record.source_identity,
            )
        if any(not item.exists for item in observed):
            return _rejected_result(
                operation_id,
                plan.plan_fingerprint,
                "target-track-missing",
                "One or more target ContentIDs disappeared after preflight.",
                source_identity_before=record.source_identity,
            )
        if _observed_fingerprint_identity(observed) != record.track_fingerprints:
            return _rejected_result(
                operation_id,
                plan.plan_fingerprint,
                "target-cues-stale",
                "Target cue state changed after preflight.",
                source_identity_before=record.source_identity,
            )
        if (
            observed_identity != record.source_identity
            or discovered_identity != observed_identity
        ):
            return _rejected_result(
                operation_id,
                plan.plan_fingerprint,
                "local-generation-stale",
                "Trusted local master.db generation changed after preflight.",
                source_identity_before=record.source_identity,
            )

        try:
            generation = create_generation(source, operation_id=operation_id)
            expected = mutate_staging_database(
                plan,
                generation,
                database_factory=database_factory,
                tables_module=tables_module,
            )
            staged_verification = verify_staging_database(
                plan,
                generation,
                expected,
                database_factory=database_factory,
            )
            if not staged_verification.ok:
                return VerifiedApplyResult(
                    ok=False,
                    operation_id=operation_id,
                    state="rejected",
                    plan_fingerprint=plan.plan_fingerprint,
                    source_identity_before=record.source_identity,
                    backup_identity=generation.backup_identity,
                    tracks=_verification_track_results(plan, staged_verification, expected),
                    blockers=(
                        _diagnostic(
                            "staging-verification-failed",
                            "Staging verification failed; live master.db was not replaced.",
                        ),
                    ),
                )
            _require_single_file_generation(Path(generation.staging_path))
            rollback_candidate = _prepare_rollback_candidate(generation)
        except Exception as exc:  # noqa: BLE001 - no live handoff has occurred yet
            return _rejected_result(
                operation_id,
                plan.plan_fingerprint,
                "staging-failed",
                str(exc),
                source_identity_before=record.source_identity,
                backup_identity=generation.backup_identity if generation else None,
            )

        try:
            # Deepest guard: immediately before the only normal-path live handoff,
            # rediscover through Stage 5 and re-check process + exact generation.
            guarded_source, guarded_result = discover_target()
            require_closed()
            if guarded_source.resolve(strict=True) != Path(generation.source_path).resolve(strict=True):
                raise StagingSafetyError("Trusted local writer target changed before replacement.")
            _require_single_file_generation(guarded_source)
            guarded_identity = guarded_result.source_identity or file_identity(guarded_source)
            if guarded_identity != record.source_identity:
                raise StagingSafetyError("Live master.db changed before replacement.")

            staged_identity = file_identity(Path(generation.staging_path))
            live_identity = replace_generation(
                Path(generation.staging_path),
                guarded_source,
                expected_target_identity=record.source_identity,
            )
            if live_identity != staged_identity:
                raise StagingSafetyError("Atomic replacement produced an unexpected live generation.")
            if after_replace_hook is not None:
                after_replace_hook(guarded_source)

            verified_identity, final_verification = _verify_live_copy(
                guarded_source,
                plan,
                expected,
                database_factory=database_factory,
            )
            if verified_identity != staged_identity or not final_verification.ok:
                raise StagingWriterError("Final live verification failed after atomic replacement.")
        except Exception as post_replace_exc:  # noqa: BLE001 - rollback must catch all handoff failures
            # If staging still exists, os.replace never happened and the live DB is
            # still the verified old generation. Do not perform a needless rollback.
            staging_still_exists = Path(generation.staging_path).exists()
            if staging_still_exists:
                return _rejected_result(
                    operation_id,
                    plan.plan_fingerprint,
                    "atomic-replacement-failed",
                    str(post_replace_exc),
                    source_identity_before=record.source_identity,
                    backup_identity=generation.backup_identity,
                )

            rollback_message = str(post_replace_exc)
            try:
                if rollback_candidate is None or not rollback_candidate.exists():
                    raise StagingSafetyError("Prepared rollback candidate is unavailable.")
                _require_single_file_generation(Path(generation.source_path))
                failed_identity = file_identity(Path(generation.source_path))
                restored_identity = replace_generation(
                    rollback_candidate,
                    Path(generation.source_path),
                    expected_target_identity=failed_identity,
                )
                if restored_identity != record.source_identity:
                    raise StagingSafetyError("Rollback replacement identity differs from preflight.")
                if after_rollback_hook is not None:
                    after_rollback_hook(Path(generation.source_path))
                rollback_verified = _verify_rollback(
                    Path(generation.source_path),
                    plan,
                    record,
                    database_factory=database_factory,
                )
                if not rollback_verified:
                    raise StagingSafetyError("Rollback reopened but did not verify old local state.")
                return VerifiedApplyResult(
                    ok=False,
                    operation_id=operation_id,
                    state="rolled-back",
                    plan_fingerprint=plan.plan_fingerprint,
                    source_identity_before=record.source_identity,
                    source_identity_after=record.source_identity,
                    backup_identity=generation.backup_identity,
                    tracks=_verification_track_results(plan, final_verification, expected),
                    blockers=(
                        _diagnostic(
                            "final-verification-failed",
                            f"{rollback_message} Original local generation was restored and verified.",
                        ),
                    ),
                    rollback_verified=True,
                )
            except Exception as rollback_exc:  # noqa: BLE001 - critical recovery state is structured
                return VerifiedApplyResult(
                    ok=False,
                    operation_id=operation_id,
                    state="recovery-unverified",
                    plan_fingerprint=plan.plan_fingerprint,
                    source_identity_before=record.source_identity,
                    source_identity_after=(
                        file_identity(Path(generation.source_path))
                        if Path(generation.source_path).exists()
                        else None
                    ),
                    backup_identity=generation.backup_identity,
                    tracks=_verification_track_results(plan, final_verification, expected),
                    blockers=(
                        _diagnostic(
                            "rollback-unverified",
                            f"Post-replacement failure: {rollback_message} Rollback could not be "
                            f"verified: {rollback_exc}",
                        ),
                    ),
                    rollback_verified=False,
                    recovery={
                        "operationId": generation.operation_id,
                        "backupIdentity": generation.backup_identity,
                        "status": "manual-recovery-required",
                    },
                )

        return VerifiedApplyResult(
            ok=True,
            operation_id=operation_id,
            state="applied",
            plan_fingerprint=plan.plan_fingerprint,
            source_identity_before=record.source_identity,
            source_identity_after=file_identity(Path(generation.source_path)),
            backup_identity=generation.backup_identity,
            tracks=_verification_track_results(plan, final_verification, expected),
            rollback_verified=None,
        )
    finally:
        if generation is not None:
            _cleanup_staging_paths(generation, rollback_candidate)
        _APPLY_LOCK.release()
