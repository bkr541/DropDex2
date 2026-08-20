"""Stage 5 guarded service boundary for local Rekordbox cue staging.

No public function in this module accepts a filesystem target.  Production
writer ownership starts with trusted local discovery and ends after staging
verification; live master.db replacement is intentionally absent.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from .cue_writer import (
    CueWriterError,
    VerificationResult,
    inspect_staging_plan,
    open_staging_database,
    verify_staging_plan,
    write_plan_to_staging,
)
from .writer_models import (
    CueApplyPlan,
    CueApplyVerification,
    CuePlanValidationError,
    LocalDbIdentity,
    ProcessState,
    RekordboxWritePreflight,
)
from .writer_safety import (
    ProcessProbe,
    StorageProbe,
    WriterSafetyError,
    _validate_trusted_target,
    create_backup_and_staging,
    detect_rekordbox_process,
    resolve_trusted_local_master_db,
    sha256_file,
)

DbFactory = Callable[[Path], Any]


def stage_cue_plan(plan: CueApplyPlan) -> RekordboxWritePreflight:
    """Production Stage 5 entry point. It cannot be directed to an arbitrary DB path."""
    try:
        source_path, identity = resolve_trusted_local_master_db()
    except WriterSafetyError as exc:
        return _blocked(None, None, None, exc.message)
    return _run_staging(
        plan,
        source_path=source_path,
        identity=identity,
        process_probe=detect_rekordbox_process,
        artifact_root=None,
        db_factory=open_staging_database,
    )


def _stage_cue_plan_for_test(
    plan: CueApplyPlan,
    *,
    source_path: Path,
    storage_probe: StorageProbe,
    process_probe: ProcessProbe,
    artifact_root: Path,
    db_factory: DbFactory,
    cue_table: Any,
) -> RekordboxWritePreflight:
    """Private disposable-fixture seam; deliberately not exported or wired to Electron/CLI."""
    try:
        canonical, identity = _validate_trusted_target(source_path, storage_probe=storage_probe)
    except WriterSafetyError as exc:
        return _blocked(None, None, None, exc.message)
    return _run_staging(
        plan,
        source_path=canonical,
        identity=identity,
        process_probe=process_probe,
        artifact_root=artifact_root,
        db_factory=db_factory,
        cue_table=cue_table,
    )


def _run_staging(
    plan: CueApplyPlan,
    *,
    source_path: Path,
    identity: LocalDbIdentity,
    process_probe: ProcessProbe,
    artifact_root: Path | None,
    db_factory: DbFactory,
    cue_table: Any | None = None,
) -> RekordboxWritePreflight:
    process_state = process_probe()
    if not process_state.safe_to_write:
        return _blocked(identity, process_state, None, process_state.reason)

    try:
        plan.validate()
        plan_fingerprint = plan.fingerprint()
    except CuePlanValidationError as exc:
        return _blocked(identity, process_state, None, str(exc))

    operation_id = uuid4().hex
    artifacts = None
    summaries = ()
    try:
        artifacts = create_backup_and_staging(
            source_path,
            artifact_root=artifact_root,
            operation_id=operation_id,
        )
        if artifacts.source_sha256 != identity.source_sha256:
            raise WriterSafetyError(
                "source_changed", "Local Rekordbox database changed after writer preflight"
            )
        summaries = inspect_staging_plan(artifacts.staging_path, plan, db_factory=db_factory)
        missing = [item.content_id for item in summaries if not item.found]
        if missing:
            return RekordboxWritePreflight(
                ok=False,
                operation_id=operation_id,
                local_db=identity,
                process_state=process_state,
                plan_fingerprint=plan_fingerprint,
                backup_created=True,
                backup_name=artifacts.backup_path.name,
                staging_created=True,
                staging_name=artifacts.staging_path.name,
                tracks=summaries,
                blockers=(f"{len(missing)} planned ContentID(s) are missing from local Rekordbox",),
            )

        process_state_before_write = process_probe()
        if not process_state_before_write.safe_to_write:
            return RekordboxWritePreflight(
                ok=False,
                operation_id=operation_id,
                local_db=identity,
                process_state=process_state_before_write,
                plan_fingerprint=plan_fingerprint,
                backup_created=True,
                backup_name=artifacts.backup_path.name,
                staging_created=True,
                staging_name=artifacts.staging_path.name,
                tracks=summaries,
                blockers=(process_state_before_write.reason,),
            )

        write_plan_to_staging(
            artifacts.staging_path,
            plan,
            db_factory=db_factory,
            cue_table=cue_table,
        )
        verified: VerificationResult = verify_staging_plan(
            artifacts.staging_path,
            plan,
            db_factory=db_factory,
        )
        source_unchanged = sha256_file(source_path) == artifacts.source_sha256
        mismatches = list(verified.mismatches)
        if not source_unchanged:
            mismatches.append("Local source database changed during Stage 5 operation")
        verification = CueApplyVerification(
            verified=verified.verified and source_unchanged,
            tracks_verified=verified.tracks_verified,
            cues_verified=verified.cues_verified,
            mismatches=tuple(mismatches),
        )
        return RekordboxWritePreflight(
            ok=verification.verified,
            operation_id=operation_id,
            local_db=identity,
            process_state=process_state,
            plan_fingerprint=plan_fingerprint,
            backup_created=True,
            backup_name=artifacts.backup_path.name,
            staging_created=True,
            staging_name=artifacts.staging_path.name,
            tracks=summaries,
            verification=verification,
            blockers=() if verification.verified else ("Staging verification failed",),
        )
    except (WriterSafetyError, CueWriterError, OSError, ValueError) as exc:
        return RekordboxWritePreflight(
            ok=False,
            operation_id=operation_id,
            local_db=identity,
            process_state=process_state,
            plan_fingerprint=plan_fingerprint,
            backup_created=artifacts is not None,
            backup_name=artifacts.backup_path.name if artifacts else None,
            staging_created=artifacts is not None,
            staging_name=artifacts.staging_path.name if artifacts else None,
            tracks=summaries,
            blockers=(str(exc),),
        )
    except Exception:  # noqa: BLE001 - fail closed on database/runtime surprises
        return RekordboxWritePreflight(
            ok=False,
            operation_id=operation_id,
            local_db=identity,
            process_state=process_state,
            plan_fingerprint=plan_fingerprint,
            backup_created=artifacts is not None,
            backup_name=artifacts.backup_path.name if artifacts else None,
            staging_created=artifacts is not None,
            staging_name=artifacts.staging_path.name if artifacts else None,
            tracks=summaries,
            blockers=(
                "Staging operation failed safely; the live Rekordbox database was not modified",
            ),
        )


def _blocked(
    identity: LocalDbIdentity | None,
    process_state: ProcessState | None,
    plan_fingerprint: str | None,
    blocker: str,
) -> RekordboxWritePreflight:
    return RekordboxWritePreflight(
        ok=False,
        operation_id=None,
        local_db=identity,
        process_state=process_state or ProcessState(False, None, False, "Writer preflight blocked"),
        plan_fingerprint=plan_fingerprint,
        blockers=(blocker,),
    )
