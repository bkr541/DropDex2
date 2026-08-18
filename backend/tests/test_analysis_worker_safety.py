from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app import analysis_import_service
from app.import_worker_registry import WorkerStopRequested, worker_registry


def _job_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4()}"


@pytest.mark.parametrize(
    "stage",
    [
        "before_loading_assets",
        "before_downloading_assets",
        "downloading_asset",
        "after_downloading_assets",
        "before_parsing",
        "after_parsing",
        "before_writing_beat_grid",
        "after_writing_beat_grid",
        "before_writing_waveform",
        "after_writing_waveform",
        "before_writing_cues",
        "after_writing_cues",
        "before_writing_phrases",
        "after_writing_phrases",
        "after_track_completed",
        "before_next_track",
    ],
)
def test_pause_is_observed_at_every_costly_or_write_checkpoint(stage):
    import_id = _job_id("pause-stage")
    worker_registry.register(import_id)
    worker_registry.request_stop(import_id, "pause")

    with pytest.raises(WorkerStopRequested) as exc:
        worker_registry.checkpoint(import_id, stage, current_track_id="track-1")

    assert exc.value.reason == "pause"
    assert exc.value.stage == stage
    worker_registry.acknowledge_stopped(import_id, status="paused")


def test_resume_selects_only_incomplete_tracks():
    tracks = [
        {"id": "completed", "analysis_parse_status": "completed"},
        {"id": "partial", "analysis_parse_status": "partial"},
        {"id": "reused", "analysis_parse_status": "reused"},
        {"id": "failed", "analysis_parse_status": "failed"},
        {"id": "unwritten", "analysis_parse_status": None},
    ]

    selected = analysis_import_service._select_tracks_for_analysis(tracks)

    assert [track["id"] for track in selected] == ["failed", "unwritten"]
    assert [
        track["id"]
        for track in analysis_import_service._select_tracks_for_analysis(
            tracks,
            ["completed", "failed"],
        )
    ] == ["failed"]


def test_worker_failure_publishes_diagnostics_without_cleanup(monkeypatch):
    import_id = _job_id("worker-failure")
    published: list[dict] = []
    cleanup_called = False

    def fail_analysis(*_args, **_kwargs):
        raise RuntimeError("parser exploded safely")

    def publish(*_args, **kwargs):
        # The durable final worker write must occur before the registry event
        # wakes a destructive delete waiter.
        assert worker_registry.snapshot(import_id)["active"] is True
        published.append(kwargs)
        return {}

    def cleanup(*_args, **_kwargs):
        nonlocal cleanup_called
        cleanup_called = True

    monkeypatch.setattr(analysis_import_service, "_complete_analysis_import_sync", fail_analysis)
    monkeypatch.setattr(analysis_import_service, "publish_worker_state", publish)
    monkeypatch.setattr(analysis_import_service, "cleanup_partial_import", cleanup, raising=False)

    with pytest.raises(RuntimeError, match="parser exploded safely"):
        analysis_import_service._run_complete_analysis_import_sync(import_id, "user")

    snapshot = worker_registry.snapshot(import_id)
    assert snapshot["active"] is False
    assert snapshot["stopped_acknowledged"] is True
    assert snapshot["error"] == "parser exploded safely"
    assert published[-1]["status"] == "failed"
    assert published[-1]["error"] == "parser exploded safely"
    assert cleanup_called is False


