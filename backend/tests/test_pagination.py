"""
Tests for supabase_pagination.fetch_all_rows and its integration with the
analysis import service's track/asset queries.

Boundary sizes verified: 0, 1, 999, 1000, 1001, 1999, 2000, 2001, 2215, 6642.
"""
from __future__ import annotations

import os
import sys
from types import SimpleNamespace
from typing import Any, List, Optional

import pytest

# Ensure the backend package is importable in test discovery
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "importer"))

from app.supabase_pagination import fetch_all_rows


# ── Minimal fake query infrastructure ────────────────────────────────────────


class _PagedFakeQuery:
    """Fake PostgREST query with filters, ordering, and range pagination."""

    def __init__(
        self,
        data: List[dict],
        filters: list[tuple[str, str, Any]] | None = None,
        *,
        server_max_rows: int | None = None,
    ):
        self._data = data
        self._filters = list(filters or [])
        self._server_max_rows = server_max_rows
        self._start: Optional[int] = None
        self._end: Optional[int] = None
        self._order_column: str | None = None

    def select(self, *a, **k): return self

    def eq(self, column, value):
        self._filters.append(("eq", column, value))
        return self

    def in_(self, column, values):
        self._filters.append(("in", column, set(values)))
        return self

    def order(self, column, *a, **k):
        self._order_column = column
        return self

    def range(self, start: int, end: int):
        q = _PagedFakeQuery(
            self._data,
            self._filters,
            server_max_rows=self._server_max_rows,
        )
        q._start = start
        q._end = end
        q._order_column = self._order_column
        return q

    def execute(self) -> Any:
        rows = list(self._data)
        for operation, column, value in self._filters:
            # Existing pagination tests use intentionally minimal rows. Apply a
            # filter only when that column is represented in the fake dataset.
            if not any(column in row for row in rows):
                continue
            if operation == "eq":
                rows = [row for row in rows if row.get(column) == value]
            else:
                rows = [row for row in rows if row.get(column) in value]
        if self._order_column and any(self._order_column in row for row in rows):
            rows.sort(key=lambda row: str(row.get(self._order_column) or ""))
        if self._start is not None and self._end is not None:
            rows = rows[self._start:self._end + 1]
            if self._server_max_rows is not None:
                rows = rows[: self._server_max_rows]
        return SimpleNamespace(data=rows)


def _make_rows(n: int, *, id_prefix: str = "") -> List[dict]:
    """Create n synthetic row dicts with sequential ids."""
    return [{"id": f"{id_prefix}{i:04d}", "value": i} for i in range(n)]


def _factory(rows: List[dict], *, server_max_rows: int | None = None):
    """Return a no-arg factory that yields a fresh _PagedFakeQuery each call."""
    return lambda: _PagedFakeQuery(rows, server_max_rows=server_max_rows)


# ── Unit tests for fetch_all_rows ─────────────────────────────────────────────


