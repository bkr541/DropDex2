"""
Tests for the staged Rekordbox USB analysis import API.

All tests that touch Supabase, pyrekordbox, or Storage use mocks so they
run without real credentials or the pyrekordbox package installed.

To run:
    cd backend
    pytest tests/test_staged_import.py -v
"""

from __future__ import annotations

import io
import os
import zipfile
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.config import settings
from app.main import app

client = TestClient(app, raise_server_exceptions=False)

DB_BYTES = b"SQLite format 3\x00" + b"\x00" * 84
ANLZ_HEADER = b"PMAI" + b"\x00" * 100   # minimal fake ANLZ bytes


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_token(user_id: str = "user-aaaa-bbbb-cccc-dddd-eeeeeeeeeeee") -> str:
    return jwt.encode(
        {"sub": user_id, "aud": "authenticated", "role": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )


def _auth(user_id: str = "user-aaaa-bbbb-cccc-dddd-eeeeeeeeeeee") -> dict:
    return {"Authorization": f"Bearer {_make_token(user_id)}"}


def _db_file(name: str = "exportLibrary.db", content: bytes = DB_BYTES):
    return {"file": (name, content, "application/octet-stream")}


def _anlz_file(path: str, content: bytes = ANLZ_HEADER):
    return ("files", (path, content, "application/octet-stream"))


def _make_zip(
    entries: dict,  # name → bytes
    *,
    symlinks: list[str] | None = None,
) -> bytes:
    """Build a ZIP in memory. entries maps zip-entry-name to file bytes."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            if symlinks and name in symlinks:
                info = zipfile.ZipInfo(name)
                info.external_attr = 0xA1ED0000  # symlink bit
                zf.writestr(info, data)
            else:
                zf.writestr(name, data)
    return buf.getvalue()


class _FakeLibrary:
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
    def __init__(
        self,
        import_id: str = "import-uuid-start-test",
        manifest=None,
        rb_to_sb_track=None,
    ):
        self.import_id = import_id
        self.rb_to_sb_track = rb_to_sb_track or {}
        self.manifest = manifest or []
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


def _mock_write(_library, _url, _key, _user_id):
    return _MockWriteResult()


# ── Fake Supabase client ──────────────────────────────────────────────────────

class _FakeQuery:
    """Minimal query builder that chains arbitrarily and returns configured data.

    Supports .order() and .range() so that fetch_all_rows() pagination works
    correctly in tests with large synthetic datasets.
    """

    def __init__(self, data=None, *, _single: bool = False):
        self._data = data
        self._single = _single
        self._range_start: int | None = None
        self._range_end: int | None = None

    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def neq(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def ilike(self, *a, **k): return self
    def order(self, *a, **k): return self  # pagination: ignored, data already in order

    def range(self, start: int, end: int):
        """Return a new query whose execute() slices data[start:end+1]."""
        q = _FakeQuery(self._data, _single=self._single)
        q._range_start = start
        q._range_end = end
        return q

    @property
    def not_(self): return self

    def is_(self, *a, **k): return self

    def maybe_single(self):
        # Signal that execute() should return a single item, not a list.
        return _FakeQuery(self._data, _single=True)

    def update(self, *a, **k): return self
    def insert(self, *a, **k): return self

    def execute(self):
        if self._single:
            # Unwrap list to simulate PostgREST maybe_single behaviour.
            data = self._data[0] if isinstance(self._data, list) and self._data else (
                self._data if not isinstance(self._data, list) else None
            )
            # supabase-py ≥2.x returns None (not APIResponse(data=None)) when
            # maybe_single() finds 0 rows.  Reproduce that here so guard code is tested.
            if data is None:
                return None
            return SimpleNamespace(data=data)
        else:
            data = self._data
            if isinstance(data, list) and self._range_start is not None:
                data = data[self._range_start:self._range_end + 1]
            return SimpleNamespace(data=data if data is not None else [])


class _FakeStorage:
    def __init__(self, *, upload_ok: bool = True, download_data: bytes = ANLZ_HEADER):
        self._upload_ok = upload_ok
        self._download_data = download_data

    def from_(self, _bucket):
        return self

    def upload(self, *, path, file, file_options=None):
        if not self._upload_ok:
            raise RuntimeError("Simulated storage failure")

    def download(self, path):
        return self._download_data

    def list(self, path="", options=None):
        return []


class _FakeSb:
    """Configurable fake Supabase client."""

    def __init__(
        self,
        *,
        import_row=None,          # data returned for rekordbox_imports queries
        tracks=None,              # data returned for rekordbox_tracks queries
        assets=None,              # data returned for rekordbox_analysis_assets queries
        upload_ok: bool = True,
        download_data: bytes = ANLZ_HEADER,
    ):
        self._import_row = import_row
        self._tracks = tracks or []
        self._assets = assets or []
        self.storage = _FakeStorage(upload_ok=upload_ok, download_data=download_data)

    def table(self, name: str):
        if name == "rekordbox_imports":
            return _FakeQuery(self._import_row)
        if name == "rekordbox_tracks":
            return _FakeQuery(self._tracks)
        if name == "rekordbox_analysis_assets":
            return _FakeQuery(self._assets)
        return _FakeQuery(None)


# ── /start endpoint ────────────────────────────────────────────────────────────

class TestStartEndpoint:
    def test_missing_auth_rejected(self):
        resp = client.post("/api/rekordbox/import/start", files=_db_file())
        assert resp.status_code == 422

    def test_invalid_token_rejected(self):
        resp = client.post(
            "/api/rekordbox/import/start",
            headers={"Authorization": "Bearer not.a.token"},
            files=_db_file(),
        )
        assert resp.status_code == 401

    def test_non_db_file_rejected(self):
        resp = client.post(
            "/api/rekordbox/import/start",
            headers=_auth(),
            files={"file": ("tracks.xml", b"<xml/>", "text/xml")},
        )
        assert resp.status_code == 422
        assert ".db" in resp.json()["detail"].lower()

    def test_manifest_response_shape(self):
        """A valid upload returns import_id, analysis_status, and manifest list."""
        with (
            patch("app.analysis_import_service.parse_library", _mock_parse),
            patch("app.analysis_import_service.validate", _mock_validate),
            patch("app.analysis_import_service.write_to_supabase_full", _mock_write),
            patch("app.analysis_import_service.upsert_active_import"),
        ):
            resp = client.post(
                "/api/rekordbox/import/start",
                headers=_auth(),
                files=_db_file(),
            )

        assert resp.status_code == 200
        body = resp.json()
        assert "import_id" in body
        assert "analysis_status" in body
        assert "expected_track_count" in body
        assert isinstance(body["manifest"], list)
        assert body["analysis_status"] == "not_requested"  # FakeLibrary has no manifest

    def test_start_temp_file_cleanup(self, monkeypatch):
        """Temp file is always removed even when parse succeeds."""
        created: list[str] = []
        import tempfile as _tmpmod

        _real_ntf = _tmpmod.NamedTemporaryFile

        def capturing_ntf(**kwargs):
            obj = _real_ntf(**kwargs)
            created.append(obj.name)
            return obj

        monkeypatch.setattr("app.analysis_import_service.tempfile.NamedTemporaryFile", capturing_ntf)

        with (
            patch("app.analysis_import_service.parse_library", _mock_parse),
            patch("app.analysis_import_service.validate", _mock_validate),
            patch("app.analysis_import_service.write_to_supabase_full", _mock_write),
            patch("app.analysis_import_service.upsert_active_import"),
        ):
            client.post(
                "/api/rekordbox/import/start",
                headers=_auth(),
                files=_db_file(),
            )

        assert created, "Expected at least one temp file"
        for path in created:
            assert not os.path.exists(path), f"Temp file not cleaned up: {path}"

    def test_oversized_db_rejected(self, monkeypatch):
        monkeypatch.setattr(settings, "max_rekordbox_db_upload_bytes", 10)
        resp = client.post(
            "/api/rekordbox/import/start",
            headers=_auth(),
            files=_db_file(content=b"x" * 11),
        )
        assert resp.status_code == 413
        assert "MB" in resp.json()["detail"] or "size" in resp.json()["detail"].lower()

    def test_write_failure_safe_error(self):
        """Supabase write errors must not leak internal host names or stack traces."""
        def failing_write(*_):
            raise RuntimeError("Connection refused to secret-host.internal.supabase.co")

        with (
            patch("app.analysis_import_service.parse_library", _mock_parse),
            patch("app.analysis_import_service.validate", _mock_validate),
            patch("app.analysis_import_service.write_to_supabase_full", failing_write),
        ):
            resp = client.post(
                "/api/rekordbox/import/start",
                headers=_auth(),
                files=_db_file(),
            )

        assert resp.status_code == 500
        body_text = resp.text.lower()
        assert "secret-host" not in body_text
        assert "traceback" not in body_text
        assert "connection refused" not in body_text

    def test_manifest_paths_have_no_leading_slash(self):
        """Manifest dat_path/ext_path/two_ex_path must not start with '/'.

        Regression: parser.normalize_analysis_path() added a leading slash
        (e.g. '/PIONEER/USBANLZ/P001/ANLZ0000.DAT') that caused
        buildMatchedFiles() in the frontend to find zero path-map matches,
        skipping Stage 2 entirely and reporting all tracks as missing.
        """
        class _ManifestEntry:
            rekordbox_content_id = "100"
            # Rekordbox stores paths with a leading slash on some devices
            original_analysis_path = "/PIONEER/USBANLZ/P001/ANLZ0000.DAT"

        write_result = _MockWriteResult(
            manifest=[_ManifestEntry()],
            rb_to_sb_track={"100": "track-uuid-manifest-test"},
        )

        def _write_with_manifest(*_args, **_kwargs):
            return write_result

        with (
            patch("app.analysis_import_service.parse_library", _mock_parse),
            patch("app.analysis_import_service.validate", _mock_validate),
            patch("app.analysis_import_service.write_to_supabase_full", _write_with_manifest),
            patch("app.analysis_import_service.upsert_active_import"),
        ):
            resp = client.post(
                "/api/rekordbox/import/start",
                headers=_auth(),
                files=_db_file(),
            )

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["manifest"]) == 1
        entry = body["manifest"][0]
        for field in ("dat_path", "ext_path", "two_ex_path"):
            val = entry.get(field)
            if val is not None:
                assert not val.startswith("/"), (
                    f"manifest.{field} must not have a leading slash, got: {val!r}"
                )
        assert entry["dat_path"] == "PIONEER/USBANLZ/P001/ANLZ0000.DAT"


# ── /analysis-batch endpoint ──────────────────────────────────────────────────

IMPORT_ID = "import-aaaa-0000-1111-2222-333333333333"
USER_ID = "user-aaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

_IMPORT_ROW = {
    "id": IMPORT_ID,
    "analysis_status": "awaiting_upload",
    "analysis_expected_track_count": 1,
    "analysis_matched_track_count": 0,
    "analysis_parsed_track_count": 0,
    "analysis_failed_track_count": 0,
    "analysis_asset_count": 0,
    "analysis_parser_version": None,
    "analysis_warnings": [],
}

_TRACKS = [{
    "id": "track-uuid-1111",
    "rekordbox_content_id": "100",
    "analysis_data_file_path": "PIONEER/USBANLZ/P001/ANLZ0000.DAT",
}]


def _fake_sb_for_batch(*, import_found: bool = True, existing_asset=None, upload_ok: bool = True):
    return _FakeSb(
        import_row=_IMPORT_ROW if import_found else None,
        tracks=_TRACKS if import_found else [],
        assets=[existing_asset] if existing_asset else [],
        upload_ok=upload_ok,
    )


class TestAnalysisBatch:
    def test_missing_auth_rejected(self):
        resp = client.post(
            f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
            files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT")],
        )
        assert resp.status_code == 422

    def test_unknown_import_id_returns_404(self):
        fake_sb = _fake_sb_for_batch(import_found=False)
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT")],
            )
        assert resp.status_code == 404

    def test_ownership_rejection_returns_404(self):
        """A user cannot batch-upload to another user's import."""
        other_user = "other-user-1111-2222-3333-444444444444"
        fake_sb = _fake_sb_for_batch(import_found=False)  # DB returns nothing for other user
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(other_user),
                files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT")],
            )
        assert resp.status_code == 404

    def test_traversal_path_rejected(self):
        """Paths containing '..' must be rejected without touching storage."""
        fake_sb = _fake_sb_for_batch()
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[_anlz_file("../../../etc/passwd")],
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["rejected_count"] == 1
        result = body["files"][0]
        assert result["status"] == "rejected"
        assert "passwd" not in result.get("reject_reason", "").lower()  # no path leak

    def test_path_not_in_manifest_rejected(self):
        """A file with a path not matching any track in the import is rejected."""
        fake_sb = _fake_sb_for_batch()
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[_anlz_file("PIONEER/USBANLZ/P999/ANLZ9999.DAT")],
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["rejected_count"] == 1
        assert body["files"][0]["status"] == "rejected"

    def test_non_anlz_extension_rejected(self):
        fake_sb = _fake_sb_for_batch()
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.mp3")],
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["rejected_count"] == 1
        assert body["files"][0]["status"] == "rejected"

    def test_oversized_file_rejected(self, monkeypatch):
        monkeypatch.setattr(settings, "max_analysis_file_bytes", 5)
        fake_sb = _fake_sb_for_batch()
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT", content=b"x" * 6)],
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["rejected_count"] == 1
        result = body["files"][0]
        assert result["status"] == "rejected"
        assert "MB" in result["reject_reason"] or "size" in result["reject_reason"].lower()

    def test_oversized_batch_rejected(self, monkeypatch):
        monkeypatch.setattr(settings, "max_analysis_batch_bytes", 50)
        monkeypatch.setattr(settings, "max_analysis_file_bytes", 1_000_000)
        fake_sb = _fake_sb_for_batch()
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[
                    _anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT", content=b"x" * 40),
                    _anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.EXT", content=b"x" * 40),
                ],
            )
        assert resp.status_code == 200
        body = resp.json()
        # The second file pushes total over limit
        second = body["files"][1]
        assert second["status"] == "rejected"
        assert "batch" in second["reject_reason"].lower()

    def test_file_count_limit_enforced(self, monkeypatch):
        monkeypatch.setattr(settings, "max_analysis_files_per_batch", 1)
        fake_sb = _fake_sb_for_batch()
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[
                    _anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT"),
                    _anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.EXT"),
                ],
            )
        assert resp.status_code == 413
        assert "too many files" in resp.json()["detail"].lower()

    def test_valid_file_received(self):
        fake_sb = _fake_sb_for_batch()
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT")],
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["import_id"] == IMPORT_ID
        assert body["received_count"] == 1
        assert body["rejected_count"] == 0
        result = body["files"][0]
        assert result["status"] == "received"
        assert result["sha256"] is not None

    def test_first_upload_no_existing_asset_does_not_crash(self):
        """Regression: supabase-py ≥2.x returns None (not APIResponse(data=None))
        from maybe_single().execute() when 0 rows match.  _get_existing_asset must
        not crash with AttributeError when processing the very first file.
        """
        fake_sb = _fake_sb_for_batch(existing_asset=None)  # assets table is empty
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT")],
            )
        assert resp.status_code == 200, f"Got 500 — maybe_single None guard missing: {resp.text}"
        assert resp.json()["received_count"] == 1

    def test_duplicate_sha_returns_already_received(self):
        """Re-uploading the same file (same SHA) returns already_received."""
        content = b"PMAI" + b"\x00" * 50
        sha256 = __import__("hashlib").sha256(content).hexdigest()
        existing_asset = {
            "id": "asset-uuid-0001",
            "sha256": sha256,
            "upload_status": "uploaded",
        }
        fake_sb = _fake_sb_for_batch(existing_asset=existing_asset)
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT", content=content)],
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["already_received_count"] == 1
        assert body["files"][0]["status"] == "already_received"
        assert body["files"][0]["sha256"] == sha256

    def test_storage_failure_returns_error_status(self):
        fake_sb = _fake_sb_for_batch(upload_ok=False)
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT")],
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["files"][0]["status"] == "error"
        # Error reason must not expose internal storage details
        reason = body["files"][0].get("reject_reason", "")
        assert "simulated" not in reason.lower()
        assert "storage" not in reason.lower() or "try again" in reason.lower()


