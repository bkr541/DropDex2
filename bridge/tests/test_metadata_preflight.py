"""Stage 4 read-only Genre metadata preflight tests."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from rekordbox_bridge.metadata_preflight import (
    MetadataPreflightTokenStore,
    preflight_saved_metadata_drafts,
)
from rekordbox_bridge.security import file_identity
from rekordbox_bridge.writer_models import TargetSafetyResult

NOW = datetime(2026, 8, 27, 10, 0, tzinfo=timezone.utc)


def draft(**overrides):
    row = {
        "id": "draft-1",
        "userId": "user-1",
        "importId": "import-1",
        "trackId": "track-1",
        "field": "genre",
        "schemaVersion": 1,
        "pendingValue": "Techno",
        "importedBaselineValue": "House",
        "currentBaselineValue": "House",
        "masterDbId": "db-main",
        "masterContentId": "101",
        "revision": 3,
        "draftFingerprint": "a" * 64,
    }
    row.update(overrides)
    return row


class FakeDatabase:
    def __init__(self, contents, genres):
        self.contents = {str(row.ID): row for row in contents}
        self.genres = list(genres)
        self.closed = False

    def get_content(self, **filters):
        return self.contents.get(str(filters.get("ID")))

    def get_genre(self):
        return list(self.genres)

    def close(self):
        self.closed = True


def content(*, content_id="101", master_db_id="db-main", genre_id="genre-house"):
    return SimpleNamespace(
        ID=content_id,
        UUID=f"uuid-{content_id}",
        MasterDBID=master_db_id,
        GenreID=genre_id,
    )


def genre(genre_id, name):
    return SimpleNamespace(ID=genre_id, Name=name)


def discovery_for(path: Path):
    def discover():
        return path, TargetSafetyResult(
            True,
            "trusted-local-master-db",
            "fixture",
            file_identity(path),
        )

    return discover


def preflight(path: Path, rows, *, contents=None, genres=None, store=None):
    contents = contents if contents is not None else [content()]
    genres = genres if genres is not None else [
        genre("genre-house", "House"),
        genre("genre-techno", "Techno"),
    ]

    def factory(_snapshot_path):
        return FakeDatabase(contents, genres)

    return preflight_saved_metadata_drafts(
        rows,
        token_store=store or MetadataPreflightTokenStore(),
        now=NOW,
        discover_target=discovery_for(path),
        require_closed=lambda: None,
        database_factory=factory,
    )


def master_db(tmp_path: Path) -> Path:
    path = tmp_path / "master.db"
    path.write_bytes(b"read-only-metadata-fixture")
    return path


def blocker_codes(result):
    return {blocker.code for blocker in result.blockers}


def test_matching_baseline_reuses_existing_genre_and_does_not_mutate_source(tmp_path):
    path = master_db(tmp_path)
    before_identity = file_identity(path)
    before_mtime = path.stat().st_mtime_ns
    store = MetadataPreflightTokenStore()

    result = preflight(path, [draft()], store=store)

    assert result.ok is True
    assert result.token
    assert result.tracks[0].identity_comparison == "match"
    assert result.tracks[0].current_value == "House"
    assert result.tracks[0].baseline_comparison == "match"
    assert result.tracks[0].desired_resolution == "reuse"
    assert result.tracks[0].existing_genre_id == "genre-techno"
    assert file_identity(path) == before_identity
    assert path.stat().st_mtime_ns == before_mtime
    assert not Path(f"{path}-wal").exists()
    assert not Path(f"{path}-shm").exists()

    record = store.claim(result.token, NOW)
    assert record.source_identity == before_identity
    assert record.draft_identity == (("draft-1", 3, "a" * 64),)
    assert record.observed_identity[0][2] == "House"
    assert record.observed_identity[0][4] == "reuse"


def test_missing_desired_genre_is_planned_for_creation_without_mutation(tmp_path):
    path = master_db(tmp_path)
    before = path.read_bytes()

    result = preflight(
        path,
        [draft(pendingValue="Future Bass")],
        genres=[genre("genre-house", "House")],
    )

    assert result.ok is True
    assert result.tracks[0].desired_resolution == "create"
    assert result.tracks[0].existing_genre_id is None
    assert path.read_bytes() == before


def test_null_genre_relationship_is_a_comparable_no_genre_baseline(tmp_path):
    path = master_db(tmp_path)
    result = preflight(
        path,
        [draft(currentBaselineValue=None, importedBaselineValue=None)],
        contents=[content(genre_id=None)],
        genres=[genre("genre-techno", "Techno")],
    )

    assert result.ok is True
    assert result.tracks[0].current_value is None
    assert result.tracks[0].baseline_comparison == "match"
    assert result.tracks[0].desired_resolution == "reuse"


def test_clear_genre_is_explicit_plan_action(tmp_path):
    path = master_db(tmp_path)
    result = preflight(path, [draft(pendingValue=None)])
    assert result.ok is True
    assert result.tracks[0].desired_resolution == "clear"


def test_external_genre_change_blocks_with_safe_expected_current_pending_context(tmp_path):
    path = master_db(tmp_path)
    result = preflight(
        path,
        [draft()],
        contents=[content(genre_id="genre-dnb")],
        genres=[
            genre("genre-house", "House"),
            genre("genre-dnb", "Drum & Bass"),
            genre("genre-techno", "Techno"),
        ],
    )

    assert result.ok is False
    assert "genre-baseline-stale" in blocker_codes(result)
    blocker = next(item for item in result.blockers if item.code == "genre-baseline-stale")
    assert blocker.context == {
        "trackId": "track-1",
        "expected": "House",
        "current": "Drum & Bass",
        "pending": "Techno",
    }
    assert result.tracks[0].baseline_comparison == "diverged"
    assert result.token is None


def test_wrong_master_db_identity_blocks(tmp_path):
    path = master_db(tmp_path)
    result = preflight(path, [draft(masterDbId="wrong-db")])
    assert result.ok is False
    assert "strong-db-identity-mismatch" in blocker_codes(result)
    assert result.token is None


def test_locally_deleted_or_wrong_content_id_blocks(tmp_path):
    path = master_db(tmp_path)
    deleted = preflight(path, [draft()], contents=[])
    assert deleted.ok is False
    assert "target-track-missing" in blocker_codes(deleted)
    assert deleted.tracks[0].exists is False

    wrong_id = preflight(path, [draft(masterContentId="999")])
    assert wrong_id.ok is False
    assert "target-track-missing" in blocker_codes(wrong_id)
    assert wrong_id.tracks[0].exists is False


def test_duplicate_normalized_genre_name_blocks_instead_of_guessing(tmp_path):
    path = master_db(tmp_path)
    result = preflight(
        path,
        [draft()],
        genres=[
            genre("genre-house", "House"),
            genre("genre-techno-1", "Techno"),
            genre("genre-techno-2", " Techno "),
        ],
    )
    assert result.ok is False
    assert "genre-name-ambiguous" in blocker_codes(result)
    assert result.tracks[0].desired_resolution == "blocked"


def test_revision_fingerprint_and_unexpected_fields_fail_before_local_lookup(tmp_path):
    path = master_db(tmp_path)
    bad_revision = preflight(path, [draft(revision=0)])
    assert bad_revision.ok is False
    assert blocker_codes(bad_revision) == {"metadata-saved-plan-invalid"}

    bad_fingerprint = preflight(path, [draft(draftFingerprint="ABC")])
    assert bad_fingerprint.ok is False
    assert blocker_codes(bad_fingerprint) == {"metadata-saved-plan-invalid"}

    row = draft()
    row["databasePath"] = "/tmp/not-allowed.db"
    extra_field = preflight(path, [row])
    assert extra_field.ok is False
    assert blocker_codes(extra_field) == {"metadata-saved-plan-invalid"}


def test_missing_master_identity_is_rejected_before_local_lookup(tmp_path):
    path = master_db(tmp_path)
    missing_db = preflight(path, [draft(masterDbId="")])
    assert missing_db.ok is False
    assert blocker_codes(missing_db) == {"metadata-saved-plan-invalid"}

    missing_content = preflight(path, [draft(masterContentId="")])
    assert missing_content.ok is False
    assert blocker_codes(missing_content) == {"metadata-saved-plan-invalid"}


def test_locked_or_unavailable_database_fails_closed(tmp_path):
    path = master_db(tmp_path)

    locked = preflight_saved_metadata_drafts(
        [draft()],
        now=NOW,
        discover_target=discovery_for(path),
        require_closed=lambda: (_ for _ in ()).throw(RuntimeError("rekordbox-running")),
        database_factory=lambda _path: FakeDatabase([], []),
    )
    assert locked.ok is False
    assert blocker_codes(locked) == {"metadata-preflight-blocked"}
    assert "rekordbox-running" in locked.blockers[0].message

    unavailable = preflight_saved_metadata_drafts(
        [draft()],
        now=NOW,
        discover_target=lambda: (_ for _ in ()).throw(RuntimeError("master.db unavailable")),
        require_closed=lambda: None,
        database_factory=lambda _path: FakeDatabase([], []),
    )
    assert unavailable.ok is False
    assert blocker_codes(unavailable) == {"metadata-preflight-blocked"}
    assert "unavailable" in unavailable.blockers[0].message


def test_sqlite_sidecar_blocks_unstable_generation(tmp_path):
    path = master_db(tmp_path)
    Path(f"{path}-wal").write_bytes(b"wal")
    result = preflight(path, [draft()])
    assert result.ok is False
    assert blocker_codes(result) == {"metadata-preflight-blocked"}
    assert "sidecar" in result.blockers[0].message.lower()


def test_plan_and_token_binding_change_with_revision_or_database_generation(tmp_path):
    path = master_db(tmp_path)
    first_store = MetadataPreflightTokenStore()
    first = preflight(path, [draft()], store=first_store)
    assert first.ok is True and first.token

    revised_store = MetadataPreflightTokenStore()
    revised = preflight(
        path,
        [draft(revision=4, draftFingerprint="b" * 64)],
        store=revised_store,
    )
    assert revised.ok is True and revised.token
    assert revised.plan_fingerprint != first.plan_fingerprint
    assert revised_store.claim(revised.token, NOW).draft_identity == (
        ("draft-1", 4, "b" * 64),
    )

    path.write_bytes(b"new-read-only-metadata-generation")
    changed_store = MetadataPreflightTokenStore()
    changed = preflight(path, [draft()], store=changed_store)
    assert changed.ok is True and changed.token
    assert changed.source_identity != first.source_identity
    assert changed.plan_fingerprint != first.plan_fingerprint
