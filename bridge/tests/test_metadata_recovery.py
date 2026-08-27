"""Stage 6A read-only metadata recovery verification tests."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from types import SimpleNamespace

from rekordbox_bridge.metadata_recovery import verify_metadata_recovery
from rekordbox_bridge.security import file_identity
from rekordbox_bridge.writer_models import TargetSafetyResult


class GenreReadDb:
    def __init__(self, path: str):
        self.conn = sqlite3.connect(path)

    def get_content(self, **filters):
        row = self.conn.execute(
            "select ID, UUID, MasterDBID, GenreID from djmdContent where ID = ?",
            (str(filters.get("ID")),),
        ).fetchone()
        if row is None:
            return None
        return SimpleNamespace(ID=row[0], UUID=row[1], MasterDBID=row[2], GenreID=row[3])

    def get_genre(self):
        return [
            SimpleNamespace(ID=row[0], Name=row[1], UUID=row[2])
            for row in self.conn.execute("select ID, Name, UUID from djmdGenre order by ID")
        ]

    def close(self):
        self.conn.close()


def fixture_db(tmp_path: Path) -> Path:
    path = tmp_path / "master.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        create table djmdGenre (ID text primary key, Name text not null, UUID text not null);
        create table djmdContent (ID text primary key, UUID text not null, MasterDBID text not null, GenreID text null);
        insert into djmdGenre values ('1', 'House', 'genre-house');
        insert into djmdGenre values ('2', 'Techno', 'genre-techno');
        insert into djmdContent values ('101', 'content-101', 'db-main', '2');
        """
    )
    conn.commit()
    conn.close()
    return path


def discovery_for(path: Path):
    def discover():
        return path, TargetSafetyResult(True, "trusted-local-master-db", "fixture", file_identity(path))
    return discover


def recovery_request(path: Path, **overrides):
    request = {
        "operationId": "metadata-operation-1",
        "trackId": "track-1",
        "field": "genre",
        "masterDbId": "db-main",
        "masterContentId": "101",
        "appliedRevision": 3,
        "draftFingerprint": "a" * 64,
        "planFingerprint": "b" * 64,
        "appliedValue": "Techno",
        "sourceIdentityAfter": file_identity(path),
    }
    request.update(overrides)
    return request


def test_recovery_verifies_genre_and_strong_identity_without_rewriting_source(tmp_path):
    path = fixture_db(tmp_path)
    before = file_identity(path)
    result = verify_metadata_recovery(
        recovery_request(path),
        discover_target=discovery_for(path),
        require_closed=lambda: None,
        database_factory=GenreReadDb,
    )
    assert result.ok is True
    assert result.state == "verified"
    assert result.current_value == "Techno"
    assert result.master_identity_comparison == "match"
    assert result.source_generation_comparison == "match"
    assert file_identity(path) == before


def test_recovery_blocks_when_local_genre_changed(tmp_path):
    path = fixture_db(tmp_path)
    request = recovery_request(path)
    conn = sqlite3.connect(path)
    conn.execute("update djmdContent set GenreID = '1' where ID = '101'")
    conn.commit()
    conn.close()

    result = verify_metadata_recovery(
        request,
        discover_target=discovery_for(path),
        require_closed=lambda: None,
        database_factory=GenreReadDb,
    )
    assert result.ok is False
    assert result.blockers[0].code == "metadata-recovery-local-genre-changed"
    assert result.current_value == "House"


def test_recovery_blocks_when_master_identity_changed(tmp_path):
    path = fixture_db(tmp_path)
    request = recovery_request(path)
    conn = sqlite3.connect(path)
    conn.execute("update djmdContent set MasterDBID = 'db-other' where ID = '101'")
    conn.commit()
    conn.close()

    result = verify_metadata_recovery(
        request,
        discover_target=discovery_for(path),
        require_closed=lambda: None,
        database_factory=GenreReadDb,
    )
    assert result.ok is False
    assert result.master_identity_comparison == "mismatch"
    assert result.blockers[0].code == "strong-db-identity-mismatch"


def test_recovery_allows_unrelated_generation_change_when_scoped_semantics_still_match(tmp_path):
    path = fixture_db(tmp_path)
    request = recovery_request(path)
    conn = sqlite3.connect(path)
    conn.execute("pragma user_version = 9")
    conn.commit()
    conn.close()

    result = verify_metadata_recovery(
        request,
        discover_target=discovery_for(path),
        require_closed=lambda: None,
        database_factory=GenreReadDb,
    )
    assert result.ok is True
    assert result.source_generation_comparison == "changed"
    assert result.current_value == "Techno"