def test_worker_finalizes_a_pause_after_the_api_wait_window(monkeypatch):
    import_id = _job_id("late-pause")
    finalized: list[tuple[str, str]] = []

    def stop_at_checkpoint(*_args, **_kwargs):
        worker_registry.request_stop(import_id, "pause")
        worker_registry.checkpoint(import_id, "before_parsing", current_track_id="track-1")
        raise AssertionError("checkpoint should have raised")

    monkeypatch.setattr(analysis_import_service, "_complete_analysis_import_sync", stop_at_checkpoint)
    monkeypatch.setattr(analysis_import_service, "publish_worker_state", lambda *_a, **_k: {})
    monkeypatch.setattr(
        analysis_import_service,
        "finalize_paused_import",
        lambda imp, user: finalized.append((imp, user)),
    )

    with pytest.raises(HTTPException) as exc:
        analysis_import_service._run_complete_analysis_import_sync(import_id, "user")

    assert exc.value.status_code == 409
    assert exc.value.detail["error_code"] == "ANALYSIS_PAUSED"
    assert finalized == [(import_id, "user")]
    assert worker_registry.snapshot(import_id)["stopped_acknowledged"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("job_status,analysis_status", [
    ("pause_requested", "pause_requested"),
    ("stopping", "stopping"),
    ("cancel_requested", "stopping"),
])
async def test_resume_waits_for_stopped_acknowledgement(
    monkeypatch, job_status, analysis_status
):
    import_id = _job_id("resume-stopping")
    row = {
        "id": import_id,
        "user_id": "user",
        "status": job_status,
        "analysis_status": analysis_status,
    }
    monkeypatch.setattr(analysis_import_service, "_create_supabase", lambda: object())
    monkeypatch.setattr(
        analysis_import_service,
        "_require_import_for_user",
        lambda *_args, **_kwargs: row,
    )

    with pytest.raises(HTTPException) as exc:
        await analysis_import_service.resume_analysis_import(import_id, "user")

    assert exc.value.status_code == 409
    assert exc.value.detail["error_code"] == "ANALYSIS_STILL_STOPPING"
    assert exc.value.detail["retryable"] is True


def test_fast_background_pause_finalizes_after_durable_lease_release(monkeypatch):
    import_id = _job_id("fast-late-pause")
    events: list[str] = []

    class _Lease:
        def release(self):
            events.append("released")

    def stop_for_pause(*_args, **_kwargs):
        raise WorkerStopRequested(import_id, "pause", "before_parsing")

    monkeypatch.setattr(
        analysis_import_service,
        "_run_fast_analysis_import_sync",
        stop_for_pause,
    )
    monkeypatch.setattr(
        analysis_import_service,
        "finalize_paused_import",
        lambda *_args, **_kwargs: events.append("finalized"),
    )

    analysis_import_service._background_analysis_entry(
        import_id,
        "user",
        ["track-1"],
        _Lease(),
    )

    assert events == ["released", "finalized"]


@pytest.mark.asyncio
async def test_resume_recovers_pre_hardening_processing_failed_worker(monkeypatch):
    """The exact state from the second HAR must be resumable without a reset."""
    import_id = _job_id("stranded-worker")
    sb = __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock()
    row = {
        "id": import_id,
        "user_id": "user",
        "status": "processing",
        "analysis_status": "partial",
        "analysis_worker_status": "failed",
        "analysis_worker_stopped_acknowledged": True,
        "analysis_worker_error": "URL component 'query' too long",
    }
    captured: dict[str, object] = {}

    monkeypatch.setattr(analysis_import_service, "_create_supabase", lambda: sb)
    monkeypatch.setattr(analysis_import_service, "_require_import_for_user", lambda *_: row)
    monkeypatch.setattr(analysis_import_service, "get_worker_lease", lambda *_: None)

    async def complete(import_id_arg, user_id_arg, affected_track_ids=None, **kwargs):
        captured.update(
            import_id=import_id_arg,
            user_id=user_id_arg,
            affected_track_ids=affected_track_ids,
            background=kwargs.get("background"),
        )
        return "resumed"

    monkeypatch.setattr(analysis_import_service, "complete_analysis_import", complete)

    result = await analysis_import_service.resume_analysis_import(
        import_id,
        "user",
        background=True,
    )

    assert result == "resumed"
    payload = sb.table.return_value.update.call_args.args[0]
    assert payload["status"] == "processing"
    assert payload["analysis_status"] == "queued"
    assert payload["analysis_worker_error"] is None
    assert captured["affected_track_ids"] is None
    assert captured["background"] is True


def test_fast_worker_failure_recounts_and_persists_interrupted_state(monkeypatch):
    from app import analysis_fast_pipeline as fast
    from unittest.mock import MagicMock

    import_id = _job_id("fast-worker-failure")
    sb = MagicMock()
    sb.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
    monkeypatch.setattr(analysis_import_service, "_create_supabase", lambda: sb)
    monkeypatch.setattr(
        analysis_import_service,
        "_require_import_for_user",
        lambda *_: {"analysis_queue_track_count": 2_213},
    )
    monkeypatch.setattr(analysis_import_service, "publish_worker_state", lambda *_a, **_k: {})
    monkeypatch.setattr(
        analysis_import_service,
        "_pending_analysis_track_ids",
        lambda *_: [f"track-{index}" for index in range(2_213)],
    )
    monkeypatch.setattr(
        fast,
        "run_fast_analysis_import",
        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("synthetic worker failure")),
    )

    with pytest.raises(RuntimeError, match="synthetic worker failure"):
        analysis_import_service._run_fast_analysis_import_sync(import_id, "user")

    payloads = [call.args[0] for call in sb.table.return_value.update.call_args_list]
    failure = next(payload for payload in payloads if payload.get("error_code") == "ANALYSIS_WORKER_FAILED")
    assert failure["status"] == "interrupted"
    assert failure["analysis_status"] == "interrupted"
    assert failure["analysis_queue_track_count"] == 2_213
    assert failure["analysis_running_track_count"] == 0
    assert failure["analysis_worker_error"] == "synthetic worker failure"