# ── /complete endpoint ────────────────────────────────────────────────────────

class _FakeParsedAsset:
    def __init__(self, parse_status="completed"):
        self.parse_status = parse_status
        self.sha256 = "abc123"
        self.warnings = []


class _FakeBundle:
    def __init__(self, dat_status="completed", overall="completed"):
        self.dat = _FakeParsedAsset(dat_status)
        self.ext = None
        self.two_ex = None
        self.overall_status = overall
        self.warnings = []


class TestCompleteEndpoint:
    def test_missing_auth_rejected(self):
        resp = client.post(f"/api/rekordbox/import/{IMPORT_ID}/complete")
        assert resp.status_code == 422

    def test_unknown_import_returns_404(self):
        fake_sb = _FakeSb(import_row=None)
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/complete",
                headers=_auth(USER_ID),
            )
        assert resp.status_code == 404

    def test_missing_required_dat_counted(self):
        """Tracks without an uploaded DAT are counted as missing_required."""
        dat_asset = {
            "id": "asset-dat-001",
            "track_id": "track-uuid-1111",
            "asset_type": "DAT",
            "relative_path": "pioneer/usbanlz/p001/anlz0000.dat",
            "storage_path": "user-id/import-id/anlz/PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            "sha256": "aabbcc",
        }
        # No assets uploaded → DAT is missing
        fake_sb = _FakeSb(
            import_row=_IMPORT_ROW,
            tracks=_TRACKS,
            assets=[],  # nothing uploaded yet
        )

        def fake_bundle(*a, **k):
            return _FakeBundle()

        with (
            patch("app.analysis_import_service._create_supabase", return_value=fake_sb),
            patch("app.analysis_import_service._parse_bundle", fake_bundle),
        ):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/complete",
                headers=_auth(USER_ID),
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["missing_required_count"] == 1
        assert body["tracks"][0]["parse_status"] == "missing_required"

    def test_all_assets_present_completed(self):
        """When DAT is present and parses successfully, status is completed."""
        uploaded = [{
            "id": "asset-dat-001",
            "track_id": "track-uuid-1111",
            "asset_type": "DAT",
            "relative_path": "pioneer/usbanlz/p001/anlz0000.dat",
            "storage_path": "u/i/anlz/PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            "sha256": "aabbcc",
        }]
        fake_sb = _FakeSb(import_row=_IMPORT_ROW, tracks=_TRACKS, assets=uploaded)

        def fake_bundle(*a, **k):
            return _FakeBundle(dat_status="completed", overall="completed")

        with (
            patch("app.analysis_import_service._create_supabase", return_value=fake_sb),
            patch("app.analysis_import_service._parse_bundle", fake_bundle),
        ):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/complete",
                headers=_auth(USER_ID),
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["completed_count"] == 1
        assert body["analysis_status"] == "completed"
        assert body["tracks"][0]["parse_status"] == "completed"
        assert "parser_version" in body

    def test_partial_bundle_status_propagated(self):
        """A partial parse result is reflected in the response."""
        uploaded = [{
            "id": "asset-dat-002",
            "track_id": "track-uuid-1111",
            "asset_type": "DAT",
            "relative_path": "pioneer/usbanlz/p001/anlz0000.dat",
            "storage_path": "u/i/anlz/PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            "sha256": "aabbcc",
        }]
        fake_sb = _FakeSb(import_row=_IMPORT_ROW, tracks=_TRACKS, assets=uploaded)

        def fake_partial_bundle(*a, **k):
            return _FakeBundle(dat_status="partial", overall="partial")

        with (
            patch("app.analysis_import_service._create_supabase", return_value=fake_sb),
            patch("app.analysis_import_service._parse_bundle", fake_partial_bundle),
        ):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/complete",
                headers=_auth(USER_ID),
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["partial_count"] == 1
        assert body["analysis_status"] == "partial"

    def test_temp_dir_cleaned_up(self):
        """Temp directory is removed after parsing, even on success."""
        uploaded = [{
            "id": "asset-dat-003",
            "track_id": "track-uuid-1111",
            "asset_type": "DAT",
            "relative_path": "pioneer/usbanlz/p001/anlz0000.dat",
            "storage_path": "u/i/anlz/PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            "sha256": "aabbcc",
        }]
        fake_sb = _FakeSb(import_row=_IMPORT_ROW, tracks=_TRACKS, assets=uploaded)
        created_dirs: list[str] = []

        import tempfile as _tmpmod
        _real_mkdtemp = _tmpmod.mkdtemp

        def capturing_mkdtemp(*a, **k):
            path = _real_mkdtemp(*a, **k)
            created_dirs.append(path)
            return path

        def fake_bundle(*a, **k):
            return _FakeBundle()

        with (
            patch("app.analysis_import_service._create_supabase", return_value=fake_sb),
            patch("app.analysis_import_service._parse_bundle", fake_bundle),
            patch("app.analysis_import_service.tempfile.mkdtemp", capturing_mkdtemp),
        ):
            client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/complete",
                headers=_auth(USER_ID),
            )

        assert created_dirs, "Expected mkdtemp to be called"
        for d in created_dirs:
            assert not os.path.exists(d), f"Temp dir not cleaned up: {d}"


