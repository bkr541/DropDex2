"""Tests for rekordbox_bridge.uploader."""
from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest
import httpx

from rekordbox_bridge.models import BridgePayload, SourceInfo
from rekordbox_bridge.uploader import get_token_from_env, upload_payload


SECRET_TOKEN = "super-secret-token-abc123"
API_URL = "https://api.dropdex.app"
IMPORT_ID = "import-456"


def _make_payload() -> BridgePayload:
    return BridgePayload(
        schema_version=1,
        generated_at="2026-06-16T00:00:00Z",
        source=SourceInfo(
            rekordbox_database_id=None,
            rekordbox_version=None,
            device_name=None,
        ),
        lists=[],
    )


class TestUploadPayload:
    def _mock_response(self, status_code: int, body: dict) -> MagicMock:
        resp = MagicMock()
        resp.status_code = status_code
        resp.is_success = 200 <= status_code < 300
        resp.json.return_value = body
        return resp

    def test_sends_correct_authorization_header(self):
        """upload_payload sends Bearer token in Authorization header."""
        payload = _make_payload()
        captured_headers: dict = {}

        def fake_post(url, content, headers, timeout):
            captured_headers.update(headers)
            return self._mock_response(200, {"ok": True})

        with patch("httpx.post", side_effect=fake_post):
            upload_payload(payload, API_URL, IMPORT_ID, SECRET_TOKEN)

        assert "Authorization" in captured_headers
        assert captured_headers["Authorization"] == f"Bearer {SECRET_TOKEN}"

    def test_sends_to_correct_url(self):
        """upload_payload posts to the correct endpoint URL."""
        payload = _make_payload()
        captured_url: list[str] = []

        def fake_post(url, content, headers, timeout):
            captured_url.append(url)
            return self._mock_response(200, {"ok": True})

        with patch("httpx.post", side_effect=fake_post):
            upload_payload(payload, API_URL, IMPORT_ID, SECRET_TOKEN)

        expected_url = f"{API_URL}/api/rekordbox/import/{IMPORT_ID}/related-tracks"
        assert captured_url[0] == expected_url

    def test_http_200_returns_parsed_json(self):
        """upload_payload returns the parsed JSON body on HTTP 200."""
        payload = _make_payload()
        expected_response = {"status": "imported", "count": 0}

        with patch("httpx.post", return_value=self._mock_response(200, expected_response)):
            result = upload_payload(payload, API_URL, IMPORT_ID, SECRET_TOKEN)

        assert result == expected_response

    def test_http_401_raises_runtime_error(self):
        """HTTP 401 raises RuntimeError."""
        payload = _make_payload()

        with patch("httpx.post", return_value=self._mock_response(401, {"error": "unauthorized"})):
            with pytest.raises(RuntimeError) as exc_info:
                upload_payload(payload, API_URL, IMPORT_ID, SECRET_TOKEN)

        assert "401" in str(exc_info.value)

    def test_http_500_raises_runtime_error(self):
        """HTTP 500 raises RuntimeError."""
        payload = _make_payload()

        with patch("httpx.post", return_value=self._mock_response(500, {})):
            with pytest.raises(RuntimeError) as exc_info:
                upload_payload(payload, API_URL, IMPORT_ID, SECRET_TOKEN)

        assert "500" in str(exc_info.value)

    def test_token_never_in_runtime_error_message(self):
        """Token value never appears in RuntimeError messages."""
        payload = _make_payload()

        with patch("httpx.post", return_value=self._mock_response(403, {})):
            with pytest.raises(RuntimeError) as exc_info:
                upload_payload(payload, API_URL, IMPORT_ID, SECRET_TOKEN)

        assert SECRET_TOKEN not in str(exc_info.value)

    def test_token_not_in_timeout_error(self):
        """Token is absent from timeout RuntimeError messages."""
        payload = _make_payload()

        with patch("httpx.post", side_effect=httpx.TimeoutException("timed out")):
            with pytest.raises(RuntimeError) as exc_info:
                upload_payload(payload, API_URL, IMPORT_ID, SECRET_TOKEN)

        assert SECRET_TOKEN not in str(exc_info.value)

    def test_sends_content_type_json(self):
        """Content-Type header is application/json."""
        payload = _make_payload()
        captured: dict = {}

        def fake_post(url, content, headers, timeout):
            captured.update(headers)
            return self._mock_response(200, {})

        with patch("httpx.post", side_effect=fake_post):
            upload_payload(payload, API_URL, IMPORT_ID, SECRET_TOKEN)

        assert captured.get("Content-Type") == "application/json"

    def test_payload_body_is_valid_json(self):
        """The posted body is valid JSON matching payload.to_dict()."""
        payload = _make_payload()
        captured_body: list[bytes] = []

        def fake_post(url, content, headers, timeout):
            captured_body.append(content)
            return self._mock_response(200, {})

        with patch("httpx.post", side_effect=fake_post):
            upload_payload(payload, API_URL, IMPORT_ID, SECRET_TOKEN)

        parsed = json.loads(captured_body[0])
        assert parsed == payload.to_dict()


class TestGetTokenFromEnv:
    def test_returns_token_when_set(self, monkeypatch):
        monkeypatch.setenv("DROPDEX_ACCESS_TOKEN", "my-token")
        assert get_token_from_env() == "my-token"

    def test_raises_when_not_set(self, monkeypatch):
        monkeypatch.delenv("DROPDEX_ACCESS_TOKEN", raising=False)
        with pytest.raises(RuntimeError) as exc_info:
            get_token_from_env()
        assert "DROPDEX_ACCESS_TOKEN" in str(exc_info.value)

    def test_raises_when_empty(self, monkeypatch):
        monkeypatch.setenv("DROPDEX_ACCESS_TOKEN", "   ")
        with pytest.raises(RuntimeError):
            get_token_from_env()

    def test_strips_whitespace(self, monkeypatch):
        monkeypatch.setenv("DROPDEX_ACCESS_TOKEN", "  tok123  ")
        assert get_token_from_env() == "tok123"
