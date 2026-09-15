"""
Tests for the Stage 2 buffered metrics checkpoint system.

Covers:
  1. Single batch: metrics buffered, no immediate Supabase RPC
  2. Fewer than threshold: accumulate correctly, RPC not called per batch
  3. Threshold reached: exactly one aggregated RPC, totals are correct
  4. Concurrent contributions: no data loss
  5. Isolated import IDs: buffers do not cross-contaminate
  6. Force flush: writes once, clears buffer
  7. Supabase RPC failure: analysis batch still succeeds (data silently lost;
     merge_import_metrics swallows the exception internally)
  8. complete_analysis_import(): calls flush_import_metrics before Stage 3
  9. Existing direct merge_import_metrics() callers still work

To run:
    cd backend
    pytest tests/test_metrics_buffering.py -v
"""

from __future__ import annotations

import asyncio
import threading
from unittest.mock import MagicMock, patch

import pytest

IMPORT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
USER_ID = "user-aaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fresh_metrics(import_id: str = IMPORT_ID):
    from app.analysis_performance import ImportMetrics
    m = ImportMetrics(import_id)
    m.timings_ms["file_transfer"] = 10.0
    m.counts["upload_batches"] = 1
    m.counts["assets_staged"] = 5
    m.bytes["assets_staged"] = 1024
    return m


def _clear_buffer(import_id: str = IMPORT_ID) -> None:
    from app.analysis_performance import _metrics_buffer, _metrics_lock
    with _metrics_lock:
        _metrics_buffer.pop(import_id, None)


def _fake_sb() -> MagicMock:
    sb = MagicMock()
    sb.rpc.return_value.execute.return_value = MagicMock(data=None)
    return sb


# ── Test cases ────────────────────────────────────────────────────────────────