# ── /analysis-status endpoint ─────────────────────────────────────────────────

class TestAnalysisStatus:
    def test_missing_auth_rejected(self):
        resp = client.get(f"/api/rekordbox/import/{IMPORT_ID}/analysis-status")
        assert resp.status_code == 422

    def test_unknown_import_returns_404(self):
        fake_sb = _FakeSb(import_row=None)
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.get(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-status",
                headers=_auth(USER_ID),
            )
        assert resp.status_code == 404

    def test_status_response_shape(self):
        fake_sb = _FakeSb(import_row=_IMPORT_ROW, tracks=[], assets=[])
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.get(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-status",
                headers=_auth(USER_ID),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["import_id"] == IMPORT_ID
        assert "analysis_status" in body
        assert "expected_track_count" in body
        assert "missing_required_paths" in body
        assert isinstance(body["missing_required_paths"], list)

    def test_missing_dat_appears_in_missing_paths(self):
        fake_sb = _FakeSb(import_row=_IMPORT_ROW, tracks=_TRACKS, assets=[])
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.get(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-status",
                headers=_auth(USER_ID),
            )
        assert resp.status_code == 200
        body = resp.json()
        missing = body["missing_required_paths"]
        assert len(missing) == 1
        assert missing[0].upper().endswith(".DAT")


# ── /bundle endpoint ──────────────────────────────────────────────────────────

class TestBundleEndpoint:
    def test_missing_auth_rejected(self):
        data = _make_zip({"exportLibrary.db": DB_BYTES})
        resp = client.post(
            "/api/rekordbox/import/bundle",
            files={"file": ("bundle.zip", data, "application/zip")},
        )
        assert resp.status_code == 422

    def test_zip_slip_rejected(self):
        data = _make_zip({
            "exportLibrary.db": DB_BYTES,
            "../../../etc/passwd": b"evil",
        })
        resp = client.post(
            "/api/rekordbox/import/bundle",
            headers=_auth(),
            files={"file": ("bundle.zip", data, "application/zip")},
        )
        assert resp.status_code == 422
        assert "unsafe" in resp.json()["detail"].lower() or "path" in resp.json()["detail"].lower()

    def test_no_exportlibrary_db_rejected(self):
        data = _make_zip({
            "PIONEER/USBANLZ/P001/ANLZ0000.DAT": ANLZ_HEADER,
        })
        resp = client.post(
            "/api/rekordbox/import/bundle",
            headers=_auth(),
            files={"file": ("bundle.zip", data, "application/zip")},
        )
        assert resp.status_code == 422
        assert "exportlibrary.db" in resp.json()["detail"].lower()

    def test_not_a_zip_rejected(self):
        resp = client.post(
            "/api/rekordbox/import/bundle",
            headers=_auth(),
            files={"file": ("bundle.zip", b"this is not a zip", "application/zip")},
        )
        assert resp.status_code == 422
        assert "zip" in resp.json()["detail"].lower()

    def test_symlink_entry_rejected(self):
        data = _make_zip(
            {
                "exportLibrary.db": DB_BYTES,
                "malicious_link": b"target",
            },
            symlinks=["malicious_link"],
        )
        resp = client.post(
            "/api/rekordbox/import/bundle",
            headers=_auth(),
            files={"file": ("bundle.zip", data, "application/zip")},
        )
        assert resp.status_code == 422
        assert "symlink" in resp.json()["detail"].lower()

    def test_oversized_bundle_rejected(self, monkeypatch):
        monkeypatch.setattr(settings, "max_bundle_upload_bytes", 10)
        data = _make_zip({"exportLibrary.db": DB_BYTES})
        resp = client.post(
            "/api/rekordbox/import/bundle",
            headers=_auth(),
            files={"file": ("bundle.zip", data, "application/zip")},
        )
        assert resp.status_code == 413
        assert "MB" in resp.json()["detail"] or "size" in resp.json()["detail"].lower()

    def test_audio_files_ignored(self):
        """ZIP containing audio files succeeds as long as exportLibrary.db is present."""
        data = _make_zip({
            "exportLibrary.db": DB_BYTES,
            "tracks/my_track.mp3": b"\xff\xfb" * 50,   # fake mp3 bytes
            "tracks/other.flac": b"fLaC" * 20,
        })
        with (
            patch("app.bundle_import_service.parse_library", _mock_parse),
            patch("app.bundle_import_service.validate", _mock_validate),
            patch("app.bundle_import_service.write_to_supabase_full", _mock_write),
            patch("app.bundle_import_service.upsert_active_import"),
        ):
            resp = client.post(
                "/api/rekordbox/import/bundle",
                headers=_auth(),
                files={"file": ("bundle.zip", data, "application/zip")},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "import_id" in body

    def test_bundle_temp_files_cleaned_up_on_parse_error(self):
        """Temp dir and DB file are removed even when parsing fails."""
        created_tmps: list[str] = []
        created_dirs: list[str] = []

        import tempfile as _tmpmod
        _real_ntf = _tmpmod.NamedTemporaryFile
        _real_mkdtemp = _tmpmod.mkdtemp

        def cap_ntf(**kwargs):
            obj = _real_ntf(**kwargs)
            created_tmps.append(obj.name)
            return obj

        def cap_mkdtemp(*a, **k):
            d = _real_mkdtemp(*a, **k)
            created_dirs.append(d)
            return d

        def crashing_parse(_path):
            raise RuntimeError("Simulated parse crash")

        data = _make_zip({"exportLibrary.db": DB_BYTES})

        with (
            patch("app.bundle_import_service.tempfile.NamedTemporaryFile", cap_ntf),
            patch("app.bundle_import_service.tempfile.mkdtemp", cap_mkdtemp),
            patch("app.bundle_import_service.parse_library", crashing_parse),
        ):
            resp = client.post(
                "/api/rekordbox/import/bundle",
                headers=_auth(),
                files={"file": ("bundle.zip", data, "application/zip")},
            )

        assert resp.status_code in (422, 500)
        for path in created_tmps:
            assert not os.path.exists(path), f"Temp file not cleaned up: {path}"
        for d in created_dirs:
            assert not os.path.exists(d), f"Temp dir not cleaned up: {d}"

    def test_bundle_write_failure_safe_error(self):
        """Supabase write errors in bundle flow must not expose internals."""
        def failing_write(*_):
            raise RuntimeError("Connection refused to secret-host.internal")

        data = _make_zip({"exportLibrary.db": DB_BYTES})
        with (
            patch("app.bundle_import_service.parse_library", _mock_parse),
            patch("app.bundle_import_service.validate", _mock_validate),
            patch("app.bundle_import_service.write_to_supabase_full", failing_write),
        ):
            resp = client.post(
                "/api/rekordbox/import/bundle",
                headers=_auth(),
                files={"file": ("bundle.zip", data, "application/zip")},
            )

        assert resp.status_code == 500
        detail = resp.json()["detail"].lower()
        assert "secret-host" not in detail
        assert "connection refused" not in detail


# ── Recording fake Supabase for lifecycle / counter assertions ─────────────────

class _RecordingQuery:
    """FakeQuery variant that records all .update() payloads in a shared list.

    .order() and .range() are stubs that return self without slicing — recording
    tests only use small datasets where one page covers everything.
    """

    def __init__(self, data=None, *, record_list=None, _single=False):
        self._data = data
        self._record_list = record_list if record_list is not None else []
        self._single = _single
        self._pending_update = None

    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def neq(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def order(self, *a, **k): return self
    def range(self, *a, **k): return self  # single-page stub; recording tests have tiny datasets
    def maybe_single(self): return _RecordingQuery(self._data, record_list=self._record_list, _single=True)

    def update(self, payload, **k):
        self._pending_update = payload
        return self

    def insert(self, *a, **k):
        return self

    def execute(self):
        if self._pending_update is not None:
            self._record_list.append(self._pending_update)
            self._pending_update = None
        if self._single:
            data = self._data[0] if isinstance(self._data, list) and self._data else (
                self._data if not isinstance(self._data, list) else None
            )
        else:
            data = self._data
        return SimpleNamespace(data=data if data is not None else [])


class _RecordingSb:
    """FakeSb that records table update payloads per table name."""

    def __init__(self, *, import_row=None, tracks=None, assets=None, upload_ok=True, download_data=ANLZ_HEADER):
        self._import_row = import_row
        self._tracks = tracks or []
        self._assets = assets or []
        self.storage = _FakeStorage(upload_ok=upload_ok, download_data=download_data)
        self.updates: dict[str, list] = {"rekordbox_imports": [], "rekordbox_analysis_assets": [], "rekordbox_tracks": []}

    def table(self, name: str):
        record_list = self.updates.get(name, [])
        if name == "rekordbox_imports":
            return _RecordingQuery(self._import_row, record_list=record_list)
        if name == "rekordbox_tracks":
            return _RecordingQuery(self._tracks, record_list=record_list)
        if name == "rekordbox_analysis_assets":
            return _RecordingQuery(self._assets, record_list=record_list)
        return _RecordingQuery(None, record_list=[])


# ── New feature tests ─────────────────────────────────────────────────────────

class TestNewBatchResponseFields:
    """BatchUploadResponse now includes error_count and received_bytes."""

    def test_response_includes_error_count(self):
        """error_count appears in a successful batch response."""
        fake_sb = _fake_sb_for_batch()
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT")],
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "error_count" in body
        assert body["error_count"] == 0

    def test_response_includes_received_bytes(self):
        """received_bytes is positive when files are accepted."""
        content = b"PMAI" + b"\x00" * 60
        fake_sb = _fake_sb_for_batch()
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT", content=content)],
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "received_bytes" in body
        assert body["received_bytes"] == len(content)

    def test_storage_failure_increments_error_count(self):
        fake_sb = _fake_sb_for_batch(upload_ok=False)
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT")],
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["error_count"] == 1
        assert body["received_bytes"] == 0


class TestNewStatusResponseFields:
    """AnalysisStatusResponse now includes missing_optional_ext and missing_optional_2ex."""

    def test_missing_optional_ext_present_in_status(self):
        """missing_optional_ext is returned when the EXT file was not uploaded."""
        fake_sb = _FakeSb(import_row=_IMPORT_ROW, tracks=_TRACKS, assets=[])
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.get(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-status",
                headers=_auth(USER_ID),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "missing_optional_ext" in body
        assert isinstance(body["missing_optional_ext"], list)
        assert len(body["missing_optional_ext"]) == 1
        assert body["missing_optional_ext"][0].upper().endswith(".EXT")

    def test_missing_optional_2ex_present_in_status(self):
        """missing_optional_2ex is returned when the 2EX file was not uploaded."""
        fake_sb = _FakeSb(import_row=_IMPORT_ROW, tracks=_TRACKS, assets=[])
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.get(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-status",
                headers=_auth(USER_ID),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "missing_optional_2ex" in body
        assert isinstance(body["missing_optional_2ex"], list)
        assert len(body["missing_optional_2ex"]) == 1
        assert body["missing_optional_2ex"][0].upper().endswith(".2EX")

    def test_no_missing_optional_when_all_uploaded(self):
        """When DAT, EXT, and 2EX are all uploaded, optional lists are empty."""
        all_assets = [
            {"id": "a1", "track_id": "track-uuid-1111", "asset_type": "DAT",
             "relative_path": "pioneer/usbanlz/p001/anlz0000.dat", "upload_status": "uploaded"},
            {"id": "a2", "track_id": "track-uuid-1111", "asset_type": "EXT",
             "relative_path": "pioneer/usbanlz/p001/anlz0000.ext", "upload_status": "uploaded"},
            {"id": "a3", "track_id": "track-uuid-1111", "asset_type": "2EX",
             "relative_path": "pioneer/usbanlz/p001/anlz0000.2ex", "upload_status": "uploaded"},
        ]
        fake_sb = _FakeSb(import_row=_IMPORT_ROW, tracks=_TRACKS, assets=all_assets)
        with patch("app.analysis_import_service._create_supabase", return_value=fake_sb):
            resp = client.get(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-status",
                headers=_auth(USER_ID),
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["missing_optional_ext"] == []
        assert body["missing_optional_2ex"] == []


class TestNewCompleteResponseFields:
    """CompleteResponse now includes missing_optional_ext_count and missing_optional_2ex_count."""

    def _uploaded_dat(self):
        return [{
            "id": "asset-dat-001",
            "track_id": "track-uuid-1111",
            "asset_type": "DAT",
            "relative_path": "pioneer/usbanlz/p001/anlz0000.dat",
            "storage_path": "u/i/anlz/PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            "sha256": "aabbcc",
        }]

    def test_complete_includes_missing_optional_ext_count(self):
        fake_sb = _FakeSb(import_row=_IMPORT_ROW, tracks=_TRACKS, assets=self._uploaded_dat())

        def fake_bundle(*a, **k):
            return _FakeBundle(dat_status="completed", overall="completed")

        with (
            patch("app.analysis_import_service._create_supabase", return_value=fake_sb),
            patch("app.analysis_import_service._parse_bundle", fake_bundle),
        ):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/complete",
                headers=_auth(USER_ID),
            )

        assert resp.status_code == 200
        body = resp.json()
        assert "missing_optional_ext_count" in body
        assert "missing_optional_2ex_count" in body
        # EXT and 2EX were not uploaded, so they should be counted as missing
        assert body["missing_optional_ext_count"] == 1
        assert body["missing_optional_2ex_count"] == 1

    def test_partial_parse_status_propagated_not_masked(self):
        """Partial parse status must be returned as-is, not converted to completed."""
        uploaded = [{
            "id": "asset-dat-002",
            "track_id": "track-uuid-1111",
            "asset_type": "DAT",
            "relative_path": "pioneer/usbanlz/p001/anlz0000.dat",
            "storage_path": "u/i/anlz/PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            "sha256": "aabbcc",
        }]
        fake_sb = _FakeSb(import_row=_IMPORT_ROW, tracks=_TRACKS, assets=uploaded)

        def fake_partial(*a, **k):
            return _FakeBundle(dat_status="partial", overall="partial")

        with (
            patch("app.analysis_import_service._create_supabase", return_value=fake_sb),
            patch("app.analysis_import_service._parse_bundle", fake_partial),
        ):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/complete",
                headers=_auth(USER_ID),
            )

        assert resp.status_code == 200
        body = resp.json()
        # Status must be 'partial', never 'completed'
        assert body["analysis_status"] == "partial"
        assert body["partial_count"] == 1
        assert body["completed_count"] == 0
        track = body["tracks"][0]
        assert track["parse_status"] == "partial"


class TestLifecycleTransitions:
    """Verify import lifecycle state transitions happen in the expected order."""

    def test_batch_sets_analysis_status_to_uploading(self):
        """process_analysis_batch must transition analysis_status to 'uploading'."""
        rsb = _RecordingSb(
            import_row=_IMPORT_ROW,
            tracks=_TRACKS,
            assets=[],
        )
        with patch("app.analysis_import_service._create_supabase", return_value=rsb):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
                headers=_auth(USER_ID),
                files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT")],
            )

        assert resp.status_code == 200
        import_updates = rsb.updates["rekordbox_imports"]
        statuses = [u["analysis_status"] for u in import_updates if "analysis_status" in u]
        assert "uploading" in statuses, f"Expected 'uploading' in status transitions, got: {statuses}"

    def test_complete_sets_analysis_status_to_parsing(self):
        """complete_analysis_import must transition analysis_status to 'parsing' before completing."""
        uploaded = [{
            "id": "asset-dat-004",
            "track_id": "track-uuid-1111",
            "asset_type": "DAT",
            "relative_path": "pioneer/usbanlz/p001/anlz0000.dat",
            "storage_path": "u/i/anlz/PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            "sha256": "aabbcc",
        }]
        rsb = _RecordingSb(import_row=_IMPORT_ROW, tracks=_TRACKS, assets=uploaded)

        def fake_bundle(*a, **k):
            return _FakeBundle(dat_status="completed", overall="completed")

        with (
            patch("app.analysis_import_service._create_supabase", return_value=rsb),
            patch("app.analysis_import_service._parse_bundle", fake_bundle),
        ):
            resp = client.post(
                f"/api/rekordbox/import/{IMPORT_ID}/complete",
                headers=_auth(USER_ID),
            )

        assert resp.status_code == 200
        import_updates = rsb.updates["rekordbox_imports"]
        statuses = [u["analysis_status"] for u in import_updates if "analysis_status" in u]
        assert "parsing" in statuses, f"Expected 'parsing' in status transitions, got: {statuses}"
        # Final status must be 'completed' (appears after 'parsing')
        assert statuses[-1] == "completed"


class TestSourceBundleType:
    """Each workflow must persist the correct source_bundle_type."""

    def test_usb_folder_sets_source_bundle_type(self):
        """start_analysis_import sets source_bundle_type='usb_folder'."""
        rsb = _RecordingSb(import_row=_IMPORT_ROW)

        def write_with_import(*_):
            return _MockWriteResult(import_id=IMPORT_ID)

        with (
            patch("app.analysis_import_service.parse_library", _mock_parse),
            patch("app.analysis_import_service.validate", _mock_validate),
            patch("app.analysis_import_service.write_to_supabase_full", write_with_import),
            patch("app.analysis_import_service.upsert_active_import"),
            patch("app.analysis_import_service._create_supabase", return_value=rsb),
        ):
            resp = client.post(
                "/api/rekordbox/import/start",
                headers=_auth(USER_ID),
                files=_db_file(),
            )

        assert resp.status_code == 200
        import_updates = rsb.updates["rekordbox_imports"]
        bundle_types = [u.get("source_bundle_type") for u in import_updates if "source_bundle_type" in u]
        assert "usb_folder" in bundle_types, f"Expected 'usb_folder' to be set, got: {bundle_types}"

    def test_bundle_import_sets_source_bundle_type_zip(self):
        """import_bundle sets source_bundle_type='zip_bundle'."""
        rsb = _RecordingSb(import_row=_IMPORT_ROW)

        def write_with_import(*_):
            return _MockWriteResult(import_id=IMPORT_ID)

        data = _make_zip({"exportLibrary.db": DB_BYTES})

        with (
            patch("app.bundle_import_service.parse_library", _mock_parse),
            patch("app.bundle_import_service.validate", _mock_validate),
            patch("app.bundle_import_service.write_to_supabase_full", write_with_import),
            patch("app.bundle_import_service.upsert_active_import"),
            patch("app.bundle_import_service._create_supabase", return_value=rsb),
        ):
            resp = client.post(
                "/api/rekordbox/import/bundle",
                headers=_auth(USER_ID),
                files={"file": ("bundle.zip", data, "application/zip")},
            )

        assert resp.status_code == 200
        import_updates = rsb.updates["rekordbox_imports"]
        bundle_types = [u.get("source_bundle_type") for u in import_updates if "source_bundle_type" in u]
        assert "zip_bundle" in bundle_types, f"Expected 'zip_bundle' to be set, got: {bundle_types}"


# ── Structured write errors ───────────────────────────────────────────────────

class TestStructuredWriteErrors:
    """Verify that write failures return structured diagnostic info — not secrets."""

    def _post_start(self, failing_write):
        with (
            patch("app.analysis_import_service.parse_library", _mock_parse),
            patch("app.analysis_import_service.validate", _mock_validate),
            patch("app.analysis_import_service.write_to_supabase_full", failing_write),
        ):
            return client.post(
                "/api/rekordbox/import/start",
                headers=_auth(),
                files=_db_file(),
            )

    def test_rekordbox_write_error_returns_500_with_stage(self):
        """RekordboxWriteError should yield a 500 with error_code and stage."""
        from dropdex_importer.supabase_writer import RekordboxWriteError

        def failing_write(*_):
            raise RekordboxWriteError(
                stage="insert_tracks",
                table="rekordbox_tracks",
                operation="batch_insert",
                original_error=Exception("22P02"),
                import_id="test-import-id",
            )

        resp = self._post_start(failing_write)
        assert resp.status_code == 500
        detail = resp.json()["detail"]
        assert isinstance(detail, dict), f"Expected dict detail, got: {detail!r}"
        assert detail["error_code"] == "REKORDBOX_IMPORT_WRITE_FAILED"
        assert detail["stage"] == "insert_tracks"
        assert detail["table"] == "rekordbox_tracks"

    def test_bigint_error_code_22p02_returns_helpful_detail(self):
        """Error 22P02 (invalid syntax for bigint) yields a user-readable message."""
        from dropdex_importer.supabase_writer import RekordboxWriteError

        pg_exc = Exception({"code": "22P02", "message": "invalid input syntax for type bigint: \"\"", "hint": None, "details": None})

        def failing_write(*_):
            raise RekordboxWriteError(
                stage="insert_tracks",
                table="rekordbox_tracks",
                operation="batch_insert",
                original_error=pg_exc,
            )

        resp = self._post_start(failing_write)
        assert resp.status_code == 500
        detail = resp.json()["detail"]
        assert detail["error_code"] == "REKORDBOX_IMPORT_WRITE_FAILED"
        # Must not expose the raw postgres message
        assert "22P02" not in str(detail)
        # Must give a human-readable hint
        assert "detail" in detail
        assert len(detail["detail"]) > 20

    def test_structured_error_does_not_leak_credentials(self):
        """No credential-looking strings must appear in error responses."""
        from dropdex_importer.supabase_writer import RekordboxWriteError

        def failing_write(*_):
            raise RekordboxWriteError(
                stage="insert_cues",
                table="rekordbox_cues",
                operation="batch_insert",
                original_error=Exception("Connection refused to secret-db.supabase.co"),
            )

        resp = self._post_start(failing_write)
        body_text = resp.text
        assert "secret-db" not in body_text
        assert "traceback" not in body_text.lower()
        assert "Authorization" not in body_text
        assert "Bearer" not in body_text

    def test_generic_exception_still_returns_safe_error(self):
        """Non-RekordboxWriteError still returns a safe dict detail."""
        def failing_write(*_):
            raise RuntimeError("Unexpected internal error with sensitive:data")

        resp = self._post_start(failing_write)
        assert resp.status_code == 500
        detail = resp.json()["detail"]
        # Should be a dict with error_code
        assert isinstance(detail, dict)
        assert detail["error_code"] == "REKORDBOX_IMPORT_WRITE_FAILED"
        # Must not contain the raw exception message
        assert "sensitive:data" not in str(detail)

    def test_write_failure_does_not_leak_stage_for_generic_error(self):
        """Generic errors report stage=unknown to avoid info leak."""
        def failing_write(*_):
            raise RuntimeError("boom")

        resp = self._post_start(failing_write)
        detail = resp.json()["detail"]
        assert detail.get("stage") == "unknown"


# ── Parser coercion helpers ───────────────────────────────────────────────────

class TestParserCoercions:
    """Verify that empty-string bigint fields are coerced to None."""

    def test_int_or_none_with_empty_string(self):
        from dropdex_importer.parser import _int_or_none
        assert _int_or_none("") is None

    def test_int_or_none_with_none(self):
        from dropdex_importer.parser import _int_or_none
        assert _int_or_none(None) is None

    def test_int_or_none_with_valid_int(self):
        from dropdex_importer.parser import _int_or_none
        assert _int_or_none(7) == 7

    def test_int_or_none_with_numeric_string(self):
        from dropdex_importer.parser import _int_or_none
        assert _int_or_none("42") == 42

    def test_int_or_none_with_float(self):
        from dropdex_importer.parser import _int_or_none
        assert _int_or_none(3.9) == 3

    def test_id_str_or_none_with_empty_string(self):
        from dropdex_importer.parser import _id_str_or_none
        assert _id_str_or_none("") is None

    def test_id_str_or_none_with_none(self):
        from dropdex_importer.parser import _id_str_or_none
        assert _id_str_or_none(None) is None

    def test_id_str_or_none_with_integer(self):
        from dropdex_importer.parser import _id_str_or_none
        assert _id_str_or_none(12345) == "12345"

    def test_id_str_or_none_with_float_id(self):
        from dropdex_importer.parser import _id_str_or_none
        assert _id_str_or_none(12345.0) == "12345"
