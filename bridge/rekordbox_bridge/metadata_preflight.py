"""Read-only Rekordbox metadata preflight for Genre Editing Stage 4.

The renderer supplies persisted metadata-draft facts, never a filesystem path,
SQL, or a local row override. The trusted target is rediscovered locally and a
private snapshot is used to resolve DjmdContent.GenreID -> DjmdGenre.Name.
No DjmdGenre or DjmdContent mutation exists in this module.
"""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, Optional
from uuid import uuid4

from .security import (
    StagingSafetyError,
    discover_trusted_writer_target,
    file_identity,
    readonly_snapshot,
    require_rekordbox_closed,
)
from .writer import StagingWriterError, _close_db, _content_for_strong_identity

METADATA_DRAFT_SCHEMA_VERSION = 1
GENRE_MAX_LENGTH = 255
DEFAULT_METADATA_TOKEN_TTL_SECONDS = 120
_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_SQLITE_SIDECAR_SUFFIXES = ("-wal", "-shm", "-journal")
_METADATA_ROW_KEYS = {
    "id",
    "userId",
    "importId",
    "trackId",
    "field",
    "schemaVersion",
    "pendingValue",
    "importedBaselineValue",
    "currentBaselineValue",
    "masterDbId",
    "masterContentId",
    "revision",
    "draftFingerprint",
}


class MetadataPlanValidationError(ValueError):
    """Persisted metadata draft rows cannot form a safe preflight plan."""


@dataclass(frozen=True)
class MetadataDiagnostic:
    code: str
    message: str
    context: Optional[dict[str, Optional[str]]] = None


@dataclass(frozen=True)
class MetadataPreflightTrackResult:
    draft_id: str
    track_id: str
    field: Literal["genre"]
    content_id: str
    exists: bool
    identity_comparison: Literal["match", "missing", "mismatch"]
    draft_revision: int
    draft_fingerprint: str
    expected_baseline_value: Optional[str]
    current_value: Optional[str]
    pending_value: Optional[str]
    baseline_comparison: Literal["match", "diverged", "not-comparable"]
    desired_resolution: Literal["reuse", "create", "clear", "blocked"]
    existing_genre_id: Optional[str] = None


@dataclass(frozen=True)
class MetadataPreflightResult:
    ok: bool
    preflight_id: str
    plan_fingerprint: str
    source_identity: Optional[str]
    tracks: tuple[MetadataPreflightTrackResult, ...]
    blockers: tuple[MetadataDiagnostic, ...] = ()
    warnings: tuple[MetadataDiagnostic, ...] = ()
    token: Optional[str] = None
    expires_at: Optional[str] = None


@dataclass(frozen=True)
class PlannedMetadataDraft:
    draft_id: str
    user_id: str
    import_id: str
    track_id: str
    field: Literal["genre"]
    schema_version: int
    pending_value: Optional[str]
    imported_baseline_value: Optional[str]
    current_baseline_value: Optional[str]
    master_db_id: str
    master_content_id: str
    revision: int
    draft_fingerprint: str


@dataclass(frozen=True)
class MetadataPreflightPlan:
    schema_version: int
    draft_plan_fingerprint: str
    drafts: tuple[PlannedMetadataDraft, ...]


@dataclass(frozen=True)
class _ObservedMetadataDraft:
    draft_id: str
    track_id: str
    content_id: str
    exists: bool
    identity_comparison: Literal["match", "missing", "mismatch"]
    identity_error: Optional[str]
    identity_error_code: Optional[str]
    current_value: Optional[str]
    baseline_comparison: Literal["match", "diverged", "not-comparable"]
    desired_resolution: Literal["reuse", "create", "clear", "blocked"]
    existing_genre_id: Optional[str]
    genre_error: Optional[str] = None
    genre_error_code: Optional[str] = None


@dataclass(frozen=True)
class MetadataTokenRecord:
    preflight_id: str
    source_identity: str
    plan_fingerprint: str
    draft_identity: tuple[tuple[str, int, str], ...]
    observed_identity: tuple[
        tuple[str, str, Optional[str], Optional[str], str, Optional[str]], ...
    ]
    issued_at: datetime
    expires_at: datetime