class TestMetricsBuffering:
    def setup_method(self):
        _clear_buffer()

    def teardown_method(self):
        _clear_buffer()

    # 1. Single batch: buffered, no immediate RPC
    def test_single_batch_does_not_call_rpc(self):
        from app.analysis_performance import checkpoint_import_metrics, _metrics_buffer, _metrics_lock

        sb = _fake_sb()
        checkpoint_import_metrics(sb, IMPORT_ID, _fresh_metrics())

        sb.rpc.assert_not_called()
        with _metrics_lock:
            assert IMPORT_ID in _metrics_buffer

    # 2. Fewer-than-threshold: accumulate correctly, no per-batch RPC
    def test_accumulates_without_rpc_below_threshold(self):
        from app.analysis_performance import (
            checkpoint_import_metrics, _metrics_buffer, _metrics_lock,
            _METRIC_CHECKPOINT_BATCHES,
        )

        sb = _fake_sb()
        batch_count = _METRIC_CHECKPOINT_BATCHES - 1
        for _ in range(batch_count):
            checkpoint_import_metrics(sb, IMPORT_ID, _fresh_metrics())

        sb.rpc.assert_not_called()
        with _metrics_lock:
            pending = _metrics_buffer[IMPORT_ID]
        assert pending.batch_count == batch_count
        assert pending.counts["upload_batches"] == batch_count
        assert pending.counts["assets_staged"] == 5 * batch_count
        assert pending.bytes["assets_staged"] == 1024 * batch_count
        assert abs(pending.timings_ms["file_transfer"] - 10.0 * batch_count) < 0.01

    # 3. Threshold reached: exactly one aggregated RPC with correct totals
    def test_threshold_triggers_single_aggregated_rpc(self):
        from app.analysis_performance import (
            checkpoint_import_metrics, _metrics_buffer, _metrics_lock,
            _METRIC_CHECKPOINT_BATCHES,
        )

        sb = _fake_sb()
        for _ in range(_METRIC_CHECKPOINT_BATCHES):
            checkpoint_import_metrics(sb, IMPORT_ID, _fresh_metrics())

        sb.rpc.assert_called_once()
        rpc_name, rpc_kwargs = sb.rpc.call_args
        # rpc is called as sb.rpc("name", {"p_import_id": ..., "p_metrics": ...})
        assert rpc_name[0] == "merge_rekordbox_import_performance_metrics"
        payload = rpc_name[1]["p_metrics"]
        assert payload["counts"]["upload_batches"] == _METRIC_CHECKPOINT_BATCHES
        assert payload["counts"]["assets_staged"] == 5 * _METRIC_CHECKPOINT_BATCHES
        assert payload["bytes"]["assets_staged"] == 1024 * _METRIC_CHECKPOINT_BATCHES
        # Buffer entry is removed after a successful flush.
        with _metrics_lock:
            assert IMPORT_ID not in _metrics_buffer

    # 4. Concurrent contributions: no data loss
    def test_concurrent_batches_lose_no_metrics(self):
        from app.analysis_performance import checkpoint_import_metrics, flush_import_metrics

        # Stay below threshold so concurrent threads don't trigger auto-flushes.
        total = 4
        sb = _fake_sb()
        errors: list[Exception] = []

        def contribute():
            try:
                checkpoint_import_metrics(sb, IMPORT_ID, _fresh_metrics())
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=contribute) for _ in range(total)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors

        flush_import_metrics(sb, IMPORT_ID)

        total_batches_flushed = sum(
            c[0][1]["p_metrics"]["counts"].get("upload_batches", 0)
            for c in sb.rpc.call_args_list
        )
        assert total_batches_flushed == total

    # 5. Isolated import IDs
    def test_different_import_ids_are_isolated(self):
        from app.analysis_performance import checkpoint_import_metrics, _metrics_buffer, _metrics_lock

        other_id = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"
        with _metrics_lock:
            _metrics_buffer.pop(other_id, None)

        try:
            sb = _fake_sb()
            checkpoint_import_metrics(sb, IMPORT_ID, _fresh_metrics())
            checkpoint_import_metrics(sb, other_id, _fresh_metrics())

            with _metrics_lock:
                assert IMPORT_ID in _metrics_buffer
                assert other_id in _metrics_buffer
                assert _metrics_buffer[IMPORT_ID] is not _metrics_buffer[other_id]
                assert _metrics_buffer[IMPORT_ID].counts["assets_staged"] == 5
                assert _metrics_buffer[other_id].counts["assets_staged"] == 5
        finally:
            with _metrics_lock:
                _metrics_buffer.pop(other_id, None)

    # 6. Force flush: writes once, clears buffer; second call is idempotent
    def test_force_flush_writes_once_and_clears_buffer(self):
        from app.analysis_performance import (
            checkpoint_import_metrics, flush_import_metrics, _metrics_buffer, _metrics_lock,
        )

        sb = _fake_sb()
        checkpoint_import_metrics(sb, IMPORT_ID, _fresh_metrics())
        checkpoint_import_metrics(sb, IMPORT_ID, _fresh_metrics())

        sb.rpc.assert_not_called()

        flush_import_metrics(sb, IMPORT_ID)

        sb.rpc.assert_called_once()
        payload = sb.rpc.call_args[0][1]["p_metrics"]
        assert payload["counts"]["upload_batches"] == 2

        with _metrics_lock:
            assert IMPORT_ID not in _metrics_buffer

        # Second flush is idempotent: no buffer entry → no RPC.
        flush_import_metrics(sb, IMPORT_ID)
        assert sb.rpc.call_count == 1

    # 7. Supabase RPC failure: checkpoint_import_metrics never raises
    #    (merge_import_metrics swallows the exception; the detached payload is lost)
    def test_rpc_failure_does_not_raise_from_checkpoint(self):
        from app.analysis_performance import (
            checkpoint_import_metrics, _metrics_buffer, _metrics_lock,
            _METRIC_CHECKPOINT_BATCHES,
        )

        sb = _fake_sb()
        sb.rpc.return_value.execute.side_effect = RuntimeError("PostgREST connection refused")

        # Should not raise even though RPC fails.
        for _ in range(_METRIC_CHECKPOINT_BATCHES):
            checkpoint_import_metrics(sb, IMPORT_ID, _fresh_metrics())

        # The RPC was attempted at least once.
        assert sb.rpc.call_count >= 1

    # 7b. Same guarantee via flush_import_metrics: never raises on RPC failure.
    def test_flush_rpc_failure_does_not_raise(self):
        from app.analysis_performance import checkpoint_import_metrics, flush_import_metrics

        sb = _fake_sb()
        sb.rpc.return_value.execute.side_effect = RuntimeError("connection refused")

        checkpoint_import_metrics(sb, IMPORT_ID, _fresh_metrics())
        flush_import_metrics(sb, IMPORT_ID)  # must not raise

        assert sb.rpc.call_count == 1

    # 8. complete_analysis_import() calls flush_import_metrics before Stage 3
    def test_complete_calls_flush_before_stage3(self, monkeypatch):
        import app.analysis_performance as perf_mod

        flush_calls: list[str] = []

        def fake_flush(sb_arg, import_id: str) -> None:
            flush_calls.append(import_id)

        monkeypatch.setattr(perf_mod, "flush_import_metrics", fake_flush)

        fake_sb = _fake_sb()
        import_row = {
            "id": IMPORT_ID,
            "user_id": USER_ID,
            "status": "uploading",
            "analysis_status": "awaiting_upload",
            "optional_archival_file_count": 0,
            "analysis_expected_track_count": 0,
            "analysis_parsed_track_count": 0,
        }

        with (
            patch("app.analysis_import_service._create_supabase", return_value=fake_sb),
            patch("app.analysis_import_service._require_import_for_user", return_value=import_row),
            patch("app.analysis_import_service._invalidate_path_map_cache"),
            patch("app.analysis_import_service._pending_analysis_track_ids", return_value=[]),
            patch("app.analysis_import_service._summarize_track_states", return_value={}),
            patch(
                "app.analysis_import_service._terminal_analysis_summary",
                return_value={
                    "final_status": "completed",
                    "total_tracks": 0,
                    "completed_count": 0,
                    "partial_count": 0,
                    "failed_count": 0,
                    "missing_required_count": 0,
                },
            ),
            patch(
                "app.analysis_import_service._resolve_optional_archival_status",
                return_value="skipped",
            ),
            patch("app.analysis_import_service._now_iso", return_value="2026-01-01T00:00:00Z"),
        ):
            from app.analysis_import_service import complete_analysis_import
            asyncio.run(
                complete_analysis_import(IMPORT_ID, USER_ID, background=True)
            )

        assert IMPORT_ID in flush_calls

    # 9a. Existing direct merge_import_metrics() callers still work with ImportMetrics
    def test_direct_merge_import_metrics_with_metrics_object(self):
        from app.analysis_performance import ImportMetrics, merge_import_metrics

        sb = _fake_sb()
        m = ImportMetrics(IMPORT_ID)
        m.timings_ms["database_parse"] = 42.0
        m.counts["library_tracks"] = 100

        merge_import_metrics(sb, IMPORT_ID, m)

        sb.rpc.assert_called_once_with(
            "merge_rekordbox_import_performance_metrics",
            {"p_import_id": IMPORT_ID, "p_metrics": m.payload()},
        )

    # 9b. Existing direct merge_import_metrics() callers still work with dict payload
    def test_direct_merge_import_metrics_with_dict_payload(self):
        from app.analysis_performance import merge_import_metrics

        sb = _fake_sb()
        payload = {"timings_ms": {"t": 1.0}, "counts": {"c": 2}, "bytes": {}}
        merge_import_metrics(sb, IMPORT_ID, payload)

        sb.rpc.assert_called_once()
        assert sb.rpc.call_args[0][1]["p_metrics"] == payload
