"""Stage 5 verified Rekordbox Genre writer tests using a safe SQLite fixture."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from rekordbox_bridge.metadata_apply import apply_saved_metadata_drafts
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


class GenreSqliteDb:
    """Tiny pyrekordbox-shaped adapter around an ordinary SQLite test DB."""

    def __init__(self, path: str):
        self.conn = sqlite3.connect(path)
        self._loaded_contents: dict[str, SimpleNamespace] = {}
        self._new_genres: list[SimpleNamespace] = []

    def get_content(self, **filters):
        content_id = str(filters.get("ID"))
        row = self.conn.execute(
            "select ID, UUID, MasterDBID, GenreID from djmdContent where ID = ?",
            (content_id,),
        ).fetchone()
        if row is None:
            return None
        content = SimpleNamespace(ID=row[0], UUID=row[1], MasterDBID=row[2], GenreID=row[3])
        self._loaded_contents[content_id] = content
        return content

    def get_genre(self):
        rows = [
            SimpleNamespace(ID=row[0], Name=row[1], UUID=row[2])
            for row in self.conn.execute("select ID, Name, UUID from djmdGenre order by ID")
        ]
        return rows + list(self._new_genres)

    def add_genre(self, *, name: str):
        existing = self.conn.execute("select ID from djmdGenre where Name = ?", (name,)).fetchone()
        if existing is not None:
            raise ValueError(f"Genre {name!r} already exists")
        for row in self._new_genres:
            if row.Name == name:
                raise ValueError(f"Genre {name!r} already exists")
        numeric_ids = [
            int(row[0])
            for row in self.conn.execute("select ID from djmdGenre")
            if str(row[0]).isdigit()
        ]
        new_id = str(max(numeric_ids, default=0) + len(self._new_genres) + 1)
        genre = SimpleNamespace(ID=new_id, Name=name, UUID=str(uuid4()))
        self._new_genres.append(genre)
        return genre

    def commit(self):
        for row in self._new_genres:
            self.conn.execute(
                "insert into djmdGenre (ID, Name, UUID) values (?, ?, ?)",
                (row.ID, row.Name, row.UUID),
            )
        self._new_genres.clear()
        for content in self._loaded_contents.values():
            self.conn.execute(
                "update djmdContent set GenreID = ? where ID = ?",
                (content.GenreID, content.ID),
            )
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()
        self._new_genres.clear()

    def close(self):
        self.conn.close()


def fixture_db(tmp_path: Path) -> Path:
    path = tmp_path / "master.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        create table djmdGenre (ID text primary key, Name text not null, UUID text not null);
        create table djmdContent (
          ID text primary key,
          UUID text not null,
          MasterDBID text not null,
          GenreID text null
        );
        insert into djmdGenre values ('1', 'House', 'genre-house');
        insert into djmdGenre values ('2', 'Techno', 'genre-techno');
        insert into djmdContent values ('101', 'content-101', 'db-main', '1');
        insert into djmdContent values ('202', 'content-202', 'db-main', '1');
        """
    )
    conn.commit()
    conn.close()
    return path


def discovery_for(path: Path):
    def discover():
        return path, TargetSafetyResult(
            True,
            "trusted-local-master-db",
            "fixture",
            file_identity(path),
        )

    return discover


def genre_state(path: Path):
    conn = sqlite3.connect(path)
    try:
        genres = conn.execute("select ID, Name from djmdGenre order by ID").fetchall()
        contents = conn.execute("select ID, GenreID from djmdContent order by ID").fetchall()
        return genres, contents
    finally:
        conn.close()


def preflight_and_apply(path: Path, rows, **apply_overrides):
    store = MetadataPreflightTokenStore()
    preflight = preflight_saved_metadata_drafts(
        rows,
        token_store=store,
        now=NOW,
        discover_target=discovery_for(path),
        require_closed=lambda: None,
        database_factory=GenreSqliteDb,
    )
    assert preflight.ok is True and preflight.token
    result = apply_saved_metadata_drafts(
        preflight.token,
        rows,
        token_store=store,
        now=NOW + timedelta(seconds=1),
        discover_target=discovery_for(path),
        require_closed=lambda: None,
        database_factory=GenreSqliteDb,
        **apply_overrides,
    )
    return preflight, result


def blocker_codes(result):
    return {item.code for item in result.blockers}


def test_existing_genre_is_reused_through_staged_apply_and_old_row_is_preserved(tmp_path):
    path = fixture_db(tmp_path)
    _, result = preflight_and_apply(path, [draft()])

    assert result.ok is True
    assert result.state == "applied"
    assert result.tracks[0].desired_resolution == "reuse"
    assert result.tracks[0].resolved_genre_id == "2"
    assert result.tracks[0].verification_state == "verified"
    genres, contents = genre_state(path)
    assert genres == [("1", "House"), ("2", "Techno")]
    assert contents == [("101", "2"), ("202", "1")]
    assert not (path.parent / ".dropdex-writer" / "staging" / result.operation_id).exists()


