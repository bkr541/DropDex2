"""Tests for rekordbox_bridge.discovery."""
from __future__ import annotations

import platform
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from rekordbox_bridge.discovery import find_master_db, resolve_db_path


class TestFindMasterDb:
    def test_returns_none_when_no_paths_exist(self):
        """find_master_db() returns None when no candidate paths exist."""
        with patch("platform.system", return_value="Darwin"), \
             patch.object(Path, "exists", return_value=False):
            result = find_master_db()
        assert result is None

    def test_macos_checks_correct_path(self):
        """On macOS the expected path under ~/Library/Pioneer is checked."""
        expected_suffix = Path("Library") / "Pioneer" / "rekordbox" / "master.db"
        found_paths: list[Path] = []

        def fake_exists(self: Path) -> bool:
            found_paths.append(self)
            # Return True for the first macOS candidate so find returns it
            return str(self).endswith("master.db")

        with patch("platform.system", return_value="Darwin"), \
             patch.object(Path, "exists", fake_exists):
            result = find_master_db()

        assert result is not None
        assert result.parts[-4:] == ("Library", "Pioneer", "rekordbox", "master.db")

    def test_windows_checks_localappdata_path(self, monkeypatch):
        """On Windows the %LOCALAPPDATA%\\Pioneer path is checked."""
        monkeypatch.setenv("LOCALAPPDATA", "C:\\Users\\test\\AppData\\Local")
        monkeypatch.setenv("APPDATA", "C:\\Users\\test\\AppData\\Roaming")

        checked_paths: list[Path] = []

        def fake_exists(self: Path) -> bool:
            checked_paths.append(self)
            return str(self).endswith("master.db")

        with patch("platform.system", return_value="Windows"), \
             patch.object(Path, "exists", fake_exists):
            result = find_master_db()

        # At least one checked path should contain LOCALAPPDATA segment
        local_app_data_paths = [
            p for p in checked_paths
            if "Local" in str(p) and "Pioneer" in str(p)
        ]
        assert local_app_data_paths, f"Expected LOCALAPPDATA path checked; got {checked_paths}"

    def test_windows_returns_none_when_not_found(self, monkeypatch):
        """On Windows, returns None when no candidate path exists."""
        monkeypatch.setenv("LOCALAPPDATA", "C:\\Users\\test\\AppData\\Local")

        with patch("platform.system", return_value="Windows"), \
             patch.object(Path, "exists", return_value=False):
            result = find_master_db()

        assert result is None

    def test_returns_path_when_found_on_macos(self):
        """Returns a Path object (not None) when the macOS candidate exists."""
        with patch("platform.system", return_value="Darwin"), \
             patch.object(Path, "exists", return_value=True):
            result = find_master_db()

        assert isinstance(result, Path)


class TestResolveDbPath:
    def test_explicit_path_raises_when_missing(self, tmp_path):
        """resolve_db_path with explicit non-existent path raises FileNotFoundError."""
        missing = str(tmp_path / "nonexistent.db")
        with pytest.raises(FileNotFoundError) as exc_info:
            resolve_db_path(missing)
        assert "nonexistent.db" in str(exc_info.value)

    def test_explicit_path_returns_path_when_exists(self, tmp_path):
        """resolve_db_path with explicit existing path returns that path."""
        real_file = tmp_path / "master.db"
        real_file.write_bytes(b"")
        result = resolve_db_path(str(real_file))
        assert result == real_file

    def test_auto_discovery_raises_when_not_found(self):
        """resolve_db_path(None) raises FileNotFoundError when auto-discovery fails."""
        with patch("rekordbox_bridge.discovery.find_master_db", return_value=None):
            with pytest.raises(FileNotFoundError) as exc_info:
                resolve_db_path(None)
        assert "master.db" in str(exc_info.value).lower() or "--db-path" in str(exc_info.value)

    def test_auto_discovery_returns_found_path(self, tmp_path):
        """resolve_db_path(None) returns the auto-discovered path when found."""
        fake_db = tmp_path / "master.db"
        fake_db.write_bytes(b"")
        with patch("rekordbox_bridge.discovery.find_master_db", return_value=fake_db):
            result = resolve_db_path(None)
        assert result == fake_db

    def test_does_not_modify_returned_path(self, tmp_path):
        """resolve_db_path never modifies the path before returning it."""
        real_file = tmp_path / "master.db"
        real_file.write_bytes(b"")
        result = resolve_db_path(str(real_file))
        # The resolved path should point to the same file
        assert result.exists()
        assert result.stat().st_size == 0  # still empty — not modified
