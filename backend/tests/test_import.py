"""
Tests for the DropDex import API.

All tests that touch the rekordbox parser or Supabase writer use mocks so
they run without pyrekordbox, sqlcipher3, or real credentials.

To run:
    cd backend
    pytest tests/ -v
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt

# conftest.py sets env vars before this import
from app.main import app
from app.config import settings

client = TestClient(app, raise_server_exceptions=False)

DB_BYTES = b"SQLite format 3\x00" + b"\x00" * 84  # minimal SQLite-like header


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_token(user_id: str = "user-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") -> str:
    """Create a valid HS256 JWT signed with the test secret."""
    return jwt.encode(
        {"sub": user_id, "aud": "authenticated", "role": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )


def _auth(user_id: str = "user-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") -> dict:
    return {"Authorization": f"Bearer {_make_token(user_id)}"}


def _db_file(name: str = "exportLibrary.db", content: bytes = DB_BYTES):
    return {"file": (name, content, "application/octet-stream")}


class _FakeLibrary:
    """Minimal stand-in for dropdex_importer.models.ParsedLibrary."""

    class _Track:
        rekordbox_content_id = "100"
        title = "Test Track"
        artist = "Test Artist"
        album = None
        remixer = None
        genre = None
        label = None
        musical_key = None
        bpm = 128.0
        duration_seconds = 240
        rating = None
        comments = None
        file_path = None
        file_format = None
        date_added = None

    class _Playlist:
        rekordbox_playlist_id = "1"
        name = "My Playlist"
        sort_order = 1
        is_folder = False
        parent_rekordbox_playlist_id = None

    class _Placement:
        rekordbox_playlist_id = "1"
        rekordbox_content_id = "100"
        position = 1

    tracks = [_Track()]
    playlists = [_Playlist()]
    placements = [_Placement()]
    cues = []
    recommendation_edges = []
    analysis_manifest = []
    parse_warnings = []
    source_filename = "exportLibrary.db"
    device_name = "USB Drive"
    database_version = "6.0"
    rekordbox_created_date = "2024-01-01"


class _MockWriteResult:
    """Stand-in for ImportWriteResult so tests don't import dropdex_importer."""

    def __init__(self, import_id: str = "import-uuid-1234"):
        self.import_id = import_id
        self.rb_to_sb_track = {}
        self.manifest = []
        self.cue_count = 0
        self.recommendation_edge_count = 0


class _FakeValidation:
    ok = True
    errors: list = []
    warnings: list = []


def _mock_parse(_path):
    return _FakeLibrary()


def _mock_validate(_library):
    return _FakeValidation()


def _mock_write(_library, _url, _key, user_id):
    return _MockWriteResult("import-uuid-1234")


# ── Authentication tests ───────────────────────────────────────────────────────

class TestAuthentication:
    def test_missing_authorization_header_rejected(self):
        resp = client.post("/api/rekordbox/import", files=_db_file())
        # FastAPI returns 422 for missing required Header
        assert resp.status_code == 422

    def test_non_bearer_token_rejected(self):
        resp = client.post(
            "/api/rekordbox/import",
            headers={"Authorization": "Basic dXNlcjpwYXNz"},
            files=_db_file(),
        )
        assert resp.status_code == 401

    def test_invalid_jwt_rejected(self):
        resp = client.post(
            "/api/rekordbox/import",
            headers={"Authorization": "Bearer this.is.not.valid"},
            files=_db_file(),
        )
        assert resp.status_code == 401

    def test_wrong_audience_rejected(self):
        token = jwt.encode(
            {"sub": "user-id", "aud": "anon"},  # anon audience, not "authenticated"
            settings.supabase_jwt_secret,
            algorithm="HS256",
        )
        resp = client.post(
            "/api/rekordbox/import",
            headers={"Authorization": f"Bearer {token}"},
            files=_db_file(),
        )
        assert resp.status_code == 401

    def test_token_without_sub_rejected(self):
        token = jwt.encode(
            {"aud": "authenticated", "role": "authenticated"},  # no sub
            settings.supabase_jwt_secret,
            algorithm="HS256",
        )
        resp = client.post(
            "/api/rekordbox/import",
            headers={"Authorization": f"Bearer {token}"},
            files=_db_file(),
        )
        assert resp.status_code == 401


# ── File validation tests ──────────────────────────────────────────────────────

class TestFileValidation:
    def test_non_db_extension_rejected(self):
        resp = client.post(
            "/api/rekordbox/import",
            headers=_auth(),
            files={"file": ("rekordbox.xml", b"<xml/>", "text/xml")},
        )
        assert resp.status_code == 422
        assert ".db" in resp.json()["detail"].lower()

    def test_txt_extension_rejected(self):
        resp = client.post(
            "/api/rekordbox/import",
            headers=_auth(),
            files={"file": ("export.txt", b"not a db", "text/plain")},
        )
        assert resp.status_code == 422

    def test_oversized_file_rejected(self, monkeypatch):
        monkeypatch.setattr(settings, "max_upload_bytes", 10)
        resp = client.post(
            "/api/rekordbox/import",
            headers=_auth(),
            files=_db_file(content=b"x" * 11),
        )
        assert resp.status_code == 413
        assert "MB" in resp.json()["detail"] or "size" in resp.json()["detail"].lower()

    def test_file_at_exact_limit_accepted(self, monkeypatch):
        monkeypatch.setattr(settings, "max_upload_bytes", 100)
        with (
            patch("app.import_service.parse_library", _mock_parse),
            patch("app.import_service.validate", _mock_validate),
            patch("app.import_service.write_to_supabase_full", _mock_write),
        ):
            resp = client.post(
                "/api/rekordbox/import",
                headers=_auth(),
                files=_db_file(content=b"x" * 100),
            )
        assert resp.status_code == 200