class TestFetchAllRowsBoundaries:
    """Verify fetch_all_rows returns the correct count for every boundary size."""

    @pytest.mark.parametrize("n", [0, 1, 999, 1000, 1001, 1999, 2000, 2001, 2215, 6642])
    def test_row_count(self, n: int):
        rows = _make_rows(n)
        result = fetch_all_rows(_factory(rows), page_size=1000)
        assert len(result) == n

    @pytest.mark.parametrize("n", [0, 1, 999, 1000, 1001, 1999, 2000, 2001, 2215, 6642])
    def test_row_identity(self, n: int):
        rows = _make_rows(n)
        result = fetch_all_rows(_factory(rows), page_size=1000)
        assert result == rows

    def test_no_duplicates_at_page_boundaries(self):
        """Rows at positions 999 and 1000 must appear exactly once."""
        rows = _make_rows(2001)
        result = fetch_all_rows(_factory(rows), page_size=1000)
        ids = [r["id"] for r in result]
        assert len(ids) == len(set(ids)), "Duplicate rows found at page boundary"

    def test_exact_multiple_terminates_correctly(self):
        """n=2000 means page 1 returns 1000, page 2 returns 1000 (full), page 3 returns 0."""
        rows = _make_rows(2000)
        result = fetch_all_rows(_factory(rows), page_size=1000)
        assert len(result) == 2000

    def test_empty_returns_empty_list(self):
        result = fetch_all_rows(_factory([]), page_size=1000)
        assert result == []

    def test_single_row(self):
        rows = [{"id": "x", "value": 42}]
        result = fetch_all_rows(_factory(rows), page_size=1000)
        assert result == rows

    def test_custom_page_size(self):
        """Smaller page_size still returns all rows correctly."""
        rows = _make_rows(50)
        result = fetch_all_rows(_factory(rows), page_size=10)
        assert result == rows

    def test_custom_order_column_accepted(self):
        rows = _make_rows(5)
        result = fetch_all_rows(_factory(rows), order_column="value", page_size=100)
        assert result == rows

    def test_query_factory_called_once_per_page(self):
        """factory must be called once per page, not once total."""
        call_count = 0
        rows = _make_rows(1500)

        def factory():
            nonlocal call_count
            call_count += 1
            return _PagedFakeQuery(rows)

        fetch_all_rows(factory, page_size=1000)
        # Stop only after an empty page so a server-side max_rows clamp cannot
        # masquerade as the final page.
        assert call_count == 3

    def test_repeated_page_fails_closed_instead_of_looping_or_truncating(self):
        rows = _make_rows(3)

        class IgnoredRangeQuery(_PagedFakeQuery):
            def range(self, _start: int, _end: int):
                return self

        with pytest.raises(RuntimeError, match="no forward progress"):
            fetch_all_rows(lambda: IgnoredRangeQuery(rows), page_size=1000)

    @pytest.mark.parametrize("server_max_rows", [1, 250, 999])
    def test_server_cap_smaller_than_requested_page_size_does_not_truncate(
        self, server_max_rows: int
    ):
        rows = _make_rows(2001)
        result = fetch_all_rows(
            _factory(rows, server_max_rows=server_max_rows),
            page_size=1000,
        )
        assert result == rows

    def test_query_factory_called_once_for_zero_rows(self):
        call_count = 0
        rows: list = []

        def factory():
            nonlocal call_count
            call_count += 1
            return _PagedFakeQuery(rows)

        fetch_all_rows(factory, page_size=1000)
        assert call_count == 1  # one call, zero rows → done


# ── Integration: _get_tracks_with_paths handles >1000 tracks ─────────────────


class TestGetTracksWithPathsIntegration:
    """
    _get_tracks_with_paths must return all tracks for imports larger than 1,000.
    Uses a minimal _FakeSb that passes all reads through _PagedFakeQuery so
    fetch_all_rows page-slicing works correctly.
    """

    def _make_tracks(self, n: int) -> List[dict]:
        return [
            {
                "id": f"track-{i:04d}",
                "rekordbox_content_id": str(i),
                "analysis_data_file_path": f"PIONEER/USBANLZ/P{i:03d}/ANLZ0000.DAT",
            }
            for i in range(n)
        ]

    class _FakeSb:
        def __init__(self, tracks):
            self._tracks = tracks

        def table(self, name: str):
            if name == "rekordbox_tracks":
                return _PagedFakeQuery(self._tracks)
            return _PagedFakeQuery([])

    @pytest.mark.parametrize("n", [0, 1, 999, 1000, 1001, 2215])
    def test_returns_all_tracks(self, n: int):
        from app.analysis_import_service import _get_tracks_with_paths
        tracks = self._make_tracks(n)
        sb = self._FakeSb(tracks)
        result = _get_tracks_with_paths(sb, "import-001")
        assert len(result) == n

    def test_tracks_1000_and_1001_are_both_returned(self):
        """Specific regression: the 1000th and 1001st tracks must not be dropped."""
        from app.analysis_import_service import _get_tracks_with_paths
        tracks = self._make_tracks(2215)
        sb = self._FakeSb(tracks)
        result = _get_tracks_with_paths(sb, "import-001")
        ids = {r["id"] for r in result}
        assert "track-0999" in ids, "Track at index 999 missing"
        assert "track-1000" in ids, "Track at index 1000 (>1000 cap) missing"
        assert "track-2214" in ids, "Last track missing"

    def test_filters_out_tracks_without_path(self):
        from app.analysis_import_service import _get_tracks_with_paths
        tracks = [
            {"id": "a", "rekordbox_content_id": "1", "analysis_data_file_path": "P001/ANLZ.DAT"},
            {"id": "b", "rekordbox_content_id": "2", "analysis_data_file_path": None},
            {"id": "c", "rekordbox_content_id": "3", "analysis_data_file_path": ""},
        ]
        sb = self._FakeSb(tracks)
        result = _get_tracks_with_paths(sb, "x")
        assert [r["id"] for r in result] == ["a"]


# ── Integration: complete_analysis_import assets query ────────────────────────


