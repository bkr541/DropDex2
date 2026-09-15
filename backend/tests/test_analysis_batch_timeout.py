"""
Tests for analysis-batch upstream timeout hardening.

Covers:
  - _create_supabase() uses finite client timeouts
  - process_analysis_batch() returns retryable 504 on upstream timeout
  - process_analysis_batch() returns 500 ANALYSIS_BATCH_FAILED for ordinary failures
  - process_analysis_batch() does not convert intentional HTTPExceptions

To run:
    cd backend
    pytest tests/test_analysis_batch_timeout.py -v
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt

from app.config import settings
from app.main import app

client = TestClient(app, raise_server_exceptions=False)

ANLZ_HEADER = b"PMAI" + b"\x00" * 100
USER_ID = "user-aaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
IMPORT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def _make_token(user_id: str = USER_ID) -> str:
    return jwt.encode(
        {"sub": user_id, "aud": "authenticated", "role": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )


def _auth(user_id: str = USER_ID) -> dict:
    return {"Authorization": f"Bearer {_make_token(user_id)}"}


def _anlz_file(path: str, content: bytes = ANLZ_HEADER):
    return ("files", (path, content, "application/octet-stream"))


# ── _create_supabase uses bounded options ─────────────────────────────────────

def test_create_supabase_passes_bounded_options_to_client():
    """_create_supabase() must use SyncClientOptions with finite timeouts."""
    from app import analysis_import_service as svc

    calls: list[dict] = []

    class FakeClient:
        pass

    def fake_create_client(url, key, options=None):
        calls.append({"url": url, "key": key, "options": options})
        return FakeClient()

    with patch("supabase.create_client", fake_create_client):
        svc._create_supabase()

    assert len(calls) == 1
    options = calls[0]["options"]
    assert options is not None, "_create_supabase() must pass SyncClientOptions"
    assert hasattr(options, "postgrest_client_timeout"), (
        "options must carry postgrest_client_timeout"
    )
    assert options.postgrest_client_timeout == settings.analysis_postgrest_timeout_seconds
    assert options.storage_client_timeout == settings.analysis_storage_timeout_seconds


def test_create_analysis_worker_supabase_passes_bounded_options_to_client():
    """_create_analysis_worker_supabase() must still use the same bounded options."""
    from app import analysis_import_service as svc

    calls: list[dict] = []

    def fake_create_client(url, key, options=None):
        calls.append({"options": options})
        return MagicMock()

    with patch("supabase.create_client", fake_create_client):
        svc._create_analysis_worker_supabase()

    options = calls[0]["options"]
    assert options is not None
    assert options.postgrest_client_timeout == settings.analysis_postgrest_timeout_seconds
    assert options.storage_client_timeout == settings.analysis_storage_timeout_seconds


# ── _is_upstream_timeout detection ───────────────────────────────────────────

def test_is_upstream_timeout_recognises_stdlib_timeout_error():
    from app.analysis_import_service import _is_upstream_timeout

    assert _is_upstream_timeout(TimeoutError("read timed out"))


def test_is_upstream_timeout_recognises_httpx_read_timeout():
    from app.analysis_import_service import _is_upstream_timeout

    class FakeReadTimeout(Exception):
        pass

    FakeReadTimeout.__name__ = "ReadTimeout"
    FakeReadTimeout.__module__ = "httpx"

    assert _is_upstream_timeout(FakeReadTimeout("timed out"))


def test_is_upstream_timeout_recognises_chained_timeout():
    from app.analysis_import_service import _is_upstream_timeout

    outer = RuntimeError("wrapped")
    outer.__cause__ = TimeoutError("inner timeout")

    assert _is_upstream_timeout(outer)


def test_is_upstream_timeout_returns_false_for_ordinary_error():
    from app.analysis_import_service import _is_upstream_timeout

    assert not _is_upstream_timeout(ValueError("bad value"))
    assert not _is_upstream_timeout(RuntimeError("unexpected"))


# ── process_analysis_batch timeout path ──────────────────────────────────────

def _fake_sb_for_batch(import_found: bool = True) -> MagicMock:
    """Minimal fake Supabase client for the batch upload path."""
    fake_sb = MagicMock()
    import_row = {
        "id": IMPORT_ID,
        "user_id": USER_ID,
        "status": "uploading",
        "analysis_status": "uploading",
        "optional_archival_file_count": 0,
    }
    execute_mock = MagicMock()
    execute_mock.data = [import_row] if import_found else []

    track_map_execute = MagicMock()
    track_map_execute.data = [
        {
            "track_id": "track-aaa",
            "rekordbox_content_id": "100",
            "dat_path": "PIONEER/USBANLZ/P001/ANLZ0000.DAT",
            "ext_path": None,
            "two_ex_path": None,
            "dat_required": True,
            "asset_type": "DAT",
        }
    ]
    assets_execute = MagicMock()
    assets_execute.data = []

    fake_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = execute_mock
    fake_sb.table.return_value.select.return_value.eq.return_value.execute.return_value = execute_mock
    fake_sb.table.return_value.upsert.return_value.execute.return_value = MagicMock(data=[])
    fake_sb.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
    return fake_sb


def test_process_analysis_batch_returns_504_on_upstream_timeout(monkeypatch, tmp_path):
    """A TimeoutError raised inside _process_analysis_batch_inner becomes a retryable 504."""
    monkeypatch.setattr(settings, "analysis_staging_root", str(tmp_path))

    with (
        patch("app.analysis_import_service._create_supabase", return_value=_fake_sb_for_batch()),
        patch(
            "app.analysis_import_service._prepare_analysis_batch",
            side_effect=TimeoutError("PostgREST timed out"),
        ),
    ):
        resp = client.post(
            f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
            headers=_auth(),
            files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT")],
        )

    assert resp.status_code == 504
    body = resp.json()
    detail = body["detail"]
    assert detail["error_code"] == "ANALYSIS_BATCH_UPSTREAM_TIMEOUT"
    assert detail["retryable"] is True
    assert "retry" in detail["detail"].lower()


def test_process_analysis_batch_returns_500_on_ordinary_failure(monkeypatch, tmp_path):
    """An unexpected non-timeout exception still becomes ANALYSIS_BATCH_FAILED (HTTP 500)."""
    monkeypatch.setattr(settings, "analysis_staging_root", str(tmp_path))

    with (
        patch("app.analysis_import_service._create_supabase", return_value=_fake_sb_for_batch()),
        patch(
            "app.analysis_import_service._prepare_analysis_batch",
            side_effect=RuntimeError("unexpected internal error"),
        ),
    ):
        resp = client.post(
            f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
            headers=_auth(),
            files=[_anlz_file("PIONEER/USBANLZ/P001/ANLZ0000.DAT")],
        )

    assert resp.status_code == 500
    body = resp.json()
    detail = body["detail"]
    assert detail["error_code"] == "ANALYSIS_BATCH_FAILED"
    assert detail["retryable"] is True


def test_process_analysis_batch_does_not_convert_intentional_http_exception(monkeypatch, tmp_path):
    """An HTTPException raised intentionally (e.g. 413 too large) is passed through unchanged."""
    monkeypatch.setattr(settings, "analysis_staging_root", str(tmp_path))

    too_many = settings.max_analysis_files_per_batch + 1
    files = [_anlz_file(f"PIONEER/USBANLZ/P001/ANLZ{i:04d}.DAT") for i in range(too_many)]

    with patch("app.analysis_import_service._create_supabase", return_value=_fake_sb_for_batch()):
        resp = client.post(
            f"/api/rekordbox/import/{IMPORT_ID}/analysis-batch",
            headers=_auth(),
            files=files,
        )

    assert resp.status_code == 413