# ── Temp file cleanup tests ────────────────────────────────────────────────────

class TestTempFileCleanup:
    def test_cleanup_after_parse_failure(self, monkeypatch):
        """Temp file is deleted even when the parser raises."""
        created: list[str] = []
        import tempfile as _tempfile

        _real_ntf = _tempfile.NamedTemporaryFile

        def capturing_ntf(**kwargs):
            obj = _real_ntf(**kwargs)
            created.append(obj.name)
            return obj

        monkeypatch.setattr("app.import_service.tempfile.NamedTemporaryFile", capturing_ntf)
        monkeypatch.setattr(
            "app.import_service.parse_library",
            lambda _: (_ for _ in ()).throw(RuntimeError("simulated parse failure")),
        )

        resp = client.post(
            "/api/rekordbox/import",
            headers=_auth(),
            files=_db_file(),
        )
        assert resp.status_code in (422, 500)
        assert created, "Expected at least one temp file to be created"
        for path in created:
            assert not os.path.exists(path), f"Temp file was not cleaned up: {path}"

    def test_cleanup_after_successful_import(self, monkeypatch):
        """Temp file is deleted after a successful import too."""
        created: list[str] = []
        import tempfile as _tempfile

        _real_ntf = _tempfile.NamedTemporaryFile

        def capturing_ntf(**kwargs):
            obj = _real_ntf(**kwargs)
            created.append(obj.name)
            return obj

        monkeypatch.setattr("app.import_service.tempfile.NamedTemporaryFile", capturing_ntf)

        with (
            patch("app.import_service.parse_library", _mock_parse),
            patch("app.import_service.validate", _mock_validate),
            patch("app.import_service.write_to_supabase_full", _mock_write),
        ):
            resp = client.post(
                "/api/rekordbox/import",
                headers=_auth(),
                files=_db_file(),
            )
        assert resp.status_code == 200
        for path in created:
            assert not os.path.exists(path), f"Temp file was not cleaned up after success: {path}"


# ── Ownership / user_id isolation tests ───────────────────────────────────────

class TestOwnership:
    def test_user_id_comes_from_token_not_form_data(self):
        """
        Even if a caller tries to inject user_id in the multipart form,
        the backend always uses the user_id extracted from the JWT.
        """
        legit_user = "legit-user-aaaa-bbbb-cccc-dddddddddddd"
        evil_user = "evil-user-1111-2222-3333-444444444444"

        captured: list[str] = []

        def tracking_write(_library, _url, _key, user_id):
            captured.append(user_id)
            return _MockWriteResult("import-uuid-ownership-test")

        with (
            patch("app.import_service.parse_library", _mock_parse),
            patch("app.import_service.validate", _mock_validate),
            patch("app.import_service.write_to_supabase_full", tracking_write),
        ):
            resp = client.post(
                "/api/rekordbox/import",
                headers=_auth(legit_user),
                files=_db_file(),
                data={"user_id": evil_user},  # attempted injection
            )

        assert resp.status_code == 200
        assert captured == [legit_user], (
            f"Expected write called with token user {legit_user!r}, "
            f"but got {captured!r}"
        )


# ── Successful import response shape ──────────────────────────────────────────

class TestSuccessResponse:
    def test_response_shape(self):
        with (
            patch("app.import_service.parse_library", _mock_parse),
            patch("app.import_service.validate", _mock_validate),
            patch("app.import_service.write_to_supabase_full", _mock_write),
        ):
            resp = client.post(
                "/api/rekordbox/import",
                headers=_auth(),
                files=_db_file(),
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["import_id"] == "import-uuid-1234"
        assert body["status"] == "completed"
        assert body["source_filename"] == "exportLibrary.db"
        assert body["track_count"] == 1
        assert body["playlist_count"] == 1
        assert body["playlist_track_count"] == 1
        assert isinstance(body["playlists"], list)
        assert body["playlists"][0]["name"] == "My Playlist"
        assert body["playlists"][0]["track_count"] == 1
        # _FakeLibrary has no analysis paths, so status should be not_requested
        assert body["analysis_status"] == "not_requested"
        assert body["analysis_expected_track_count"] == 0

    def test_no_internal_details_on_write_failure(self):
        """Supabase errors must not leak in the response body."""
        def failing_write(*_args, **_kwargs):
            raise RuntimeError("Connection refused to secret-host.supabase.co")

        with (
            patch("app.import_service.parse_library", _mock_parse),
            patch("app.import_service.validate", _mock_validate),
            patch("app.import_service.write_to_supabase_full", failing_write),
        ):
            resp = client.post(
                "/api/rekordbox/import",
                headers=_auth(),
                files=_db_file(),
            )

        assert resp.status_code == 500
        detail = resp.json()["detail"].lower()
        # Must not expose host names, connection details, or stack traces
        assert "secret-host" not in detail
        assert "traceback" not in detail
        assert "connection refused" not in detail


# ── Health check ──────────────────────────────────────────────────────────────

def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
