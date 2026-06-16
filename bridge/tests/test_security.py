"""Tests for rekordbox_bridge.security."""
from __future__ import annotations

import os
import stat
import tempfile
from pathlib import Path

import pytest

from rekordbox_bridge.security import readonly_snapshot


class TestReadonlySnapshot:
    def _make_source(self, tmp_path: Path, content: bytes = b"test data") -> Path:
        src = tmp_path / "master.db"
        src.write_bytes(content)
        return src

    def test_temp_file_deleted_after_normal_exit(self, tmp_path):
        """Temp file is deleted when context exits normally."""
        src = self._make_source(tmp_path)
        snap_path_holder: list[Path] = []

        with readonly_snapshot(src) as snap:
            snap_path_holder.append(snap)
            assert snap.exists()

        assert not snap_path_holder[0].exists(), "Snapshot should be deleted after context exit"

    def test_temp_file_deleted_after_exception(self, tmp_path):
        """Temp file is deleted even when an exception is raised inside the context."""
        src = self._make_source(tmp_path)
        snap_path_holder: list[Path] = []

        with pytest.raises(ValueError, match="deliberate"):
            with readonly_snapshot(src) as snap:
                snap_path_holder.append(snap)
                raise ValueError("deliberate")

        assert not snap_path_holder[0].exists(), "Snapshot should be deleted after exception"

    def test_yielded_path_differs_from_source(self, tmp_path):
        """The snapshot path must be different from the source path."""
        src = self._make_source(tmp_path)

        with readonly_snapshot(src) as snap:
            assert snap != src
            assert snap.resolve() != src.resolve()

    def test_source_contents_preserved_in_snapshot(self, tmp_path):
        """Snapshot contains the same bytes as the source."""
        content = b"rekordbox sqlite data here"
        src = self._make_source(tmp_path, content=content)

        with readonly_snapshot(src) as snap:
            assert snap.read_bytes() == content

    def test_source_file_not_modified(self, tmp_path):
        """Source file is not modified during or after snapshot creation."""
        content = b"original content"
        src = self._make_source(tmp_path, content=content)
        original_mtime = src.stat().st_mtime

        with readonly_snapshot(src):
            pass

        assert src.read_bytes() == content, "Source content changed"
        assert src.stat().st_mtime == original_mtime, "Source mtime changed"

    def test_snapshot_is_read_only(self, tmp_path):
        """The snapshot file has no write permission on Unix/macOS."""
        src = self._make_source(tmp_path)

        with readonly_snapshot(src) as snap:
            mode = snap.stat().st_mode
            # owner write bit should NOT be set (0o200)
            assert not (mode & stat.S_IWUSR), f"Snapshot should not be owner-writable, mode={oct(mode)}"
            # owner read bit SHOULD be set
            assert mode & stat.S_IRUSR, f"Snapshot should be owner-readable, mode={oct(mode)}"

    def test_snapshot_does_not_exist_after_context(self, tmp_path):
        """After the context manager exits, the temp path no longer exists on disk."""
        src = self._make_source(tmp_path)
        snap_ref: list[Path] = []

        with readonly_snapshot(src) as snap:
            snap_ref.append(snap)

        assert not snap_ref[0].exists()

    def test_raises_for_non_regular_file(self, tmp_path):
        """readonly_snapshot raises ValueError when source is a directory."""
        with pytest.raises((ValueError, IsADirectoryError, OSError)):
            with readonly_snapshot(tmp_path):
                pass
