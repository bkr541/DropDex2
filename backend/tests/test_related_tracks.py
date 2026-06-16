"""
Tests for POST /api/rekordbox/import/{import_id}/related-tracks.

All tests mock Supabase — no real credentials or DB calls are made.

To run:
    cd backend
    pytest tests/test_related_tracks.py -v
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.config import settings
from app.main import app

client = TestClient(app, raise_server_exceptions=False)

IMPORT_ID = "import-aaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
USER_ID = "user-aaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
OTHER_USER = "other-user-1111-2222-3333-444444444444"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_token(user_id: str = USER_ID) -> str:
    return jwt.encode(
        {"sub": user_id, "aud": "authenticated", "role": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )


def _auth(user_id: str = USER_ID) -> dict:
    return {"Authorization": f"Bearer {_make_token(user_id)}"}


def _payload(
    schema_version: int = 1,
    lists: list | None = None,
) -> dict:
    return {
        "schema_version": schema_version,
        "generated_at": "2024-01-01T00:00:00Z",
        "source": {},
        "lists": lists if lists is not None else [],
    }


def _simple_list(
    source_list_id: str = "list-001",
    members: list | None = None,
    is_folder: bool = False,
    parent_source_list_id: str | None = None,
) -> dict:
    return {
        "source_list_id": source_list_id,
        "parent_source_list_id": parent_source_list_id,
        "name": f"List {source_list_id}",
        "sort_order": 1,
        "is_folder": is_folder,
        "attribute": 0,
        "criteria_raw": {},
        "members": members if members is not None else [],
    }


def _member(master_content_id: str = "content-001", position: int = 1) -> dict:
    return {
        "master_content_id": master_content_id,
        "position": position,
        "source_payload": {},
    }


# ── Fake Supabase infrastructure ──────────────────────────────────────────────

class _FakeQuery:
    """
    Minimal chaining query builder. Supports select/eq/maybe_single/upsert/
    update/insert/delete and returns configured data on execute().
    """

    def __init__(self, data=None, *, _single: bool = False, _raise: Exception | None = None):
        self._data = data
        self._single = _single
        self._raise = _raise

    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def neq(self, *a, **k): return self

    def maybe_single(self):
        return _FakeQuery(self._data, _single=True, _raise=self._raise)

    def upsert(self, *a, **k): return self
    def update(self, *a, **k): return self
    def insert(self, *a, **k): return self
    def delete(self, *a, **k): return self

    def execute(self):
        if self._raise is not None:
            raise self._raise
        if self._single:
            data = (
                self._data[0]
                if isinstance(self._data, list) and self._data
                else (self._data if not isinstance(self._data, list) else None)
            )
        else:
            data = self._data
        return SimpleNamespace(data=data)


class _FakeSb:
    """
    Configurable fake Supabase client for related-tracks tests.

    Attributes
    ----------
    import_row : dict | None
        Returned for rekordbox_imports queries. None simulates "not found".
    tracks : list[dict]
        Returned for rekordbox_tracks queries.
    list_upsert_data : list[dict]
        Returned by upsert on rekordbox_related_track_lists.
    calls : list[tuple]
        Records (table_name, operation, args) for assertions.
    """

    def __init__(
        self,
        *,
        import_row: dict | None = None,
        tracks: list | None = None,
        list_upsert_data: list | None = None,
    ):
        self._import_row = import_row
        self._tracks: list = tracks or []
        # list_upsert_data: rows to return from upsert — must have "id"
        self._list_upsert_data: list = list_upsert_data or []
        self.calls: list = []

    def table(self, name: str) -> "_RecordingTableProxy":
        return _RecordingTableProxy(self, name)


class _RecordingTableProxy:
    """Records DML calls and returns configured data."""

    def __init__(self, sb: _FakeSb, table_name: str):
        self._sb = sb
        self._table = table_name
        self._pending_op: str | None = None
        self._pending_args: tuple = ()
        self._filter_vals: dict = {}
        self._single = False

    def select(self, *a, **k):
        return self

    def eq(self, col, val):
        self._filter_vals[col] = val
        return self

    def maybe_single(self):
        self._single = True
        return self

    def upsert(self, data, **k):
        self._pending_op = "upsert"
        self._pending_args = (data,)
        return self

    def update(self, data, **k):
        self._pending_op = "update"
        self._pending_args = (data,)
        return self

    def insert(self, data, **k):
        self._pending_op = "insert"
        self._pending_args = (data,)
        return self

    def delete(self):
        self._pending_op = "delete"
        return self

    def execute(self):
        op = self._pending_op or "select"
        self._sb.calls.append((self._table, op, self._pending_args, dict(self._filter_vals)))

        if self._table == "rekordbox_imports":
            data = self._sb._import_row
            if self._single:
                return SimpleNamespace(data=data)
            return SimpleNamespace(data=[data] if data else [])

        if self._table == "rekordbox_tracks":
            return SimpleNamespace(data=self._sb._tracks)

        if self._table == "rekordbox_related_track_lists":
            if op == "upsert":
                rows = self._sb._list_upsert_data
                return SimpleNamespace(data=rows if rows else [])
            return SimpleNamespace(data=[])

        if self._table == "rekordbox_related_track_members":
            return SimpleNamespace(data=[])

        return SimpleNamespace(data=None)


def _fake_sb(
    *,
    import_found: bool = True,
    tracks: list | None = None,
    list_upsert_data: list | None = None,
) -> _FakeSb:
    import_row = {"id": IMPORT_ID, "user_id": USER_ID} if import_found else None
    return _FakeSb(
        import_row=import_row,
        tracks=tracks or [],
        list_upsert_data=list_upsert_data or [{"id": "list-db-uuid-001"}],
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestWrongOwnerRejected:
    def test_wrong_owner_rejected(self):
        """A user cannot access another user's import — must return 404."""
        sb = _fake_sb(import_found=False)
        with patch("app.related_tracks_service._create_supabase", return_value=sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                headers=_auth(OTHER_USER),
                json=_payload(),
            )
        assert resp.status_code == 404

    def test_missing_auth_returns_422(self):
        resp = client.post(
            f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
            json=_payload(),
        )
        assert resp.status_code == 422