class TestCompleteAnalysisImportPagination:
    """
    complete_analysis_import must load ALL uploaded assets, including those
    beyond row 1,000.  Uses a slimmed-down fake Sb that returns paginated assets.
    """

    def _make_import_row(self):
        return {
            "id": "imp-1",
            "user_id": "u1",
            "status": "uploaded",
            "source_filename": "exportLibrary.db",
            "analysis_expected_track_count": 2,
            "manifest_status": "uploaded",
        }

    def _make_tracks(self, n: int) -> List[dict]:
        return [
            {
                "id": f"track-{i:04d}",
                "rekordbox_content_id": str(i),
                "analysis_data_file_path": f"PIONEER/USBANLZ/P{i:03d}/ANLZ0000.DAT",
            }
            for i in range(n)
        ]

    def _make_assets(self, n: int) -> List[dict]:
        types = ["DAT", "EXT", "2EX"]
        return [
            {
                "id": f"asset-{i:04d}",
                "track_id": f"track-{(i // 3):04d}",
                "asset_type": types[i % 3],
                "relative_path": f"PIONEER/USBANLZ/P{i:04d}/ANLZ{i:04d}.{types[i % 3]}",
                "storage_path": f"uuid/{i}.bin",
                "sha256": f"sha{i:064d}",
            }
            for i in range(n)
        ]

    class _FakeSb:
        def __init__(self, import_row, tracks, assets):
            self._import_row = import_row
            self._tracks = tracks
            self._assets = assets

        def table(self, name: str):
            if name == "rekordbox_imports":
                # Single-row selects always return the same row regardless of range
                return _SingleFakeQuery(self._import_row)
            if name == "rekordbox_tracks":
                return _PagedFakeQuery(self._tracks)
            if name == "rekordbox_analysis_assets":
                return _PagedFakeQuery(self._assets)
            return _PagedFakeQuery([])

    @pytest.mark.parametrize("asset_count", [0, 999, 1000, 1001, 2215, 6642])
    def test_all_assets_loaded(self, asset_count: int):
        """The real fast-pipeline asset loader must cross every page boundary."""
        from app.analysis_fast_pipeline import _load_assets

        tracks = self._make_tracks((asset_count + 1) // 2)
        assets = [
            {
                "id": f"asset-{i:04d}",
                "import_id": "imp-1",
                "track_id": f"track-{(i // 2):04d}",
                "asset_type": "DAT" if i % 2 == 0 else "EXT",
                "relative_path": f"PIONEER/USBANLZ/P{i:04d}/ANLZ{i:04d}.{'DAT' if i % 2 == 0 else 'EXT'}",
                "upload_status": "staged",
                "staging_key": f"imp-1/assets/{i:04d}",
            }
            for i in range(asset_count)
        ]
        sb = self._FakeSb(self._make_import_row(), tracks, assets)

        result = _load_assets(sb, "imp-1", tracks)
        assert len(result) == asset_count
        assert {row["id"] for row in result} == {row["id"] for row in assets}


class _SingleFakeQuery:
    """FakeQuery that always returns a single dict from execute()."""

    def __init__(self, data: dict | None):
        self._data = data
        self._single = False

    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def neq(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def order(self, *a, **k): return self
    def range(self, *a, **k): return self
    def update(self, *a, **k): return self
    def insert(self, *a, **k): return self

    def maybe_single(self):
        q = _SingleFakeQuery(self._data)
        q._single = True
        return q

    def execute(self):
        if self._single:
            if self._data is None:
                return None
            return SimpleNamespace(data=self._data)
        return SimpleNamespace(data=[self._data] if self._data else [])



# ── Integration: _get_tracks_for_rescan handles >1000 tracks ─────────────────


class TestGetTracksForRescanPagination:
    """_get_tracks_for_rescan must return all tracks for imports > 1,000."""

    class _FakeSb:
        def __init__(self, tracks):
            self._tracks = tracks

        def table(self, name: str):
            if name == "rekordbox_tracks":
                return _PagedFakeQuery(self._tracks)
            return _PagedFakeQuery([])

    @pytest.mark.parametrize("n", [0, 1, 999, 1000, 1001, 2215])
    def test_returns_all_tracks(self, n: int):
        from app.analysis_import_service import _get_tracks_for_rescan
        tracks = [
            {
                "id": f"t{i}",
                "rekordbox_content_id": str(i),
                "analysis_data_file_path": f"path{i}.DAT",
                "master_db_id": None,
                "master_content_id": None,
                "analysis_data_update_count": 0,
                "cue_update_count": 0,
                "information_update_count": 0,
            }
            for i in range(n)
        ]
        sb = self._FakeSb(tracks)
        result = _get_tracks_for_rescan(sb, "imp-x")
        assert len(result) == n