def test_same_new_genre_is_created_once_and_shared_by_multiple_tracks(tmp_path):
    path = fixture_db(tmp_path)
    rows = [
        draft(pendingValue="Future Bass", draftFingerprint="a" * 64),
        draft(
            id="draft-2",
            trackId="track-2",
            masterContentId="202",
            pendingValue="Future Bass",
            draftFingerprint="b" * 64,
        ),
    ]
    _, result = preflight_and_apply(path, rows)

    assert result.ok is True
    assert all(track.desired_resolution == "create" for track in result.tracks)
    genres, contents = genre_state(path)
    new_rows = [(genre_id, name) for genre_id, name in genres if name == "Future Bass"]
    assert len(new_rows) == 1
    new_id = new_rows[0][0]
    assert contents == [("101", new_id), ("202", new_id)]
    assert [(genre_id, name) for genre_id, name in genres if name == "House"] == [("1", "House")]


def test_clear_genre_writes_null_and_verifies_after_reopen(tmp_path):
    path = fixture_db(tmp_path)
    _, result = preflight_and_apply(path, [draft(pendingValue=None)])

    assert result.ok is True
    assert result.tracks[0].desired_resolution == "clear"
    assert result.tracks[0].normalized_applied_genre is None
    assert result.tracks[0].resolved_genre_id is None
    _, contents = genre_state(path)
    assert contents[0] == ("101", None)


def test_stale_live_genre_after_preflight_rejects_before_staging_mutation(tmp_path):
    path = fixture_db(tmp_path)
    store = MetadataPreflightTokenStore()
    row = draft()
    preflight = preflight_saved_metadata_drafts(
        [row], token_store=store, now=NOW, discover_target=discovery_for(path),
        require_closed=lambda: None, database_factory=GenreSqliteDb,
    )
    assert preflight.ok and preflight.token

    conn = sqlite3.connect(path)
    conn.execute("update djmdContent set GenreID = '2' where ID = '101'")
    conn.commit()
    conn.close()
    before_apply = genre_state(path)

    result = apply_saved_metadata_drafts(
        preflight.token, [row], token_store=store, now=NOW + timedelta(seconds=1),
        discover_target=discovery_for(path), require_closed=lambda: None,
        database_factory=GenreSqliteDb,
    )

    assert result.ok is False
    assert result.state == "rejected"
    assert (
        "genre-baseline-stale" in blocker_codes(result)
        or "metadata-preflight-stale" in blocker_codes(result)
    )
    assert genre_state(path) == before_apply
    assert not (path.parent / ".dropdex-writer" / "staging" / result.operation_id).exists()


def test_generation_change_after_preflight_blocks_even_when_genre_semantics_are_unchanged(tmp_path):
    path = fixture_db(tmp_path)
    store = MetadataPreflightTokenStore()
    row = draft()
    preflight = preflight_saved_metadata_drafts(
        [row], token_store=store, now=NOW, discover_target=discovery_for(path),
        require_closed=lambda: None, database_factory=GenreSqliteDb,
    )
    assert preflight.ok and preflight.token

    conn = sqlite3.connect(path)
    conn.execute("pragma user_version = 7")
    conn.commit()
    conn.close()
    assert genre_state(path)[1][0] == ("101", "1")

    result = apply_saved_metadata_drafts(
        preflight.token, [row], token_store=store, now=NOW + timedelta(seconds=1),
        discover_target=discovery_for(path), require_closed=lambda: None,
        database_factory=GenreSqliteDb,
    )

    assert result.ok is False
    assert result.state == "rejected"
    assert "metadata-preflight-stale" in blocker_codes(result)
    assert genre_state(path)[1][0] == ("101", "1")


def test_staging_semantic_verification_failure_blocks_live_replacement(tmp_path):
    path = fixture_db(tmp_path)
    before_identity = file_identity(path)
    staging_opens = 0

    class WrongReadDb(GenreSqliteDb):
        def get_content(self, **filters):
            content = super().get_content(**filters)
            if content is not None and str(content.ID) == "101":
                content.GenreID = "1"
            return content

    def factory(db_path: str):
        nonlocal staging_opens
        if ".dropdex-writer/staging/" in db_path.replace("\\", "/"):
            staging_opens += 1
            if staging_opens == 2:
                return WrongReadDb(db_path)
        return GenreSqliteDb(db_path)

    store = MetadataPreflightTokenStore()
    row = draft()
    preflight = preflight_saved_metadata_drafts(
        [row], token_store=store, now=NOW, discover_target=discovery_for(path),
        require_closed=lambda: None, database_factory=GenreSqliteDb,
    )
    assert preflight.ok and preflight.token
    result = apply_saved_metadata_drafts(
        preflight.token, [row], token_store=store, now=NOW + timedelta(seconds=1),
        discover_target=discovery_for(path), require_closed=lambda: None,
        database_factory=factory,
    )

    assert result.ok is False
    assert result.state == "rejected"
    assert "metadata-staging-verification-failed" in blocker_codes(result)
    assert file_identity(path) == before_identity
    assert genre_state(path)[1][0] == ("101", "1")
    assert not (path.parent / ".dropdex-writer" / "staging" / result.operation_id).exists()