def test_startup_recovery_requeues_interrupted_job_before_start(monkeypatch):
    from app import supabase_pagination
    from unittest.mock import MagicMock

    sb = MagicMock()
    sb.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
    row = {
        "id": "import-recover",
        "user_id": "user",
        "status": "interrupted",
        "analysis_status": "interrupted",
        "analysis_worker_status": "failed",
        "analysis_worker_stopped_acknowledged": True,
    }
    started: list[tuple[str, str, object]] = []

    monkeypatch.setattr(analysis_import_service, "_create_supabase", lambda: sb)
    monkeypatch.setattr(supabase_pagination, "fetch_all_rows", lambda *_a, **_k: [row])
    monkeypatch.setattr(analysis_import_service, "get_worker_lease", lambda *_a, **_k: None)
    monkeypatch.setattr(
        analysis_import_service,
        "_start_background_analysis",
        lambda import_id, user_id, affected: started.append((import_id, user_id, affected)) or True,
    )

    count = analysis_import_service.resume_recoverable_analysis_imports()

    assert count == 1
    assert started == [("import-recover", "user", None)]
    payload = sb.table.return_value.update.call_args.args[0]
    assert payload["status"] == "processing"
    assert payload["analysis_status"] == "queued"
    assert payload["analysis_worker_stage"] == "startup_resume_queued"
    assert payload["analysis_worker_error"] is None


def test_startup_recovery_does_not_stomp_an_active_durable_worker(monkeypatch):
    from app import supabase_pagination
    from unittest.mock import MagicMock

    sb = MagicMock()
    row = {
        "id": "import-owned-elsewhere",
        "user_id": "user",
        "status": "interrupted",
        "analysis_status": "interrupted",
        "analysis_worker_status": "failed",
        "analysis_worker_stopped_acknowledged": True,
    }
    started: list[str] = []

    monkeypatch.setattr(analysis_import_service, "_create_supabase", lambda: sb)
    monkeypatch.setattr(supabase_pagination, "fetch_all_rows", lambda *_a, **_k: [row])
    monkeypatch.setattr(
        analysis_import_service,
        "get_worker_lease",
        lambda *_a, **_k: {"lease_expires_at": "2999-01-01T00:00:00+00:00"},
    )
    monkeypatch.setattr(
        analysis_import_service,
        "_start_background_analysis",
        lambda *_a, **_k: started.append("started") or True,
    )

    assert analysis_import_service.resume_recoverable_analysis_imports() == 0
    assert started == []
    assert sb.table.return_value.update.call_count == 0
