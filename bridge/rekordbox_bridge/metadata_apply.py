"""Verified staged Rekordbox Genre apply for Genre Editing Stage 5.

This module consumes the opaque Stage 4 metadata-preflight token and applies
only persisted Genre drafts. It deliberately reuses the cue-grade trusted
writer target, backup/staging generation, atomic replacement, live reopen
verification, and rollback envelope. No caller supplies a filesystem path, SQL,
or local row override.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, Optional
from uuid import uuid4

from .apply_service import (
    _APPLY_LOCK,
    _atomic_replace_generation,
    _cleanup_staging_paths,
    _prepare_rollback_candidate,
    _require_single_file_generation,
)
from .metadata_preflight import (
    MetadataDiagnostic,
    MetadataPlanValidationError,
    MetadataPreflightPlan,
    MetadataPreflightTokenStore,
    MetadataTokenClaimError,
    MetadataTokenRecord,
    PlannedMetadataDraft,
    _METADATA_TOKEN_STORE,
    _blockers,
    _genre_catalog,
    _genre_id_or_none,
    _observe_live_without_mutation,
    _observed_identity,
    _preflight_plan_fingerprint,
    _utc_now,
    adapt_saved_metadata_drafts,
    normalize_genre,
)
from .security import (
    StagingSafetyError,
    create_backup_and_staging,
    discover_trusted_writer_target,
    file_identity,
    require_rekordbox_closed,
)
from .writer import StagingWriterError, _close_db, _content_for_strong_identity
from .writer_models import StagingGeneration


@dataclass(frozen=True)
class ExpectedGenreMutation:
    draft_id: str
    track_id: str
    content_id: str
    revision: int
    draft_fingerprint: str
    normalized_genre: Optional[str]
    resolved_genre_id: Optional[str]
    desired_resolution: Literal["reuse", "create", "clear"]
    created_genre: bool


@dataclass(frozen=True)
class MetadataVerificationMismatch:
    draft_id: str
    track_id: str
    content_id: str
    details: str


@dataclass(frozen=True)
class MetadataVerificationResult:
    ok: bool
    verified_draft_ids: tuple[str, ...]
    mismatches: tuple[MetadataVerificationMismatch, ...]


@dataclass(frozen=True)
class MetadataApplyTrackResult:
    draft_id: str
    track_id: str
    content_id: str
    state: Literal["verified", "not-verified"]
    applied_revision: int
    applied_fingerprint: str
    normalized_applied_genre: Optional[str]
    desired_resolution: Literal["reuse", "create", "clear"]
    resolved_genre_id: Optional[str]
    verification_state: Literal["verified", "failed", "not-run"]
    details: Optional[str] = None


@dataclass(frozen=True)
class MetadataApplyResult:
    ok: bool
    operation_id: str
    state: Literal["applied", "rejected", "rolled-back", "recovery-unverified"]
    plan_fingerprint: str
    source_identity_before: Optional[str] = None
    source_identity_after: Optional[str] = None
    backup_identity: Optional[str] = None
    tracks: tuple[MetadataApplyTrackResult, ...] = ()
    blockers: tuple[MetadataDiagnostic, ...] = ()
    warnings: tuple[MetadataDiagnostic, ...] = ()
    rollback_verified: Optional[bool] = None
    recovery: Optional[dict[str, str]] = None


def _diagnostic(code: str, message: str) -> MetadataDiagnostic:
    return MetadataDiagnostic(code=code, message=message)


def _draft_identity(plan: MetadataPreflightPlan) -> tuple[tuple[str, int, str], ...]:
    return tuple(
        (draft.draft_id, draft.revision, draft.draft_fingerprint) for draft in plan.drafts
    )


def _current_genre_value(content: Any, genres_by_id: Mapping[str, Any]) -> Optional[str]:
    genre_id = _genre_id_or_none(getattr(content, "GenreID", None))
    if genre_id is None:
        return None
    row = genres_by_id.get(genre_id)
    if row is None:
        raise StagingWriterError(
            f"GenreID {genre_id} does not resolve to a DjmdGenre row.",
            code="genre-relationship-missing",
        )
    value = normalize_genre(getattr(row, "Name", None), label=f"DjmdGenre {genre_id}.Name")
    if value is None:
        raise StagingWriterError(
            f"DjmdGenre {genre_id} has an empty Genre name.",
            code="genre-current-invalid",
        )
    return value


def _require_source_staging_isolation(generation: StagingGeneration) -> None:
    source = Path(generation.source_path)
    staging = Path(generation.staging_path)
    if source.resolve(strict=True) == staging.resolve(strict=True):
        raise StagingWriterError("Metadata staging path aliases the live source database.")
    try:
        source_stat = source.stat()
        staging_stat = staging.stat()
        if source_stat.st_ino == staging_stat.st_ino and source_stat.st_dev == staging_stat.st_dev:
            raise StagingWriterError(
                "Metadata staging database is the same filesystem object as the live source."
            )
    except OSError as exc:
        raise StagingWriterError("Could not prove metadata source/staging isolation.") from exc
    if file_identity(source) != generation.source_identity:
        raise StagingSafetyError("Live source database changed before metadata staging mutation.")


def mutate_metadata_staging_database(
    plan: MetadataPreflightPlan,
    generation: StagingGeneration,
    *,
    database_factory: Callable[[str], Any],
) -> dict[str, ExpectedGenreMutation]:
    """Apply relational Genre mutations to the isolated staging database only."""
    _require_source_staging_isolation(generation)
    db = database_factory(str(generation.staging_path))
    expected: dict[str, ExpectedGenreMutation] = {}
    try:
        genres_by_id, genres_by_name = _genre_catalog(db)

        # Resolve and validate every target + moving baseline before mutating any
        # content row or creating any DjmdGenre row.
        content_by_draft: dict[str, Any] = {}
        desired_existing_id: dict[str, Optional[str]] = {}
        desired_resolution: dict[str, Literal["reuse", "create", "clear"]] = {}
        for draft in plan.drafts:
            content = _content_for_strong_identity(
                db,
                track_id=draft.track_id,
                content_id=draft.master_content_id,
                master_db_id=draft.master_db_id,
                master_content_id=draft.master_content_id,
                operation_label="metadata staging apply",
                require_master_db_id=True,
            )
            current_value = _current_genre_value(content, genres_by_id)
            if current_value != draft.current_baseline_value:
                raise StagingWriterError(
                    f"Track {draft.track_id} local Genre changed after preflight.",
                    code="genre-baseline-stale",
                )
            content_by_draft[draft.draft_id] = content

            if draft.pending_value is None:
                desired_existing_id[draft.draft_id] = None
                desired_resolution[draft.draft_id] = "clear"
                continue
            matches = genres_by_name.get(draft.pending_value, [])
            if len(matches) > 1:
                raise StagingWriterError(
                    f"Desired Genre {draft.pending_value!r} is ambiguous in staging.",
                    code="genre-name-ambiguous",
                )
            if len(matches) == 1:
                desired_existing_id[draft.draft_id] = str(getattr(matches[0], "ID")).strip()
                desired_resolution[draft.draft_id] = "reuse"
            else:
                desired_existing_id[draft.draft_id] = None
                desired_resolution[draft.draft_id] = "create"

        add_genre = getattr(db, "add_genre", None)
        created_by_name: dict[str, str] = {}
        for draft in plan.drafts:
            desired = draft.pending_value
            if desired is None or desired_resolution[draft.draft_id] != "create":
                continue
            if desired in created_by_name:
                continue
            if not callable(add_genre):
                raise StagingWriterError(
                    "Installed pyrekordbox does not expose supported DjmdGenre creation.",
                    code="genre-create-unsupported",
                )
            created = add_genre(name=desired)
            created_id_raw = getattr(created, "ID", None)
            created_name = normalize_genre(
                getattr(created, "Name", None), label=f"new DjmdGenre {desired!r}.Name"
            )
            if created_id_raw is None or not str(created_id_raw).strip() or created_name != desired:
                raise StagingWriterError(
                    f"New DjmdGenre {desired!r} did not return valid identity/name data.",
                    code="genre-create-invalid",
                )
            created_id = str(created_id_raw).strip()
            if created_id in genres_by_id:
                raise StagingWriterError(
                    f"New DjmdGenre {desired!r} reused an existing ID unexpectedly.",
                    code="genre-create-identity-collision",
                )
            genres_by_id[created_id] = created
            genres_by_name.setdefault(desired, []).append(created)
            created_by_name[desired] = created_id

        for draft in plan.drafts:
            desired = draft.pending_value
            resolution = desired_resolution[draft.draft_id]
            created_genre = False
            if resolution == "clear":
                resolved_id = None
            elif resolution == "reuse":
                resolved_id = desired_existing_id[draft.draft_id]
            else:
                if desired is None:  # defensive type narrowing
                    raise StagingWriterError("Genre creation plan has no normalized Genre value.")
                resolved_id = created_by_name[desired]
                created_genre = True

            content = content_by_draft[draft.draft_id]
            content.GenreID = resolved_id
            expected[draft.draft_id] = ExpectedGenreMutation(
                draft_id=draft.draft_id,
                track_id=draft.track_id,
                content_id=draft.master_content_id,
                revision=draft.revision,
                draft_fingerprint=draft.draft_fingerprint,
                normalized_genre=desired,
                resolved_genre_id=resolved_id,
                desired_resolution=resolution,
                created_genre=created_genre,
            )

        db.commit()
    except Exception:  # noqa: BLE001 - rollback staging session before propagating safely
        rollback = getattr(db, "rollback", None)
        if callable(rollback):
            rollback()
        raise
    finally:
        _close_db(db)

    if file_identity(Path(generation.source_path)) != generation.source_identity:
        raise StagingSafetyError("Live source database changed during metadata staging mutation.")
    return expected


def verify_metadata_database(
    plan: MetadataPreflightPlan,
    database_path: Path,
    expected: Mapping[str, ExpectedGenreMutation],
    *,
    database_factory: Callable[[str], Any],
    context: str = "database",
) -> MetadataVerificationResult:
    """Reopen a generation and verify semantic Genre relationships for every draft."""
    db = database_factory(str(database_path))
    mismatches: list[MetadataVerificationMismatch] = []
    verified: list[str] = []
    try:
        genres_by_id, genres_by_name = _genre_catalog(db)
        for draft in plan.drafts:
            expectation = expected.get(draft.draft_id)
            if expectation is None:
                mismatches.append(
                    MetadataVerificationMismatch(
                        draft.draft_id,
                        draft.track_id,
                        draft.master_content_id,
                        f"No expected Genre mutation exists for {context} verification.",
                    )
                )
                continue
            try:
                content = _content_for_strong_identity(
                    db,
                    track_id=draft.track_id,
                    content_id=draft.master_content_id,
                    master_db_id=draft.master_db_id,
                    master_content_id=draft.master_content_id,
                    operation_label=f"metadata {context} verification",
                    require_master_db_id=True,
                )
                actual_id = _genre_id_or_none(getattr(content, "GenreID", None))
                if expectation.normalized_genre is None:
                    if actual_id is not None:
                        raise StagingWriterError(
                            f"Expected cleared Genre but found GenreID {actual_id}."
                        )
                else:
                    if actual_id != expectation.resolved_genre_id:
                        raise StagingWriterError(
                            "Reopened ContentID points to a different GenreID than staged."
                        )
                    row = genres_by_id.get(actual_id or "")
                    if row is None:
                        raise StagingWriterError("Reopened GenreID does not resolve to DjmdGenre.")
                    actual_name = normalize_genre(
                        getattr(row, "Name", None), label=f"DjmdGenre {actual_id}.Name"
                    )
                    if actual_name != expectation.normalized_genre:
                        raise StagingWriterError(
                            "Reopened DjmdGenre name does not equal the normalized desired Genre."
                        )
                    matches = genres_by_name.get(expectation.normalized_genre, [])
                    if len(matches) != 1:
                        raise StagingWriterError(
                            "Reopened desired Genre is not uniquely resolvable by normalized name."
                        )
                verified.append(draft.draft_id)
            except Exception as exc:  # noqa: BLE001 - convert per-draft verification to evidence
                mismatches.append(
                    MetadataVerificationMismatch(
                        draft.draft_id,
                        draft.track_id,
                        draft.master_content_id,
                        f"{context} Genre verification failed: {exc}",
                    )
                )
    finally:
        _close_db(db)
    return MetadataVerificationResult(
        ok=not mismatches,
        verified_draft_ids=tuple(verified),
        mismatches=tuple(mismatches),
    )


def verify_metadata_staging_database(
    plan: MetadataPreflightPlan,
    generation: StagingGeneration,
    expected: Mapping[str, ExpectedGenreMutation],
    *,
    database_factory: Callable[[str], Any],
) -> MetadataVerificationResult:
    return verify_metadata_database(
        plan,
        Path(generation.staging_path),
        expected,
        database_factory=database_factory,
        context="staging",
    )


def _verify_live_copy(
    source: Path,
    plan: MetadataPreflightPlan,
    expected: Mapping[str, ExpectedGenreMutation],
    *,
    database_factory: Callable[[str], Any],
) -> tuple[str, MetadataVerificationResult]:
    from .security import readonly_snapshot

    _require_single_file_generation(source)
    before = file_identity(source)
    with readonly_snapshot(source) as snapshot:
        verification = verify_metadata_database(
            plan,
            snapshot,
            expected,
            database_factory=database_factory,
            context="live database",
        )
    after = file_identity(source)
    _require_single_file_generation(source)
    if before != after:
        raise StagingSafetyError("Live master.db changed during metadata final verification.")
    return after, verification


def _verify_rollback(
    source: Path,
    plan: MetadataPreflightPlan,
    record: MetadataTokenRecord,
    *,
    database_factory: Callable[[str], Any],
) -> bool:
    identity, observed = _observe_live_without_mutation(
        source, plan, database_factory=database_factory
    )
    return (
        identity == record.source_identity
        and _observed_identity(observed) == record.observed_identity
    )


def _track_results(
    plan: MetadataPreflightPlan,
    verification: Optional[MetadataVerificationResult],
    expected: Mapping[str, ExpectedGenreMutation],
) -> tuple[MetadataApplyTrackResult, ...]:
    verification_mismatches = verification.mismatches if verification else ()
    mismatches = {mismatch.draft_id: mismatch for mismatch in verification_mismatches}
    verified_ids = set(verification.verified_draft_ids if verification else ())
    results: list[MetadataApplyTrackResult] = []
    for draft in plan.drafts:
        expectation = expected.get(draft.draft_id)
        mismatch = mismatches.get(draft.draft_id)
        if expectation is None:
            resolution: Literal["reuse", "create", "clear"] = (
                "clear" if draft.pending_value is None else "create"
            )
            results.append(
                MetadataApplyTrackResult(
                    draft_id=draft.draft_id,
                    track_id=draft.track_id,
                    content_id=draft.master_content_id,
                    state="not-verified",
                    applied_revision=draft.revision,
                    applied_fingerprint=draft.draft_fingerprint,
                    normalized_applied_genre=draft.pending_value,
                    desired_resolution=resolution,
                    resolved_genre_id=None,
                    verification_state="not-run" if verification is None else "failed",
                    details=(
                        mismatch.details
                        if mismatch
                        else "Genre mutation did not reach verification."
                    ),
                )
            )
            continue
        is_verified = draft.draft_id in verified_ids and mismatch is None
        results.append(
            MetadataApplyTrackResult(
                draft_id=draft.draft_id,
                track_id=draft.track_id,
                content_id=draft.master_content_id,
                state="verified" if is_verified else "not-verified",
                applied_revision=expectation.revision,
                applied_fingerprint=expectation.draft_fingerprint,
                normalized_applied_genre=expectation.normalized_genre,
                desired_resolution=expectation.desired_resolution,
                resolved_genre_id=expectation.resolved_genre_id,
                verification_state="verified" if is_verified else "failed",
                details=mismatch.details if mismatch else None,
            )
        )
    return tuple(results)


def _rejected_result(
    operation_id: str,
    plan_fingerprint: str,
    code: str,
    message: str,
    *,
    source_identity_before: Optional[str] = None,
    backup_identity: Optional[str] = None,
    tracks: tuple[MetadataApplyTrackResult, ...] = (),
) -> MetadataApplyResult:
    return MetadataApplyResult(
        ok=False,
        operation_id=operation_id,
        state="rejected",
        plan_fingerprint=plan_fingerprint,
        source_identity_before=source_identity_before,
        backup_identity=backup_identity,
        tracks=tracks,
        blockers=(_diagnostic(code, message),),
    )


def _load_database_factory() -> Callable[[str], Any]:
    try:
        from pyrekordbox import Rekordbox6Database  # type: ignore
    except ImportError as exc:  # pragma: no cover - runtime dependency
        raise ImportError("pyrekordbox is required for metadata apply.") from exc
    return Rekordbox6Database


def metadata_apply_availability() -> dict[str, bool]:
    """Verify the installed writer dependency exposes supported Genre creation."""
    database_factory = _load_database_factory()
    if not callable(getattr(database_factory, "add_genre", None)):
        raise RuntimeError("Installed pyrekordbox does not expose supported DjmdGenre creation.")
    return {"metadataApplySupported": True}


def apply_saved_metadata_drafts(
    preflight_token: str,
    saved_rows: Sequence[Mapping[str, Any]],
    *,
    token_store: Optional[MetadataPreflightTokenStore] = None,
    now: Optional[datetime] = None,
    discover_target: Callable[[], tuple[Path, Any]] = discover_trusted_writer_target,
    require_closed: Callable[[], Any] = require_rekordbox_closed,
    database_factory: Optional[Callable[[str], Any]] = None,
    create_generation: Callable[..., StagingGeneration] = create_backup_and_staging,
    replace_generation: Callable[..., str] = _atomic_replace_generation,
    after_replace_hook: Optional[Callable[[Path], None]] = None,
    after_rollback_hook: Optional[Callable[[Path], None]] = None,
) -> MetadataApplyResult:
    """Apply a preflight-bound Genre plan with staging verification and rollback."""
    operation_id = uuid4().hex
    now = now or _utc_now()
    token_store = token_store or _METADATA_TOKEN_STORE
    database_factory = database_factory or _load_database_factory()

    try:
        plan = adapt_saved_metadata_drafts(saved_rows)
    except MetadataPlanValidationError as exc:
        return _rejected_result(operation_id, "", "metadata-saved-plan-invalid", str(exc))

    if not _APPLY_LOCK.acquire(blocking=False):
        return _rejected_result(
            operation_id,
            plan.draft_plan_fingerprint,
            "apply-in-progress",
            "Another verified Rekordbox apply operation is already in progress.",
        )

    generation: Optional[StagingGeneration] = None
    rollback_candidate: Optional[Path] = None
    expected: Mapping[str, ExpectedGenreMutation] = {}
    final_verification: Optional[MetadataVerificationResult] = None
    try:
        try:
            record = token_store.claim(preflight_token, now)
        except MetadataTokenClaimError as exc:
            return _rejected_result(
                operation_id, plan.draft_plan_fingerprint, exc.code, exc.message
            )

        if _draft_identity(plan) != record.draft_identity:
            return _rejected_result(
                operation_id,
                plan.draft_plan_fingerprint,
                "metadata-saved-plan-changed",
                "Saved metadata draft revision or fingerprint changed after preflight.",
                source_identity_before=record.source_identity,
            )

        try:
            source, target_result = discover_target()
            require_closed()
            _require_single_file_generation(source)
        except Exception as exc:  # noqa: BLE001 - return structured safety outcome
            return _rejected_result(
                operation_id,
                record.plan_fingerprint,
                "metadata-apply-safety-blocked",
                str(exc),
                source_identity_before=record.source_identity,
            )

        discovered_identity = (
            getattr(target_result, "source_identity", None) or file_identity(source)
        )
        try:
            observed_identity, observed = _observe_live_without_mutation(
                source, plan, database_factory=database_factory
            )
        except Exception as exc:  # noqa: BLE001
            return _rejected_result(
                operation_id,
                record.plan_fingerprint,
                "metadata-local-revalidation-failed",
                str(exc),
                source_identity_before=record.source_identity,
            )

        blockers = _blockers(plan, observed)
        if blockers:
            return MetadataApplyResult(
                ok=False,
                operation_id=operation_id,
                state="rejected",
                plan_fingerprint=record.plan_fingerprint,
                source_identity_before=record.source_identity,
                blockers=blockers,
            )
        rebound_fingerprint = _preflight_plan_fingerprint(plan, observed_identity, observed)
        if (
            observed_identity != record.source_identity
            or discovered_identity != observed_identity
            or rebound_fingerprint != record.plan_fingerprint
            or _observed_identity(observed) != record.observed_identity
        ):
            return _rejected_result(
                operation_id,
                record.plan_fingerprint,
                "metadata-preflight-stale",
                "Local Genre state, trusted identity, or Genre resolution changed after preflight.",
                source_identity_before=record.source_identity,
            )

        try:
            generation = create_generation(source, operation_id=operation_id)
            expected = mutate_metadata_staging_database(
                plan,
                generation,
                database_factory=database_factory,
            )
            staged_verification = verify_metadata_staging_database(
                plan,
                generation,
                expected,
                database_factory=database_factory,
            )
            if not staged_verification.ok:
                return _rejected_result(
                    operation_id,
                    record.plan_fingerprint,
                    "metadata-staging-verification-failed",
                    "Staging Genre verification failed; live master.db was not replaced.",
                    source_identity_before=record.source_identity,
                    backup_identity=generation.backup_identity,
                    tracks=_track_results(plan, staged_verification, expected),
                )
            _require_single_file_generation(Path(generation.staging_path))
            rollback_candidate = _prepare_rollback_candidate(generation)
        except Exception as exc:  # noqa: BLE001 - live handoff has not occurred
            return _rejected_result(
                operation_id,
                record.plan_fingerprint,
                "metadata-staging-failed",
                str(exc),
                source_identity_before=record.source_identity,
                backup_identity=generation.backup_identity if generation else None,
                tracks=_track_results(plan, None, expected),
            )

        try:
            guarded_source, guarded_result = discover_target()
            require_closed()
            if (
                guarded_source.resolve(strict=True)
                != Path(generation.source_path).resolve(strict=True)
            ):
                raise StagingSafetyError("Trusted local writer target changed before replacement.")
            _require_single_file_generation(guarded_source)
            guarded_identity = getattr(guarded_result, "source_identity", None) or file_identity(
                guarded_source
            )
            if guarded_identity != record.source_identity:
                raise StagingSafetyError("Live master.db changed before metadata replacement.")

            staged_identity = file_identity(Path(generation.staging_path))
            live_identity = replace_generation(
                Path(generation.staging_path),
                guarded_source,
                expected_target_identity=record.source_identity,
            )
            if live_identity != staged_identity:
                raise StagingSafetyError(
                    "Metadata atomic replacement produced an unexpected live generation."
                )
            if after_replace_hook is not None:
                after_replace_hook(guarded_source)

            verified_identity, final_verification = _verify_live_copy(
                guarded_source,
                plan,
                expected,
                database_factory=database_factory,
            )
            if verified_identity != staged_identity or not final_verification.ok:
                raise StagingWriterError(
                    "Final live Genre verification failed after atomic replacement."
                )
        except Exception as post_replace_exc:  # noqa: BLE001 - rollback catches handoff failures
            staging_still_exists = Path(generation.staging_path).exists()
            if staging_still_exists:
                return _rejected_result(
                    operation_id,
                    record.plan_fingerprint,
                    "metadata-atomic-replacement-failed",
                    str(post_replace_exc),
                    source_identity_before=record.source_identity,
                    backup_identity=generation.backup_identity,
                    tracks=_track_results(plan, final_verification, expected),
                )

            rollback_message = str(post_replace_exc)
            try:
                if rollback_candidate is None or not rollback_candidate.exists():
                    raise StagingSafetyError("Prepared metadata rollback candidate is unavailable.")
                _require_single_file_generation(Path(generation.source_path))
                failed_identity = file_identity(Path(generation.source_path))
                restored_identity = replace_generation(
                    rollback_candidate,
                    Path(generation.source_path),
                    expected_target_identity=failed_identity,
                )
                if restored_identity != record.source_identity:
                    raise StagingSafetyError(
                        "Metadata rollback replacement identity differs from preflight."
                    )
                if after_rollback_hook is not None:
                    after_rollback_hook(Path(generation.source_path))
                rollback_verified = _verify_rollback(
                    Path(generation.source_path),
                    plan,
                    record,
                    database_factory=database_factory,
                )
                if not rollback_verified:
                    raise StagingSafetyError(
                        "Metadata rollback reopened but did not verify old local Genre state."
                    )
                return MetadataApplyResult(
                    ok=False,
                    operation_id=operation_id,
                    state="rolled-back",
                    plan_fingerprint=record.plan_fingerprint,
                    source_identity_before=record.source_identity,
                    source_identity_after=record.source_identity,
                    backup_identity=generation.backup_identity,
                    tracks=_track_results(plan, final_verification, expected),
                    blockers=(
                        _diagnostic(
                            "metadata-final-verification-failed",
                            (
                                f"{rollback_message} Original local generation was restored "
                                "and verified."
                            ),
                        ),
                    ),
                    rollback_verified=True,
                )
            except Exception as rollback_exc:  # noqa: BLE001 - critical recovery state is explicit
                return MetadataApplyResult(
                    ok=False,
                    operation_id=operation_id,
                    state="recovery-unverified",
                    plan_fingerprint=record.plan_fingerprint,
                    source_identity_before=record.source_identity,
                    source_identity_after=(
                        file_identity(Path(generation.source_path))
                        if Path(generation.source_path).exists()
                        else None
                    ),
                    backup_identity=generation.backup_identity,
                    tracks=_track_results(plan, final_verification, expected),
                    blockers=(
                        _diagnostic(
                            "metadata-rollback-unverified",
                            (
                                f"Post-replacement failure: {rollback_message} "
                                f"Rollback could not be verified: {rollback_exc}"
                            ),
                        ),
                    ),
                    rollback_verified=False,
                    recovery={
                        "operationId": generation.operation_id,
                        "backupIdentity": generation.backup_identity,
                        "status": "manual-recovery-required",
                    },
                )

        return MetadataApplyResult(
            ok=True,
            operation_id=operation_id,
            state="applied",
            plan_fingerprint=record.plan_fingerprint,
            source_identity_before=record.source_identity,
            source_identity_after=file_identity(Path(generation.source_path)),
            backup_identity=generation.backup_identity,
            tracks=_track_results(plan, final_verification, expected),
            rollback_verified=None,
        )
    finally:
        if generation is not None:
            _cleanup_staging_paths(generation, rollback_candidate)
        _APPLY_LOCK.release()
