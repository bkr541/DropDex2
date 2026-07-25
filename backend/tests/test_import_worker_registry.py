from __future__ import annotations

import threading
import time

import pytest

from app.import_worker_registry import ImportWorkerRegistry, WorkerStopRequested


def test_pause_before_worker_starts_is_seen_at_first_checkpoint():
    registry = ImportWorkerRegistry()
    registry.request_stop("job", "pause")
    registry.register("job")
    with pytest.raises(WorkerStopRequested) as exc:
        registry.checkpoint("job", "before_download", current_track_id="track")
    assert exc.value.reason == "pause"


def test_delete_waits_for_worker_acknowledgement():
    registry = ImportWorkerRegistry()
    registry.register("job")

    def worker():
        while True:
            try:
                registry.checkpoint("job", "writing_waveform")
                time.sleep(0.01)
            except WorkerStopRequested:
                registry.acknowledge_stopped("job", status="cancelled")
                return

    thread = threading.Thread(target=worker)
    thread.start()
    registry.request_stop("job", "delete")
    assert registry.wait_for_stopped("job", 1.0) is True
    thread.join(timeout=1.0)
    assert registry.snapshot("job")["stopped_acknowledged"] is True


def test_timeout_does_not_forge_stopped_acknowledgement():
    registry = ImportWorkerRegistry()
    registry.register("job")
    registry.request_stop("job", "delete")
    assert registry.wait_for_stopped("job", 0.01) is False
    snapshot = registry.snapshot("job")
    assert snapshot["active"] is True
    assert snapshot["stopped_acknowledged"] is False


def test_repeated_pause_and_delete_requests_are_idempotent_and_delete_wins():
    registry = ImportWorkerRegistry()
    registry.request_stop("job", "pause")
    registry.request_stop("job", "pause")
    registry.request_stop("job", "delete")
    registry.request_stop("job", "delete")
    assert registry.snapshot("job")["stop_reason"] == "delete"
