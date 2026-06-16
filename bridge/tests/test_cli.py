"""Tests for rekordbox_bridge.cli."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from rekordbox_bridge.cli import main
from rekordbox_bridge.models import BridgePayload, RelatedTrackList, SourceInfo

SECRET_TOKEN = "cli-test-token-xyz"


def _make_payload(lists=None) -> BridgePayload:
    return BridgePayload(
        schema_version=1,
        generated_at="2026-06-16T00:00:00Z",
        source=SourceInfo(
            rekordbox_database_id="db-1",
            rekordbox_version="6.0",
            device_name="Test Mac",
        ),
        lists=lists or [],
    )


def _fake_snapshot(tmp_path: Path):
    """Context manager that yields a fake snapshot file."""
    from contextlib import contextmanager

    @contextmanager
    def _ctx(src_path):
        snap = tmp_path / "snap.db"
        snap.write_bytes(b"")
        yield snap

    return _ctx


class TestExportSubcommand:
    def test_writes_json_to_output_file(self, tmp_path, monkeypatch):
        """export subcommand writes valid JSON to the specified output file."""
        db = tmp_path / "master.db"
        db.write_bytes(b"")
        out = tmp_path / "out.json"
        payload = _make_payload()

        with patch("rekordbox_bridge.cli.resolve_db_path", return_value=db), \
             patch("rekordbox_bridge.cli.readonly_snapshot", _fake_snapshot(tmp_path)), \
             patch("rekordbox_bridge.cli.extract_related_tracks", return_value=payload):
            code = main(["export", "--db-path", str(db), "--output", str(out)])

        assert code == 0
        assert out.exists()
        data = json.loads(out.read_text())
        assert data["schemaVersion"] == 1

    def test_dry_run_does_not_write_file(self, tmp_path):
        """export --dry-run never writes an output file."""
        db = tmp_path / "master.db"
        db.write_bytes(b"")
        out = tmp_path / "out.json"
        payload = _make_payload()

        with patch("rekordbox_bridge.cli.resolve_db_path", return_value=db), \
             patch("rekordbox_bridge.cli.readonly_snapshot", _fake_snapshot(tmp_path)), \
             patch("rekordbox_bridge.cli.extract_related_tracks", return_value=payload):
            code = main(["export", "--db-path", str(db), "--output", str(out), "--dry-run"])

        assert code == 0
        assert not out.exists(), "dry-run should not write output file"

    def test_export_returns_zero_on_success(self, tmp_path):
        """export returns exit code 0 on success."""
        db = tmp_path / "master.db"
        db.write_bytes(b"")
        out = tmp_path / "out.json"
        payload = _make_payload()

        with patch("rekordbox_bridge.cli.resolve_db_path", return_value=db), \
             patch("rekordbox_bridge.cli.readonly_snapshot", _fake_snapshot(tmp_path)), \
             patch("rekordbox_bridge.cli.extract_related_tracks", return_value=payload):
            code = main(["export", "--db-path", str(db), "--output", str(out)])

        assert code == 0

    def test_prints_close_rekordbox_warning(self, tmp_path, capsys):
        """CLI always prints the 'close Rekordbox' warning to stderr."""
        db = tmp_path / "master.db"
        db.write_bytes(b"")
        out = tmp_path / "out.json"
        payload = _make_payload()

        with patch("rekordbox_bridge.cli.resolve_db_path", return_value=db), \
             patch("rekordbox_bridge.cli.readonly_snapshot", _fake_snapshot(tmp_path)), \
             patch("rekordbox_bridge.cli.extract_related_tracks", return_value=payload):
            main(["export", "--db-path", str(db), "--output", str(out)])

        captured = capsys.readouterr()
        assert "rekordbox" in captured.err.lower() or "close" in captured.err.lower()


class TestUploadSubcommand:
    def test_calls_upload_payload(self, tmp_path, monkeypatch):
        """upload subcommand calls upload_payload when not dry-run."""
        monkeypatch.setenv("DROPDEX_ACCESS_TOKEN", SECRET_TOKEN)
        db = tmp_path / "master.db"
        db.write_bytes(b"")
        payload = _make_payload()
        upload_mock = MagicMock(return_value={"status": "ok"})

        with patch("rekordbox_bridge.cli.resolve_db_path", return_value=db), \
             patch("rekordbox_bridge.cli.readonly_snapshot", _fake_snapshot(tmp_path)), \
             patch("rekordbox_bridge.cli.extract_related_tracks", return_value=payload), \
             patch("rekordbox_bridge.cli.upload_payload", upload_mock):
            code = main([
                "upload",
                "--db-path", str(db),
                "--api-url", "https://api.example.com",
                "--import-id", "imp-1",
            ])

        assert code == 0
        upload_mock.assert_called_once()

    def test_dry_run_does_not_upload(self, tmp_path, monkeypatch):
        """upload --dry-run never calls upload_payload."""
        monkeypatch.setenv("DROPDEX_ACCESS_TOKEN", SECRET_TOKEN)
        db = tmp_path / "master.db"
        db.write_bytes(b"")
        payload = _make_payload()
        upload_mock = MagicMock()

        with patch("rekordbox_bridge.cli.resolve_db_path", return_value=db), \
             patch("rekordbox_bridge.cli.readonly_snapshot", _fake_snapshot(tmp_path)), \
             patch("rekordbox_bridge.cli.extract_related_tracks", return_value=payload), \
             patch("rekordbox_bridge.cli.upload_payload", upload_mock):
            code = main([
                "upload",
                "--db-path", str(db),
                "--api-url", "https://api.example.com",
                "--import-id", "imp-1",
                "--dry-run",
            ])

        assert code == 0
        upload_mock.assert_not_called()

    def test_missing_token_env_returns_error(self, tmp_path, monkeypatch):
        """upload returns exit code 1 when DROPDEX_ACCESS_TOKEN is not set."""
        monkeypatch.delenv("DROPDEX_ACCESS_TOKEN", raising=False)
        db = tmp_path / "master.db"
        db.write_bytes(b"")
        payload = _make_payload()

        with patch("rekordbox_bridge.cli.resolve_db_path", return_value=db), \
             patch("rekordbox_bridge.cli.readonly_snapshot", _fake_snapshot(tmp_path)), \
             patch("rekordbox_bridge.cli.extract_related_tracks", return_value=payload):
            code = main([
                "upload",
                "--db-path", str(db),
                "--api-url", "https://api.example.com",
                "--import-id", "imp-1",
            ])

        assert code == 1

    def test_token_not_in_stderr_output(self, tmp_path, monkeypatch, capsys):
        """Token value never appears in any captured stderr output."""
        monkeypatch.setenv("DROPDEX_ACCESS_TOKEN", SECRET_TOKEN)
        db = tmp_path / "master.db"
        db.write_bytes(b"")
        payload = _make_payload()
        # Make upload fail so error messages are generated
        upload_mock = MagicMock(side_effect=RuntimeError("HTTP 500 from server"))

        with patch("rekordbox_bridge.cli.resolve_db_path", return_value=db), \
             patch("rekordbox_bridge.cli.readonly_snapshot", _fake_snapshot(tmp_path)), \
             patch("rekordbox_bridge.cli.extract_related_tracks", return_value=payload), \
             patch("rekordbox_bridge.cli.upload_payload", upload_mock):
            main([
                "upload",
                "--db-path", str(db),
                "--api-url", "https://api.example.com",
                "--import-id", "imp-1",
            ])

        captured = capsys.readouterr()
        assert SECRET_TOKEN not in captured.out
        assert SECRET_TOKEN not in captured.err

    def test_upload_token_from_env_not_argv(self, tmp_path, monkeypatch):
        """The upload subcommand does not accept --token as a CLI argument."""
        monkeypatch.setenv("DROPDEX_ACCESS_TOKEN", SECRET_TOKEN)
        db = tmp_path / "master.db"
        db.write_bytes(b"")

        with pytest.raises(SystemExit):
            main([
                "upload",
                "--db-path", str(db),
                "--api-url", "https://api.example.com",
                "--import-id", "imp-1",
                "--token", SECRET_TOKEN,  # should NOT be a valid flag
            ])


class TestExportOutputSchema:
    def test_output_json_matches_schema(self, tmp_path):
        """Exported JSON matches the expected camelCase schema."""
        db = tmp_path / "master.db"
        db.write_bytes(b"")
        out = tmp_path / "out.json"

        list_row = RelatedTrackList(
            source_list_id="1",
            parent_source_list_id=None,
            name="Warm Up",
            sort_order=1,
            is_folder=False,
            attribute=0,
            criteria_raw={},
            members=[],
        )
        payload = _make_payload(lists=[list_row])

        with patch("rekordbox_bridge.cli.resolve_db_path", return_value=db), \
             patch("rekordbox_bridge.cli.readonly_snapshot", _fake_snapshot(tmp_path)), \
             patch("rekordbox_bridge.cli.extract_related_tracks", return_value=payload):
            main(["export", "--db-path", str(db), "--output", str(out)])

        data = json.loads(out.read_text())
        assert "schemaVersion" in data
        assert "generatedAt" in data
        assert "source" in data
        assert "lists" in data
        assert data["lists"][0]["sourceListId"] == "1"
        assert data["lists"][0]["name"] == "Warm Up"
        assert data["lists"][0]["isFolder"] is False
