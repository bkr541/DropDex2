"""
Tests for dropdex_importer.reparse.

All Supabase calls are mocked — no real credentials required.

To run:
    cd importer
    pytest tests/test_reparse.py -v
"""

from __future__ import annotations

import os
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from dropdex_importer.reparse import (
    _detail_storage_path,
    _query_target_tracks,
    _reconcile_cues,
    _version_is_older,
    _write_waveform_row,
    run_reparse,
)


# ── Fake Supabase helpers ─────────────────────────────────────────────────────

def _make_sb(tracks=None, assets=None):
    """Return a MagicMock Supabase client pre-configured with data."""
    sb = MagicMock()

    def _table(name):
        q = MagicMock()
        q.select.return_value = q
        q.eq.return_value = q
        q.update.return_value = q
        q.delete.return_value = q

        if name == "rekordbox_tracks":
            q.execute.return_value = SimpleNamespace(data=tracks or [])
        elif name == "rekordbox_analysis_assets":
            q.execute.return_value = SimpleNamespace(data=assets or [])
        else:
            q.execute.return_value = SimpleNamespace(data=None)

        return q

    sb.table.side_effect = _table
    return sb


# ── TestReparseArgParsing ─────────────────────────────────────────────────────

class TestReparseArgParsing:
    def test_dry_run_skips_all(self):
        """dry_run=True must return skipped=N, completed=0, and never call _reparse_track."""
        tracks_data = [{"id": "t1", "import_id": "imp1"}, {"id": "t2", "import_id": "imp1"}]

        with (
            patch("dropdex_importer.reparse._query_target_tracks", return_value=tracks_data) as mock_q,
            patch("dropdex_importer.reparse._reparse_track") as mock_rt,
        ):
            result = run_reparse(
                "https://example.supabase.co", "key", import_id="imp1", dry_run=True, client=MagicMock()
            )

        assert result["skipped"] == 2
        assert result["completed"] == 0
        assert result["failed"] == 0
        mock_rt.assert_not_called()

    def test_failed_track_does_not_stop_others(self):
        """If one track fails, the loop continues for remaining tracks."""
        tracks_data = [
            {"id": "t1", "import_id": "imp1"},
            {"id": "t2", "import_id": "imp1"},
            {"id": "t3", "import_id": "imp1"},
        ]

        call_order = []

        def mock_reparse(sb, track):
            call_order.append(track["id"])
            if track["id"] == "t2":
                return "failed"
            return "completed"

        with (
            patch("dropdex_importer.reparse._query_target_tracks", return_value=tracks_data),
            patch("dropdex_importer.reparse._reparse_track", side_effect=mock_reparse),
        ):
            result = run_reparse(
                "https://example.supabase.co", "key", import_id="imp1", client=MagicMock()
            )

        assert call_order == ["t1", "t2", "t3"], "All three tracks must be attempted"
        assert result["completed"] == 2
        assert result["failed"] == 1

    def test_missing_env_causes_nonzero_exit(self):
        """Without SUPABASE_URL/SUPABASE_SECRET_KEY, the CLI must exit nonzero."""
        result = subprocess.run(
            [sys.executable, "-m", "dropdex_importer", "reparse", "--import-id", "xxx"],
            capture_output=True,
            env={},  # empty environment — no env vars
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        )
        assert result.returncode != 0
        assert b"SUPABASE_URL" in result.stderr or b"SUPABASE_SECRET_KEY" in result.stderr

    def test_no_subcommand_exits_nonzero(self):
        """Running `python -m dropdex_importer` with no subcommand must exit nonzero."""
        result = subprocess.run(
            [sys.executable, "-m", "dropdex_importer"],
            capture_output=True,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        )
        assert result.returncode != 0

    def test_unknown_subcommand_exits_nonzero(self):
        """An unknown subcommand must produce a nonzero exit code."""
        result = subprocess.run(
            [sys.executable, "-m", "dropdex_importer", "unknowncmd"],
            capture_output=True,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        )
        assert result.returncode != 0

    def test_all_failed_returns_exit_code_1(self):
        """run_reparse with all failed tracks → exit code 1 from main()."""
        from dropdex_importer.reparse import main as reparse_main

        with (
            patch(
                "dropdex_importer.reparse.run_reparse",
                return_value={"completed": 0, "partial": 0, "failed": 1, "skipped": 0},
            ),
            patch.dict(os.environ, {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SECRET_KEY": "k"}),
        ):
            exit_code = reparse_main(["--import-id", "i1"])

        assert exit_code == 1

    def test_all_completed_returns_exit_code_0(self):
        """run_reparse with all completed tracks → exit code 0."""
        from dropdex_importer.reparse import main as reparse_main

        with (
            patch(
                "dropdex_importer.reparse.run_reparse",
                return_value={"completed": 1, "partial": 0, "failed": 0, "skipped": 0},
            ),
            patch.dict(os.environ, {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SECRET_KEY": "k"}),
        ):
            exit_code = reparse_main(["--import-id", "i1"])

        assert exit_code == 0


# ── TestQueryTargetTracks ─────────────────────────────────────────────────────

class TestQueryTargetTracks:
    def test_by_import_id(self):
        sb = MagicMock()
        q = MagicMock()
        q.select.return_value = q
        q.eq.return_value = q
        q.execute.return_value = SimpleNamespace(data=[{"id": "t1", "import_id": "imp1"}])
        sb.table.return_value = q

        tracks = _query_target_tracks(sb, import_id="imp1", track_id=None, older_than_version=None)

        assert len(tracks) == 1
        assert tracks[0]["id"] == "t1"
        sb.table.assert_called_with("rekordbox_tracks")

    def test_by_track_id(self):
        sb = MagicMock()
        q = MagicMock()
        q.select.return_value = q
        q.eq.return_value = q
        q.execute.return_value = SimpleNamespace(data=[{"id": "t-specific", "import_id": "imp1"}])
        sb.table.return_value = q

        tracks = _query_target_tracks(sb, import_id=None, track_id="t-specific", older_than_version=None)

        assert len(tracks) == 1
        assert tracks[0]["id"] == "t-specific"

    def test_older_than_version_filters_correctly(self):
        """Only tracks with parser_version < threshold are returned."""
        all_tracks = [
            {"id": "t1", "import_id": "i1", "analysis_parser_version": "1.0.0"},
            {"id": "t2", "import_id": "i1", "analysis_parser_version": "2.0.0"},
            {"id": "t3", "import_id": "i1", "analysis_parser_version": None},
        ]
        sb = MagicMock()
        q = MagicMock()
        q.select.return_value = q
        q.execute.return_value = SimpleNamespace(data=all_tracks)
        sb.table.return_value = q

        tracks = _query_target_tracks(sb, import_id=None, track_id=None, older_than_version="2.0.0")

        assert "analysis_parser_version" in q.select.call_args.args[0]
        ids = [t["id"] for t in tracks]
        # t1 (1.0.0 < 2.0.0) and t3 (None → 0.0.0 < 2.0.0) should be included
        assert "t1" in ids
        assert "t3" in ids
        # t2 is exactly 2.0.0 → NOT older
        assert "t2" not in ids

    def test_returns_empty_when_no_tracks(self):
        sb = MagicMock()
        q = MagicMock()
        q.select.return_value = q
        q.eq.return_value = q
        q.execute.return_value = SimpleNamespace(data=[])
        sb.table.return_value = q

        tracks = _query_target_tracks(sb, import_id="nonexistent", track_id=None, older_than_version=None)
        assert tracks == []


# ── TestVersionComparison ─────────────────────────────────────────────────────

class TestVersionComparison:
    @pytest.mark.parametrize("stored,threshold,expected", [
        ("1.0.0", "2.0.0", True),
        ("2.0.0", "2.0.0", False),
        ("2.0.1", "2.0.0", False),
        ("0.9.9", "1.0.0", True),
        (None, "1.0.0", True),   # None treated as 0.0.0
        ("unparseable", "1.0.0", True),
        ("1.0.0", "1.0.1", True),
        ("1.1.0", "1.0.9", False),
    ])
    def test_version_comparison(self, stored, threshold, expected):
        stored_val = stored if stored is not None else "0.0.0"
        assert _version_is_older(stored_val, threshold) == expected


# ── TestReparseSkipsNoAssets ──────────────────────────────────────────────────

class TestReparseTrackBehavior:
    def test_track_with_no_assets_is_skipped(self):
        """A track with no uploaded ANLZ assets returns 'skipped'."""
        from dropdex_importer.reparse import _reparse_track

        sb = _make_sb(assets=[])
        result = _reparse_track(sb, {"id": "track-001", "import_id": "imp-001"})
        assert result == "skipped"

    def test_track_with_no_dat_asset_is_skipped(self):
        """A track that has only an EXT (no DAT) asset returns 'skipped'."""
        from dropdex_importer.reparse import _reparse_track

        assets = [
            {
                "id": "asset-ext-01",
                "asset_type": "EXT",
                "storage_path": "u/i/anlz/PIONEER/ANLZ0000.EXT",
                "sha256": "abc",
            }
        ]
        sb = _make_sb(assets=assets)
        result = _reparse_track(sb, {"id": "track-002", "import_id": "imp-001"})
        assert result == "skipped"

    def test_storage_download_failure_returns_failed(self):
        """If storage download raises, the track is marked failed."""
        from dropdex_importer.reparse import _reparse_track

        assets = [
            {
                "id": "asset-dat-01",
                "asset_type": "DAT",
                "storage_path": "u/i/anlz/PIONEER/ANLZ0000.DAT",
                "sha256": "abc",
            }
        ]
        sb = _make_sb(assets=assets)
        # Make storage.from_().download raise
        sb.storage.from_.return_value.download.side_effect = RuntimeError("Network error")

        result = _reparse_track(sb, {"id": "track-003", "import_id": "imp-001"})
        assert result == "failed"

    def test_temp_dir_cleaned_up_on_skip(self):
        """Even when skipped, no temp directory should be left around."""
        from dropdex_importer.reparse import _reparse_track
        import tempfile as _tmpmod

        created: list[str] = []
        real_mkdtemp = _tmpmod.mkdtemp

        def capturing_mkdtemp(*a, **k):
            path = real_mkdtemp(*a, **k)
            created.append(path)
            return path

        sb = _make_sb(assets=[])

        with patch("dropdex_importer.reparse.tempfile.mkdtemp", capturing_mkdtemp):
            _reparse_track(sb, {"id": "track-skip", "import_id": "imp-001"})

        # mkdtemp should NOT have been called since we skip before entering the try block
        # (no assets → early return). This verifies the early-return path is clean.
        for path in created:
            assert not os.path.exists(path), f"Temp dir not cleaned up: {path}"


# ── TestWaveformReparseWriter ─────────────────────────────────────────────────

class TestWaveformReparseWriter:
    def test_detail_path_is_parser_versioned(self):
        path = _detail_storage_path("user-1", "import-1", "track-1")
        assert path.endswith("/detail.v2.1.0.json.gz")

    def test_uploads_regenerated_detail_before_database_update(self):
        events: list[str] = []
        sb = MagicMock()
        storage = MagicMock()
        sb.storage.from_.return_value = storage
        storage.upload.side_effect = lambda **kwargs: events.append("upload")

        query = MagicMock()
        query.upsert.side_effect = lambda *args, **kwargs: events.append("upsert") or query
        query.execute.return_value = SimpleNamespace(data=None)
        sb.table.return_value = query

        preview = SimpleNamespace(
            format="PWV4",
            column_count=1,
            columns=[{"h": 127, "r": 255, "g": 0, "b": 0}],
        )
        detail = SimpleNamespace(
            format="PWV5",
            column_count=1,
            compressed_bytes=b"gzip-detail",
        )
        waveform = SimpleNamespace(preview=preview, detail=detail)

        _write_waveform_row(
            sb,
            "import-1",
            "track-1",
            waveform,
            {"DAT": "dat-id", "EXT": "ext-id", "2EX": None},
            "user-1",
        )

        assert events == ["upload", "upsert"]
        storage.upload.assert_called_once()
        upload_kwargs = storage.upload.call_args.kwargs
        assert upload_kwargs["path"].endswith("/detail.v2.1.0.json.gz")
        assert upload_kwargs["file"] == b"gzip-detail"

        row = query.upsert.call_args.args[0]
        assert row["detail_format"] == "PWV5"
        assert row["detail_column_count"] == 1
        assert row["detail_storage_path"].endswith("/detail.v2.1.0.json.gz")

    def test_upload_failure_preserves_existing_waveform_row(self):
        sb = MagicMock()
        storage = MagicMock()
        storage.upload.side_effect = RuntimeError("storage unavailable")
        sb.storage.from_.return_value = storage

        waveform = SimpleNamespace(
            preview=SimpleNamespace(format="PWV4", column_count=1, columns=[{"h": 1, "r": 1, "g": 1, "b": 1}]),
            detail=SimpleNamespace(format="PWV5", column_count=1, compressed_bytes=b"detail"),
        )

        with pytest.raises(RuntimeError, match="storage unavailable"):
            _write_waveform_row(
                sb, "import-1", "track-1", waveform, {}, "user-1"
            )

        sb.table.assert_not_called()


class _CueQuery:
    def __init__(self, existing, operations):
        self.existing = existing
        self.operations = operations
        self.operation = "select"
        self.payload = None
        self.filters = []

    def select(self, *_args, **_kwargs):
        self.operation = "select"
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = payload
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def upsert(self, payload, **kwargs):
        self.operation = "upsert"
        self.payload = payload
        self.upsert_kwargs = kwargs
        return self

    def execute(self):
        if self.operation == "select":
            return SimpleNamespace(data=self.existing)
        self.operations.append((self.operation, self.payload, list(self.filters)))
        return SimpleNamespace(data=None)


class _CueSb:
    def __init__(self, existing):
        self.existing = existing
        self.operations = []

    def table(self, name):
        assert name == "rekordbox_cues"
        return _CueQuery(self.existing, self.operations)


class TestCueReparseOwnership:
    def test_deletes_parser_only_cue_that_disappeared(self):
        sb = _CueSb([{
            "id": "stale-anlz",
            "dedupe_key": "anlz:i1:PCO2:0",
            "cue_family": "hot",
            "hot_cue_slot": 1,
            "start_ms": 1000,
            "source_kind": "PCO2",
            "source_db_present": False,
            "source_anlz_present": True,
        }])

        _reconcile_cues(sb, "i1", "t1", [], 5.0)

        assert sb.operations == [("delete", None, [("id", "stale-anlz")])]

    def test_retains_db_owned_cue_and_clears_stale_anlz_ownership(self):
        sb = _CueSb([{
            "id": "merged",
            "dedupe_key": "db:i1:cue-1",
            "cue_family": "memory",
            "hot_cue_slot": None,
            "start_ms": 1000,
            "source_kind": "PCOB",
            "source_db_present": True,
            "source_anlz_present": True,
        }])

        _reconcile_cues(sb, "i1", "t1", [], 5.0)

        assert sb.operations == [(
            "update",
            {"source_anlz_present": False, "source_conflict": False},
            [("id", "merged")],
        )]