class MetadataTokenClaimError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class MetadataPreflightTokenStore:
    """Long-lived bridge-owned opaque token store for Stage 4 and later Apply."""

    def __init__(self) -> None:
        self._records: dict[str, MetadataTokenRecord] = {}
        self._consumed: set[str] = set()
        self._lock = threading.Lock()

    @staticmethod
    def _digest(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def issue(self, record: MetadataTokenRecord) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._records[self._digest(token)] = record
        return token

    def claim(self, token: str, now: datetime) -> MetadataTokenRecord:
        if not isinstance(token, str) or not token:
            raise MetadataTokenClaimError("metadata-token-invalid", "Metadata token is invalid.")
        digest = self._digest(token)
        with self._lock:
            if digest in self._consumed:
                raise MetadataTokenClaimError(
                    "metadata-token-replayed", "Metadata token has already been consumed."
                )
            record = self._records.pop(digest, None)
            if record is None:
                raise MetadataTokenClaimError(
                    "metadata-token-invalid", "Metadata token is unknown to this bridge."
                )
            self._consumed.add(digest)
        if now >= record.expires_at:
            raise MetadataTokenClaimError(
                "metadata-token-expired", "Metadata token has expired; run preflight again."
            )
        return record


_METADATA_TOKEN_STORE = MetadataPreflightTokenStore()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _diagnostic(
    code: str,
    message: str,
    *,
    context: Optional[dict[str, Optional[str]]] = None,
) -> MetadataDiagnostic:
    return MetadataDiagnostic(code=code, message=message, context=context)


def normalize_genre(value: Any, *, label: str) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise MetadataPlanValidationError(f"{label} must be a string or null.")
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > GENRE_MAX_LENGTH:
        raise MetadataPlanValidationError(
            f"{label} exceeds Rekordbox's {GENRE_MAX_LENGTH}-character Genre limit."
        )
    return normalized


def _required_string(value: Any, label: str, *, max_length: int = 256) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > max_length:
        raise MetadataPlanValidationError(f"{label} is invalid.")
    return value.strip()


def _canonical_draft_payload(drafts: Sequence[PlannedMetadataDraft]) -> dict[str, Any]:
    return {
        "schemaVersion": METADATA_DRAFT_SCHEMA_VERSION,
        "drafts": [
            {
                "draftId": draft.draft_id,
                "userId": draft.user_id,
                "importId": draft.import_id,
                "trackId": draft.track_id,
                "field": draft.field,
                "schemaVersion": draft.schema_version,
                "pendingValue": draft.pending_value,
                "importedBaselineValue": draft.imported_baseline_value,
                "currentBaselineValue": draft.current_baseline_value,
                "masterDbId": draft.master_db_id,
                "masterContentId": draft.master_content_id,
                "revision": draft.revision,
                "draftFingerprint": draft.draft_fingerprint,
            }
            for draft in drafts
        ],
    }


def _fingerprint(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def adapt_saved_metadata_drafts(
    saved_rows: Sequence[Mapping[str, Any]],
) -> MetadataPreflightPlan:
    """Validate persisted Genre rows and create a deterministic read-only plan."""
    if not saved_rows:
        raise MetadataPlanValidationError("At least one saved metadata draft is required.")
    if len(saved_rows) > 5000:
        raise MetadataPlanValidationError("Metadata preflight supports at most 5000 drafts.")

    drafts: list[PlannedMetadataDraft] = []
    users: set[str] = set()
    imports: set[str] = set()
    logical_keys: set[tuple[str, str, str]] = set()
    master_targets: set[str] = set()

    for index, raw in enumerate(saved_rows):
        if not isinstance(raw, Mapping):
            raise MetadataPlanValidationError(f"savedRows[{index}] must be an object.")
        if set(raw) != _METADATA_ROW_KEYS:
            raise MetadataPlanValidationError(
                f"savedRows[{index}] contains unsupported or missing fields."
            )

        draft_id = _required_string(raw.get("id"), f"savedRows[{index}].id")
        user_id = _required_string(raw.get("userId"), f"savedRows[{index}].userId")
        import_id = _required_string(raw.get("importId"), f"savedRows[{index}].importId")
        track_id = _required_string(raw.get("trackId"), f"savedRows[{index}].trackId")
        if raw.get("field") != "genre":
            raise MetadataPlanValidationError(
                "Only Genre metadata drafts are supported in Stage 4."
            )
        if raw.get("schemaVersion") != METADATA_DRAFT_SCHEMA_VERSION:
            raise MetadataPlanValidationError("Metadata draft schema version is unsupported.")
        revision = raw.get("revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision <= 0:
            raise MetadataPlanValidationError("Metadata draft revision must be a positive integer.")
        draft_fingerprint = raw.get("draftFingerprint")
        if not isinstance(draft_fingerprint, str) or not _HASH_RE.fullmatch(draft_fingerprint):
            raise MetadataPlanValidationError(
                "Metadata draft fingerprint must be a lowercase SHA-256 hex digest."
            )

        pending_value = normalize_genre(
            raw.get("pendingValue"), label=f"savedRows[{index}].pendingValue"
        )
        if raw.get("pendingValue") is not None and pending_value != raw.get("pendingValue"):
            raise MetadataPlanValidationError(
                "Persisted pending Genre must already be server-normalized."
            )
        imported_baseline = normalize_genre(
            raw.get("importedBaselineValue"),
            label=f"savedRows[{index}].importedBaselineValue",
        )
        current_baseline = normalize_genre(
            raw.get("currentBaselineValue"),
            label=f"savedRows[{index}].currentBaselineValue",
        )
        master_db_id = _required_string(
            raw.get("masterDbId"), f"savedRows[{index}].masterDbId"
        )
        master_content_id = _required_string(
            raw.get("masterContentId"), f"savedRows[{index}].masterContentId"
        )

        logical_key = (user_id, track_id, "genre")
        if logical_key in logical_keys:
            raise MetadataPlanValidationError("Duplicate logical metadata draft identity.")
        if master_content_id in master_targets:
            raise MetadataPlanValidationError(
                "Duplicate trusted master ContentID in metadata scope."
            )
        logical_keys.add(logical_key)
        master_targets.add(master_content_id)
        users.add(user_id)
        imports.add(import_id)

        if pending_value == current_baseline:
            raise MetadataPlanValidationError(
                f"Track {track_id} metadata draft is a no-op against its moving baseline."
            )

        drafts.append(
            PlannedMetadataDraft(
                draft_id=draft_id,
                user_id=user_id,
                import_id=import_id,
                track_id=track_id,
                field="genre",
                schema_version=METADATA_DRAFT_SCHEMA_VERSION,
                pending_value=pending_value,
                imported_baseline_value=imported_baseline,
                current_baseline_value=current_baseline,
                master_db_id=master_db_id,
                master_content_id=master_content_id,
                revision=revision,
                draft_fingerprint=draft_fingerprint,
            )
        )

    if len(users) != 1:
        raise MetadataPlanValidationError("Metadata preflight cannot mix user identities.")
    if len(imports) != 1:
        raise MetadataPlanValidationError("Metadata preflight cannot mix import identities.")

    drafts.sort(key=lambda item: (item.track_id, item.field, item.draft_id))
    immutable = tuple(drafts)
    return MetadataPreflightPlan(
        schema_version=METADATA_DRAFT_SCHEMA_VERSION,
        draft_plan_fingerprint=_fingerprint(_canonical_draft_payload(immutable)),
        drafts=immutable,
    )


def _require_single_file_generation(database_path: Path) -> None:
    present = [
        Path(f"{database_path}{suffix}").name
        for suffix in _SQLITE_SIDECAR_SUFFIXES
        if Path(f"{database_path}{suffix}").exists()
    ]
    if present:
        raise StagingSafetyError(
            "SQLite sidecar state is present; a stable single-file master.db generation "
            f"cannot be proven safe ({', '.join(present)})."
        )


def _load_database_factory() -> Callable[[str], Any]:
    try:
        from pyrekordbox import Rekordbox6Database  # type: ignore
    except ImportError as exc:  # pragma: no cover - runtime dependency
        raise ImportError("pyrekordbox is required for metadata preflight.") from exc
    return Rekordbox6Database


def metadata_preflight_availability() -> dict[str, Any]:
    """Prove the packaged Python runtime has the metadata reader dependency."""
    _load_database_factory()
    return {
        "available": True,
        "metadataSchemaVersion": METADATA_DRAFT_SCHEMA_VERSION,
        "genreMaxLength": GENRE_MAX_LENGTH,
    }


def _query_rows(value: Any) -> list[Any]:
    if value is None:
        return []
    all_method = getattr(value, "all", None)
    if callable(all_method):
        value = all_method()
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    try:
        return list(value)
    except TypeError:
        return [value]


def _genre_catalog(db: Any) -> tuple[dict[str, Any], dict[str, list[Any]]]:
    getter = getattr(db, "get_genre", None)
    if not callable(getter):
        raise RuntimeError("Installed pyrekordbox does not expose DjmdGenre lookup.")
    try:
        rows = _query_rows(getter())
    except Exception as exc:
        raise RuntimeError("Could not read DjmdGenre rows from local Rekordbox.") from exc

    by_id: dict[str, Any] = {}
    by_name: dict[str, list[Any]] = {}
    for row in rows:
        row_id = getattr(row, "ID", None)
        if row_id is None or not str(row_id).strip():
            raise RuntimeError("A local DjmdGenre row has no stable ID.")
        genre_id = str(row_id).strip()
        if genre_id in by_id:
            raise RuntimeError(f"Local DjmdGenre ID {genre_id} is not unique.")
        by_id[genre_id] = row
        name = normalize_genre(getattr(row, "Name", None), label=f"DjmdGenre {genre_id}.Name")
        if name is not None:
            by_name.setdefault(name, []).append(row)
    return by_id, by_name


def _genre_id_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text == "0":
        return None
    return text


def _observe_snapshot(
    snapshot_path: Path,
    plan: MetadataPreflightPlan,
    *,
    database_factory: Optional[Callable[[str], Any]] = None,
) -> tuple[_ObservedMetadataDraft, ...]:
    database_factory = database_factory or _load_database_factory()
    db = database_factory(str(snapshot_path))
    observed: list[_ObservedMetadataDraft] = []
    try:
        genres_by_id, genres_by_name = _genre_catalog(db)
        for draft in plan.drafts:
            try:
                content = _content_for_strong_identity(
                    db,
                    track_id=draft.track_id,
                    content_id=draft.master_content_id,
                    master_db_id=draft.master_db_id,
                    master_content_id=draft.master_content_id,
                    operation_label="metadata preflight",
                    require_master_db_id=True,
                )
            except StagingWriterError as exc:
                code = getattr(exc, "code", None)
                observed.append(
                    _ObservedMetadataDraft(
                        draft_id=draft.draft_id,
                        track_id=draft.track_id,
                        content_id=draft.master_content_id,
                        exists=code != "content-missing",
                        identity_comparison="missing"
                        if code in (
                            "strong-identity-missing",
                            "strong-db-identity-missing",
                            "content-missing",
                        )
                        else "mismatch",
                        identity_error=str(exc),
                        identity_error_code=code,
                        current_value=None,
                        baseline_comparison="not-comparable",
                        desired_resolution="blocked",
                        existing_genre_id=None,
                    )
                )
                continue

            current_genre_id = _genre_id_or_none(getattr(content, "GenreID", None))
            if current_genre_id is None:
                current_value = None
                genre_error = None
                genre_error_code = None
            else:
                current_row = genres_by_id.get(current_genre_id)
                if current_row is None:
                    observed.append(
                        _ObservedMetadataDraft(
                            draft_id=draft.draft_id,
                            track_id=draft.track_id,
                            content_id=draft.master_content_id,
                            exists=True,
                            identity_comparison="match",
                            identity_error=None,
                            identity_error_code=None,
                            current_value=None,
                            baseline_comparison="not-comparable",
                            desired_resolution="blocked",
                            existing_genre_id=None,
                            genre_error=(
                                f"Track {draft.track_id} GenreID {current_genre_id} does not "
                                "resolve to a DjmdGenre row."
                            ),
                            genre_error_code="genre-relationship-missing",
                        )
                    )
                    continue
                try:
                    current_value = normalize_genre(
                        getattr(current_row, "Name", None),
                        label=f"DjmdGenre {current_genre_id}.Name",
                    )
                except MetadataPlanValidationError as exc:
                    observed.append(
                        _ObservedMetadataDraft(
                            draft_id=draft.draft_id,
                            track_id=draft.track_id,
                            content_id=draft.master_content_id,
                            exists=True,
                            identity_comparison="match",
                            identity_error=None,
                            identity_error_code=None,
                            current_value=None,
                            baseline_comparison="not-comparable",
                            desired_resolution="blocked",
                            existing_genre_id=None,
                            genre_error=str(exc),
                            genre_error_code="genre-current-invalid",
                        )
                    )
                    continue
                if current_value is None:
                    genre_error = "The current DjmdGenre relationship has an empty Genre name."
                    genre_error_code = "genre-current-invalid"
                else:
                    genre_error = None
                    genre_error_code = None

            if genre_error is not None:
                observed.append(
                    _ObservedMetadataDraft(
                        draft_id=draft.draft_id,
                        track_id=draft.track_id,
                        content_id=draft.master_content_id,
                        exists=True,
                        identity_comparison="match",
                        identity_error=None,
                        identity_error_code=None,
                        current_value=current_value,
                        baseline_comparison="not-comparable",
                        desired_resolution="blocked",
                        existing_genre_id=None,
                        genre_error=genre_error,
                        genre_error_code=genre_error_code,
                    )
                )
                continue

            baseline_comparison: Literal["match", "diverged", "not-comparable"] = (
                "match" if current_value == draft.current_baseline_value else "diverged"
            )
            desired_resolution: Literal["reuse", "create", "clear", "blocked"]
            existing_genre_id: Optional[str] = None
            genre_error = None
            genre_error_code = None
            if draft.pending_value is None:
                desired_resolution = "clear"
            else:
                matches = genres_by_name.get(draft.pending_value, [])
                if len(matches) == 0:
                    desired_resolution = "create"
                elif len(matches) == 1:
                    desired_resolution = "reuse"
                    existing_genre_id = str(getattr(matches[0], "ID")).strip()
                else:
                    desired_resolution = "blocked"
                    genre_error = (
                        f"Desired Genre {draft.pending_value!r} matches {len(matches)} local "
                        "DjmdGenre rows after normalization; safe reuse is ambiguous."
                    )
                    genre_error_code = "genre-name-ambiguous"

            observed.append(
                _ObservedMetadataDraft(
                    draft_id=draft.draft_id,
                    track_id=draft.track_id,
                    content_id=draft.master_content_id,
                    exists=True,
                    identity_comparison="match",
                    identity_error=None,
                    identity_error_code=None,
                    current_value=current_value,
                    baseline_comparison=baseline_comparison,
                    desired_resolution=desired_resolution,
                    existing_genre_id=existing_genre_id,
                    genre_error=genre_error,
                    genre_error_code=genre_error_code,
                )
            )
    finally:
        _close_db(db)
    return tuple(observed)


def _observe_live_without_mutation(
    source: Path,
    plan: MetadataPreflightPlan,
    *,
    database_factory: Optional[Callable[[str], Any]] = None,
) -> tuple[str, tuple[_ObservedMetadataDraft, ...]]:
    _require_single_file_generation(source)
    before = file_identity(source)
    with readonly_snapshot(source) as snapshot:
        observed = _observe_snapshot(snapshot, plan, database_factory=database_factory)
    after = file_identity(source)
    _require_single_file_generation(source)
    if before != after:
        raise StagingSafetyError("Trusted local master.db changed during metadata preflight.")
    return after, observed


def _track_results(
    plan: MetadataPreflightPlan,
    observed: Sequence[_ObservedMetadataDraft],
) -> tuple[MetadataPreflightTrackResult, ...]:
    observed_by_id = {item.draft_id: item for item in observed}
    return tuple(
        MetadataPreflightTrackResult(
            draft_id=draft.draft_id,
            track_id=draft.track_id,
            field="genre",
            content_id=draft.master_content_id,
            exists=observed_by_id[draft.draft_id].exists,
            identity_comparison=observed_by_id[draft.draft_id].identity_comparison,
            draft_revision=draft.revision,
            draft_fingerprint=draft.draft_fingerprint,
            expected_baseline_value=draft.current_baseline_value,
            current_value=observed_by_id[draft.draft_id].current_value,
            pending_value=draft.pending_value,
            baseline_comparison=observed_by_id[draft.draft_id].baseline_comparison,
            desired_resolution=observed_by_id[draft.draft_id].desired_resolution,
            existing_genre_id=observed_by_id[draft.draft_id].existing_genre_id,
        )
        for draft in plan.drafts
    )


def _blockers(
    plan: MetadataPreflightPlan,
    observed: Sequence[_ObservedMetadataDraft],
) -> tuple[MetadataDiagnostic, ...]:
    observed_by_id = {item.draft_id: item for item in observed}
    blockers: list[MetadataDiagnostic] = []
    for draft in plan.drafts:
        item = observed_by_id[draft.draft_id]
        if item.identity_comparison != "match":
            code = item.identity_error_code or "strong-track-identity-mismatch"
            public_code = {
                "strong-identity-missing": "strong-track-identity-missing",
                "strong-db-identity-missing": "strong-db-identity-missing",
                "strong-db-identity-unavailable": "strong-db-identity-unavailable",
                "strong-db-identity-mismatch": "strong-db-identity-mismatch",
                "content-missing": "target-track-missing",
                "content-ambiguous": "strong-track-identity-ambiguous",
            }.get(code, "strong-track-identity-mismatch")
            blockers.append(
                _diagnostic(
                    public_code,
                    item.identity_error
                    or f"Track {draft.track_id} does not match current local Rekordbox identity.",
                )
            )
            continue
        if item.genre_error:
            blockers.append(
                _diagnostic(item.genre_error_code or "genre-resolution-failed", item.genre_error)
            )
        if item.baseline_comparison == "diverged":
            blockers.append(
                _diagnostic(
                    "genre-baseline-stale",
                    f"Track {draft.track_id} local Genre changed from the saved moving baseline; "
                    "re-import or rebase before applying the pending Genre.",
                    context={
                        "trackId": draft.track_id,
                        "expected": draft.current_baseline_value,
                        "current": item.current_value,
                        "pending": draft.pending_value,
                    },
                )
            )
        elif item.baseline_comparison == "not-comparable" and not item.genre_error:
            blockers.append(
                _diagnostic(
                    "genre-baseline-not-comparable",
                    f"Track {draft.track_id} Genre cannot be compared safely to its "
                    "moving baseline.",
                )
            )
    return tuple(blockers)


def _observed_identity(
    observed: Sequence[_ObservedMetadataDraft],
) -> tuple[tuple[str, str, Optional[str], Optional[str], str, Optional[str]], ...]:
    return tuple(
        (
            item.draft_id,
            item.content_id,
            item.current_value,
            item.existing_genre_id,
            item.desired_resolution,
            item.genre_error_code,
        )
        for item in observed
    )


def _preflight_plan_fingerprint(
    plan: MetadataPreflightPlan,
    source_identity: str,
    observed: Sequence[_ObservedMetadataDraft],
) -> str:
    return _fingerprint(
        {
            "schemaVersion": METADATA_DRAFT_SCHEMA_VERSION,
            "draftPlanFingerprint": plan.draft_plan_fingerprint,
            "sourceIdentity": source_identity,
            "observed": [
                {
                    "draftId": item.draft_id,
                    "contentId": item.content_id,
                    "exists": item.exists,
                    "identityComparison": item.identity_comparison,
                    "currentValue": item.current_value,
                    "baselineComparison": item.baseline_comparison,
                    "desiredResolution": item.desired_resolution,
                    "existingGenreId": item.existing_genre_id,
                    "genreErrorCode": item.genre_error_code,
                }
                for item in observed
            ],
        }
    )


def preflight_saved_metadata_drafts(
    saved_rows: Sequence[Mapping[str, Any]],
    *,
    token_store: Optional[MetadataPreflightTokenStore] = None,
    token_ttl_seconds: int = DEFAULT_METADATA_TOKEN_TTL_SECONDS,
    now: Optional[datetime] = None,
    discover_target: Callable[[], tuple[Path, Any]] = discover_trusted_writer_target,
    require_closed: Callable[[], Any] = require_rekordbox_closed,
    database_factory: Optional[Callable[[str], Any]] = None,
) -> MetadataPreflightResult:
    """Run a real, read-only metadata preflight and issue a bound opaque token."""
    preflight_id = uuid4().hex
    now = now or _utc_now()
    token_store = token_store or _METADATA_TOKEN_STORE
    if token_ttl_seconds <= 0:
        return MetadataPreflightResult(
            ok=False,
            preflight_id=preflight_id,
            plan_fingerprint="",
            source_identity=None,
            tracks=(),
            blockers=(
                _diagnostic("metadata-token-ttl-invalid", "Metadata token TTL must be positive."),
            ),
        )

    try:
        plan = adapt_saved_metadata_drafts(saved_rows)
    except MetadataPlanValidationError as exc:
        return MetadataPreflightResult(
            ok=False,
            preflight_id=preflight_id,
            plan_fingerprint="",
            source_identity=None,
            tracks=(),
            blockers=(_diagnostic("metadata-saved-plan-invalid", str(exc)),),
        )

    try:
        source, target_result = discover_target()
        require_closed()
        _require_single_file_generation(source)
        source_identity, observed = _observe_live_without_mutation(
            source, plan, database_factory=database_factory
        )
        trusted_identity = getattr(target_result, "source_identity", None)
        if trusted_identity and trusted_identity != source_identity:
            raise StagingSafetyError("Trusted target identity changed during metadata preflight.")
    except Exception as exc:  # noqa: BLE001 - structured fail-closed preflight response
        return MetadataPreflightResult(
            ok=False,
            preflight_id=preflight_id,
            plan_fingerprint=plan.draft_plan_fingerprint,
            source_identity=None,
            tracks=(),
            blockers=(_diagnostic("metadata-preflight-blocked", str(exc)),),
        )

    track_results = _track_results(plan, observed)
    blockers = _blockers(plan, observed)
    plan_fingerprint = _preflight_plan_fingerprint(plan, source_identity, observed)
    if blockers:
        return MetadataPreflightResult(
            ok=False,
            preflight_id=preflight_id,
            plan_fingerprint=plan_fingerprint,
            source_identity=source_identity,
            tracks=track_results,
            blockers=blockers,
        )

    expires_at = now + timedelta(seconds=token_ttl_seconds)
    record = MetadataTokenRecord(
        preflight_id=preflight_id,
        source_identity=source_identity,
        plan_fingerprint=plan_fingerprint,
        draft_identity=tuple(
            (draft.draft_id, draft.revision, draft.draft_fingerprint) for draft in plan.drafts
        ),
        observed_identity=_observed_identity(observed),
        issued_at=now,
        expires_at=expires_at,
    )
    token = token_store.issue(record)
    return MetadataPreflightResult(
        ok=True,
        preflight_id=preflight_id,
        plan_fingerprint=plan_fingerprint,
        source_identity=source_identity,
        tracks=track_results,
        token=token,
        expires_at=expires_at.isoformat(),
    )