class TestInvalidSchemaVersion:
    def test_unsupported_schema_version_returns_422(self):
        sb = _fake_sb()
        with patch("app.related_tracks_service._create_supabase", return_value=sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                headers=_auth(),
                json=_payload(schema_version=99),
            )
        assert resp.status_code == 422
        assert "schema_version" in resp.json()["detail"].lower() or "99" in resp.json()["detail"]

    def test_schema_version_zero_returns_422(self):
        sb = _fake_sb()
        with patch("app.related_tracks_service._create_supabase", return_value=sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                headers=_auth(),
                json=_payload(schema_version=0),
            )
        assert resp.status_code == 422


class TestTooManyLists:
    def test_too_many_lists_returns_422(self):
        """Payloads with more than 2000 lists are rejected before any DB write."""
        big_lists = [_simple_list(source_list_id=f"list-{i}") for i in range(2001)]
        sb = _fake_sb()
        with patch("app.related_tracks_service._create_supabase", return_value=sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                headers=_auth(),
                json=_payload(lists=big_lists),
            )
        assert resp.status_code == 422
        # Verify no upsert was attempted
        upserts = [c for c in sb.calls if c[1] == "upsert"]
        assert len(upserts) == 0


class TestEmptyPayloadSucceeds:
    def test_empty_payload_returns_all_zeros(self):
        sb = _fake_sb()
        with patch("app.related_tracks_service._create_supabase", return_value=sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                headers=_auth(),
                json=_payload(lists=[]),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["import_id"] == IMPORT_ID
        assert body["lists_imported"] == 0
        assert body["folders_imported"] == 0
        assert body["members_imported"] == 0
        assert body["unmatched_tracks"] == 0
        assert body["ambiguous_tracks"] == 0
        assert body["duplicate_records"] == 0
        assert isinstance(body["warnings"], list)


class TestPrimaryMasterIdMatch:
    def test_member_matched_by_master_content_id(self):
        """A member whose master_content_id matches a track row is imported."""
        tracks = [
            {
                "id": "track-uuid-0001",
                "rekordbox_content_id": "100",
                "master_content_id": "content-001",
            }
        ]
        lists = [
            _simple_list(
                source_list_id="list-001",
                members=[_member(master_content_id="content-001", position=1)],
            )
        ]
        sb = _fake_sb(tracks=tracks)
        with patch("app.related_tracks_service._create_supabase", return_value=sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                headers=_auth(),
                json=_payload(lists=lists),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["lists_imported"] == 1
        assert body["members_imported"] == 1
        assert body["unmatched_tracks"] == 0

    def test_response_shape_correct(self):
        """Response must contain all required fields."""
        sb = _fake_sb()
        with patch("app.related_tracks_service._create_supabase", return_value=sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                headers=_auth(),
                json=_payload(),
            )
        assert resp.status_code == 200
        body = resp.json()
        required = {
            "import_id", "lists_imported", "folders_imported", "members_imported",
            "unmatched_tracks", "ambiguous_tracks", "duplicate_records", "warnings",
        }
        assert required.issubset(body.keys())


class TestContentIdFallback:
    def test_fallback_to_rekordbox_content_id(self):
        """
        When a track has no master_content_id, match by rekordbox_content_id
        using the same lookup key from the member's master_content_id field.
        """
        # Track has no master_content_id; member references "100" which matches rekordbox_content_id
        tracks = [
            {
                "id": "track-uuid-0002",
                "rekordbox_content_id": "100",
                "master_content_id": None,
            }
        ]
        lists = [
            _simple_list(
                source_list_id="list-002",
                members=[_member(master_content_id="100", position=1)],
            )
        ]
        sb = _fake_sb(tracks=tracks)
        with patch("app.related_tracks_service._create_supabase", return_value=sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                headers=_auth(),
                json=_payload(lists=lists),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["members_imported"] == 1
        assert body["unmatched_tracks"] == 0


class TestAmbiguousMatchSkipped:
    def test_two_tracks_same_master_id_counted_as_ambiguous(self):
        """Two tracks sharing the same master_content_id → ambiguous_tracks=1, member skipped."""
        tracks = [
            {"id": "track-a", "rekordbox_content_id": "100", "master_content_id": "shared-id"},
            {"id": "track-b", "rekordbox_content_id": "101", "master_content_id": "shared-id"},
        ]
        lists = [
            _simple_list(
                source_list_id="list-003",
                members=[_member(master_content_id="shared-id", position=1)],
            )
        ]
        sb = _fake_sb(tracks=tracks)
        with patch("app.related_tracks_service._create_supabase", return_value=sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                headers=_auth(),
                json=_payload(lists=lists),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["ambiguous_tracks"] == 1
        assert body["members_imported"] == 0
        # A warning should be emitted
        assert any("ambiguous" in w.lower() for w in body["warnings"])


class TestUnmatchedTrack:
    def test_no_matching_track_counted_as_unmatched(self):
        """A member with no matching track → unmatched_tracks=1, no member inserted."""
        tracks = [
            {"id": "track-uuid-0003", "rekordbox_content_id": "999", "master_content_id": "cid-999"},
        ]
        lists = [
            _simple_list(
                source_list_id="list-004",
                members=[_member(master_content_id="nonexistent-id", position=1)],
            )
        ]
        sb = _fake_sb(tracks=tracks)
        with patch("app.related_tracks_service._create_supabase", return_value=sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                headers=_auth(),
                json=_payload(lists=lists),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["unmatched_tracks"] == 1
        assert body["members_imported"] == 0


class TestParentListResolved:
    def test_parent_source_list_id_triggers_parent_update(self):
        """
        A list with parent_source_list_id should cause a DB update to set parent_list_id.
        We verify that an 'update' call was made on rekordbox_related_track_lists.
        """
        lists = [
            _simple_list(source_list_id="folder-001", is_folder=True),
            _simple_list(
                source_list_id="child-001",
                parent_source_list_id="folder-001",
            ),
        ]
        # Two upsert results: folder and child
        list_upsert_data_sequence = [
            [{"id": "db-folder-uuid"}],
            [{"id": "db-child-uuid"}],
        ]

        class _SequencedSb(_FakeSb):
            def __init__(self, *a, **kw):
                super().__init__(*a, **kw)
                self._upsert_idx = 0

            def table(self, name):
                proxy = _SequencedProxy(self, name)
                return proxy

        class _SequencedProxy(_RecordingTableProxy):
            def execute(self):
                op = self._pending_op or "select"
                self._sb.calls.append(
                    (self._table, op, self._pending_args, dict(self._filter_vals))
                )
                if self._table == "rekordbox_imports":
                    data = self._sb._import_row
                    if self._single:
                        return SimpleNamespace(data=data)
                    return SimpleNamespace(data=[data] if data else [])
                if self._table == "rekordbox_tracks":
                    return SimpleNamespace(data=self._sb._tracks)
                if self._table == "rekordbox_related_track_lists":
                    if op == "upsert":
                        idx = self._sb._upsert_idx
                        self._sb._upsert_idx += 1
                        rows = list_upsert_data_sequence[idx] if idx < len(list_upsert_data_sequence) else []
                        return SimpleNamespace(data=rows)
                    # update call
                    return SimpleNamespace(data=[])
                return SimpleNamespace(data=[])

        sb = _SequencedSb(
            import_row={"id": IMPORT_ID, "user_id": USER_ID},
            tracks=[],
        )
        with patch("app.related_tracks_service._create_supabase", return_value=sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                headers=_auth(),
                json=_payload(lists=lists),
            )

        assert resp.status_code == 200
        # Verify at least one update was attempted on the lists table for parent linkage
        updates = [c for c in sb.calls if c[0] == "rekordbox_related_track_lists" and c[1] == "update"]
        assert len(updates) >= 1


class TestIdempotentUpload:
    def test_same_payload_twice_no_error(self):
        """Uploading the same payload twice must not raise an error."""
        tracks = [
            {"id": "track-uuid-0010", "rekordbox_content_id": "200", "master_content_id": "cid-200"},
        ]
        lists = [
            _simple_list(
                source_list_id="list-idem-001",
                members=[_member(master_content_id="cid-200", position=1)],
            )
        ]
        payload = _payload(lists=lists)

        for _ in range(2):
            sb = _fake_sb(tracks=tracks)
            with patch("app.related_tracks_service._create_supabase", return_value=sb):
                resp = client.post(
                    f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                    headers=_auth(),
                    json=payload,
                )
            assert resp.status_code == 200
            body = resp.json()
            assert body["lists_imported"] == 1
            assert body["members_imported"] == 1


class TestFolderCounting:
    def test_folder_counted_in_folders_imported_not_lists(self):
        """is_folder=True lists increment folders_imported, not lists_imported."""
        lists = [
            _simple_list(source_list_id="folder-001", is_folder=True),
            _simple_list(source_list_id="regular-001", is_folder=False),
        ]
        sb = _fake_sb()
        with patch("app.related_tracks_service._create_supabase", return_value=sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                headers=_auth(),
                json=_payload(lists=lists),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["folders_imported"] == 1
        assert body["lists_imported"] == 1


class TestInvalidPayloadPreservesExisting:
    def test_schema_version_mismatch_does_not_erase_data(self):
        """
        When schema_version is wrong, the request is rejected at validation time
        (before any delete), so existing data is unaffected.
        """
        sb = _fake_sb()
        with patch("app.related_tracks_service._create_supabase", return_value=sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                headers=_auth(),
                json=_payload(schema_version=2),
            )
        assert resp.status_code == 422
        # No delete calls should have been made
        deletes = [c for c in sb.calls if c[1] == "delete"]
        assert len(deletes) == 0

    def test_too_many_members_in_one_list_returns_422(self):
        """A list with >10000 members is rejected before any DB writes."""
        big_members = [_member(master_content_id=f"cid-{i}", position=i) for i in range(10001)]
        lists = [_simple_list(source_list_id="big-list", members=big_members)]
        sb = _fake_sb()
        with patch("app.related_tracks_service._create_supabase", return_value=sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/related-tracks",
                headers=_auth(),
                json=_payload(lists=lists),
            )
        assert resp.status_code == 422