def test_staging_failure_leaves_live_database_unchanged(tmp_path):
    path = fixture_db(tmp_path)
    before_identity = file_identity(path)

    class FailOnWritableStaging(GenreSqliteDb):
        def __init__(self, db_path: str):
            if ".dropdex-writer/staging/" in db_path.replace("\\", "/"):
                raise RuntimeError("synthetic staging open failure")
            super().__init__(db_path)

    store = MetadataPreflightTokenStore()
    row = draft()
    preflight = preflight_saved_metadata_drafts(
        [row], token_store=store, now=NOW, discover_target=discovery_for(path),
        require_closed=lambda: None, database_factory=GenreSqliteDb,
    )
    assert preflight.ok and preflight.token
    result = apply_saved_metadata_drafts(
        preflight.token, [row], token_store=store, now=NOW + timedelta(seconds=1),
        discover_target=discovery_for(path), require_closed=lambda: None,
        database_factory=FailOnWritableStaging,
    )

    assert result.ok is False
    assert result.state == "rejected"
    assert "metadata-staging-failed" in blocker_codes(result)
    assert file_identity(path) == before_identity
    assert genre_state(path)[1][0] == ("101", "1")


def test_atomic_replacement_failure_keeps_live_database_unchanged(tmp_path):
    path = fixture_db(tmp_path)
    before_identity = file_identity(path)

    def fail_replace(*_args, **_kwargs):
        raise RuntimeError("synthetic replace failure")

    _, result = preflight_and_apply(path, [draft()], replace_generation=fail_replace)

    assert result.ok is False
    assert result.state == "rejected"
    assert "metadata-atomic-replacement-failed" in blocker_codes(result)
    assert file_identity(path) == before_identity
    assert genre_state(path)[1][0] == ("101", "1")


def test_live_verification_failure_triggers_verified_rollback(tmp_path):
    path = fixture_db(tmp_path)
    before_identity = file_identity(path)

    def corrupt_after_replace(live_path: Path):
        conn = sqlite3.connect(live_path)
        conn.execute("update djmdContent set GenreID = '1' where ID = '101'")
        conn.commit()
        conn.close()

    _, result = preflight_and_apply(path, [draft()], after_replace_hook=corrupt_after_replace)

    assert result.ok is False
    assert result.state == "rolled-back"
    assert result.rollback_verified is True
    assert "metadata-final-verification-failed" in blocker_codes(result)
    assert file_identity(path) == before_identity
    assert genre_state(path)[1][0] == ("101", "1")


def test_unverifiable_rollback_surfaces_explicit_recovery_state(tmp_path):
    path = fixture_db(tmp_path)

    def corrupt_after_replace(live_path: Path):
        conn = sqlite3.connect(live_path)
        conn.execute("update djmdContent set GenreID = '1' where ID = '101'")
        conn.commit()
        conn.close()

    def corrupt_after_rollback(live_path: Path):
        conn = sqlite3.connect(live_path)
        conn.execute("update djmdContent set GenreID = '2' where ID = '101'")
        conn.commit()
        conn.close()

    _, result = preflight_and_apply(
        path,
        [draft()],
        after_replace_hook=corrupt_after_replace,
        after_rollback_hook=corrupt_after_rollback,
    )

    assert result.ok is False
    assert result.state == "recovery-unverified"
    assert result.rollback_verified is False
    assert "metadata-rollback-unverified" in blocker_codes(result)
    assert result.recovery is not None
    assert result.recovery["status"] == "manual-recovery-required"


def test_apply_token_is_single_use(tmp_path):
    path = fixture_db(tmp_path)
    store = MetadataPreflightTokenStore()
    row = draft()
    preflight = preflight_saved_metadata_drafts(
        [row], token_store=store, now=NOW, discover_target=discovery_for(path),
        require_closed=lambda: None, database_factory=GenreSqliteDb,
    )
    assert preflight.ok and preflight.token
    first = apply_saved_metadata_drafts(
        preflight.token, [row], token_store=store, now=NOW + timedelta(seconds=1),
        discover_target=discovery_for(path), require_closed=lambda: None,
        database_factory=GenreSqliteDb,
    )
    assert first.ok is True
    second = apply_saved_metadata_drafts(
        preflight.token, [row], token_store=store, now=NOW + timedelta(seconds=2),
        discover_target=discovery_for(path), require_closed=lambda: None,
        database_factory=GenreSqliteDb,
    )
    assert second.ok is False
    assert "metadata-token-replayed" in blocker_codes(second)
