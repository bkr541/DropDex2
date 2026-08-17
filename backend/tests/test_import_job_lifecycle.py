from __future__ import annotations

import asyncio
import io
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile

from app import import_jobs
from app.import_service import run_import
from app.upload_stream import stream_upload_to_temp


class TrackingUpload:
    def __init__(self, data: bytes, filename: str = "exportLibrary.db"):
        self._data = data
        self.filename = filename
        self._offset = 0
        self.read_sizes: list[int] = []
        self.closed = False

    async def read(self, size: int = -1) -> bytes:
        self.read_sizes.append(size)
        if self._offset >= len(self._data):
            return b""
        end = len(self._data) if size < 0 else min(len(self._data), self._offset + size)
        chunk = self._data[self._offset : end]
        self._offset = end
        return chunk

    async def close(self) -> None:
        self.closed = True


@pytest.mark.asyncio
async def test_streaming_upload_is_memory_bounded_and_cleans_oversize(tmp_path, monkeypatch):
    monkeypatch.setattr("app.upload_stream.tempfile.tempdir", str(tmp_path))
    upload = TrackingUpload(b"x" * 13)

    with pytest.raises(HTTPException) as exc:
        await stream_upload_to_temp(upload, max_bytes=8, suffix=".db", chunk_bytes=4)

    assert exc.value.status_code == 413
    assert exc.value.detail["error_code"] == "UPLOAD_TOO_LARGE"
    assert max(upload.read_sizes) == 4
    assert upload.closed is True
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_streaming_upload_cancellation_cleans_temp_file(tmp_path, monkeypatch):
    monkeypatch.setattr("app.upload_stream.tempfile.tempdir", str(tmp_path))
    upload = TrackingUpload(b"x" * 20)
    checks = 0

    def cancelled() -> bool:
        nonlocal checks
        checks += 1
        return checks > 2

    with pytest.raises(HTTPException) as exc:
        await stream_upload_to_temp(
            upload,
            max_bytes=100,
            suffix=".db",
            chunk_bytes=4,
            cancellation_requested=cancelled,
        )

    assert exc.value.detail["error_code"] == "IMPORT_CANCELLED"
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_database_import_cancellation_during_upload_stops_before_parse(tmp_path, monkeypatch):
    monkeypatch.setattr("app.upload_stream.tempfile.tempdir", str(tmp_path))
    monkeypatch.setattr("app.import_service.transition_import_job", lambda *_a, **_k: {})
    monkeypatch.setattr("app.import_service.assert_import_not_cancelled", lambda *_a, **_k: None)
    parser_called = False

    def fail_if_parsed(_path):
        nonlocal parser_called
        parser_called = True
        raise AssertionError("cancelled upload must not be parsed")

    checks = 0

    def cancelled(_import_id):
        nonlocal checks
        checks += 1
        return checks > 1

    monkeypatch.setattr("app.import_service.parse_library", fail_if_parsed)
    monkeypatch.setattr("app.import_service.local_cancellation_requested", cancelled)
    upload = TrackingUpload(b"x" * (2 * 1024 * 1024))

    with pytest.raises(HTTPException) as exc:
        await run_import(upload, "u", import_id="job-upload-request")

    assert exc.value.detail["error_code"] == "IMPORT_CANCELLED"
    assert parser_called is False
    assert upload.closed is True
    assert max(upload.read_sizes) <= 1024 * 1024
    assert list(tmp_path.iterdir()) == []


class FakeQuery:
    def __init__(self, client, table: str):
        self.client = client
        self.table = table
        self.action = "select"
        self.payload = None
        self.filters: list[tuple[str, object]] = []
        self.in_filter: tuple[str, list[object]] | None = None

    def select(self, *_args):
        self.action = "select"
        return self

    def insert(self, payload):
        self.action = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.action = "update"
        self.payload = payload
        return self

    def delete(self):
        self.action = "delete"
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def in_(self, key, values):
        self.in_filter = (key, list(values))
        return self

    def maybe_single(self):
        return self

    def _matches(self, row):
        return all(row.get(k) == v for k, v in self.filters) and (
            self.in_filter is None or row.get(self.in_filter[0]) in self.in_filter[1]
        )

    def execute(self):
        rows = self.client.tables.setdefault(self.table, [])
        if self.action == "select":
            matches = [dict(r) for r in rows if self._matches(r)]
            return SimpleNamespace(
                data=(matches[0] if "id" in dict(self.filters) and len(matches) <= 1 else matches)
            )
        if self.action == "insert":
            row = dict(self.payload)
            row.setdefault("id", f"job-{len(rows) + 1}")
            rows.append(row)
            return SimpleNamespace(data=[dict(row)])
        if self.action == "update":
            changed = []
            for row in rows:
                if self._matches(row):
                    row.update(self.payload)
                    changed.append(dict(row))
            return SimpleNamespace(data=changed)
        if self.action == "delete":
            self.client.tables[self.table] = [r for r in rows if not self._matches(r)]
            return SimpleNamespace(data=[])
        raise AssertionError(self.action)


class FakeStorageBucket:
    def remove(self, _paths):
        return None


class FakeStorage:
    def from_(self, _bucket):
        return FakeStorageBucket()


class FakeRpc:
    def __init__(self, client, name: str, payload: dict):
        self.client = client
        self.name = name
        self.payload = payload

    def execute(self):
        if self.name != "hard_delete_rekordbox_import":
            raise AssertionError(self.name)
        import_id = self.payload["p_import_id"]
        user_id = self.payload["p_user_id"]
        strategy = self.payload["p_active_strategy"]
        imports = self.client.tables.setdefault("rekordbox_imports", [])
        target = next((row for row in imports if row.get("id") == import_id and row.get("user_id") == user_id), None)
        if target is None:
            raise RuntimeError("Import not found")

        settings = self.client.tables.setdefault("rekordbox_user_settings", [])
        settings_row = next((row for row in settings if row.get("user_id") == user_id), None)
        usable = {"completed", "paused", "interrupted"}
        if settings_row is not None:
            effective_active = settings_row.get("active_import_id")
        else:
            effective_active = next((row.get("id") for row in imports if row.get("user_id") == user_id and row.get("status") in usable), None)

        self.client.tables["rekordbox_imports"] = [
            row for row in imports if not (row.get("id") == import_id and row.get("user_id") == user_id)
        ]
        for table, rows in list(self.client.tables.items()):
            if table in {"rekordbox_imports", "rekordbox_user_settings"}:
                continue
            self.client.tables[table] = [row for row in rows if row.get("import_id") != import_id]

        next_active = effective_active
        if effective_active == import_id:
            if strategy == "activate_next":
                next_active = next((
                    row.get("id")
                    for row in self.client.tables["rekordbox_imports"]
                    if row.get("user_id") == user_id and row.get("status") in usable
                ), None)
            else:
                next_active = None
            if settings_row is None:
                settings_row = {"user_id": user_id}
                settings.append(settings_row)
            settings_row["active_import_id"] = next_active

        return SimpleNamespace(data=next_active)


class FakeClient:
    def __init__(self, rows):
        self.tables = {"rekordbox_imports": rows}
        self.storage = FakeStorage()

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, name, payload):
        return FakeRpc(self, name, payload)


def test_cancel_during_upload_hard_deletes_import(monkeypatch):
    client = FakeClient([{"id": "job-upload", "user_id": "u", "status": "uploading"}])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    result = import_jobs.cancel_import_job("job-upload", "u")

    assert result["status"] == "cancelled"
    assert client.tables["rekordbox_imports"] == []


def test_cancel_during_processing_hard_deletes_import(monkeypatch):
    client = FakeClient([{"id": "job-1", "user_id": "u", "status": "processing"}])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    result = import_jobs.cancel_import_job("job-1", "u")

    assert result["status"] == "cancelled"
    assert client.tables["rekordbox_imports"] == []


def test_pause_before_worker_start_is_idempotent_and_preserves_data(monkeypatch):
    import_id = "job-pause-before-start"
    client = FakeClient([
        {
            "id": import_id,
            "user_id": "u",
            "status": "processing",
            "analysis_status": "parsing",
        }
    ])
    client.tables["rekordbox_tracks"] = [{"id": "track-1", "import_id": import_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    first = import_jobs.pause_import_analysis(import_id, "u", wait_timeout_seconds=0)
    second = import_jobs.pause_import_analysis(import_id, "u", wait_timeout_seconds=0)

    assert first["status"] == "paused"
    assert second["status"] == "paused"
    assert client.tables["rekordbox_tracks"] == [{"id": "track-1", "import_id": import_id}]


def test_delete_waits_for_worker_acknowledgement_before_cleanup(monkeypatch):
    import_id = "job-delete-waits"
    client = FakeClient([
        {
            "id": import_id,
            "user_id": "u",
            "status": "processing",
            "analysis_status": "parsing",
        }
    ])
    client.tables["rekordbox_tracks"] = [{"id": "track-1", "import_id": import_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)
    import_jobs.worker_registry.register(import_id)

    def acknowledge() -> None:
        time.sleep(0.02)
        import_jobs.worker_registry.acknowledge_stopped(import_id, status="stopped")

    thread = threading.Thread(target=acknowledge)
    thread.start()
    row = import_jobs.delete_import_job(import_id, "u", wait_timeout_seconds=0.2)
    thread.join()

    assert row["status"] == "cancelled"
    assert client.tables["rekordbox_tracks"] == []
    assert client.tables["rekordbox_imports"] == []


def test_delete_timeout_never_races_cleanup(monkeypatch):
    import_id = "job-delete-timeout"
    client = FakeClient([
        {
            "id": import_id,
            "user_id": "u",
            "status": "processing",
            "analysis_status": "parsing",
        }
    ])
    client.tables["rekordbox_tracks"] = [{"id": "track-1", "import_id": import_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)
    monkeypatch.setattr(import_jobs, "_schedule_delete_finalizer", lambda *_a, **_k: None)
    import_jobs.worker_registry.register(import_id)

    row = import_jobs.delete_import_job(import_id, "u", wait_timeout_seconds=0)

    assert row["status"] == "stopping"
    assert row["analysis_worker_stopped_acknowledged"] is False
    assert client.tables["rekordbox_tracks"] == [{"id": "track-1", "import_id": import_id}]
    import_jobs.worker_registry.acknowledge_stopped(import_id, status="stopped")


def test_repeated_pause_while_worker_is_stopping_is_idempotent(monkeypatch):
    import_id = "job-pause-stopping-repeat"
    client = FakeClient([
        {
            "id": import_id,
            "user_id": "u",
            "status": "processing",
            "analysis_status": "parsing",
        }
    ])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)
    import_jobs.worker_registry.register(import_id)

    first = import_jobs.pause_import_analysis(import_id, "u", wait_timeout_seconds=0)
    second = import_jobs.pause_import_analysis(import_id, "u", wait_timeout_seconds=0)

    assert first["status"] == "stopping"
    assert second["status"] == "stopping"
    assert second["analysis_worker_status"] == "stopping"
    import_jobs.worker_registry.acknowledge_stopped(import_id, status="paused")


def test_repeated_delete_while_worker_is_stopping_is_idempotent(monkeypatch):
    import_id = "job-delete-stopping-repeat"
    client = FakeClient([
        {
            "id": import_id,
            "user_id": "u",
            "status": "processing",
            "analysis_status": "parsing",
        }
    ])
    client.tables["rekordbox_tracks"] = [{"id": "track-1", "import_id": import_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)
    monkeypatch.setattr(import_jobs, "_schedule_delete_finalizer", lambda *_a, **_k: None)
    import_jobs.worker_registry.register(import_id)

    first = import_jobs.delete_import_job(import_id, "u", wait_timeout_seconds=0)
    second = import_jobs.delete_import_job(import_id, "u", wait_timeout_seconds=0)

    assert first["status"] == "stopping"
    assert second["status"] == "stopping"
    assert client.tables["rekordbox_tracks"] == [{"id": "track-1", "import_id": import_id}]
    import_jobs.worker_registry.acknowledge_stopped(import_id, status="stopped")


def test_failed_import_can_be_explicitly_deleted(monkeypatch):
    import_id = "job-failed-delete"
    client = FakeClient([
        {
            "id": import_id,
            "user_id": "u",
            "status": "failed",
            "analysis_status": "failed",
        }
    ])
    client.tables["rekordbox_tracks"] = [{"id": "track-1", "import_id": import_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    row = import_jobs.delete_import_job(import_id, "u", wait_timeout_seconds=0)

    assert row["status"] == "cancelled"
    assert client.tables["rekordbox_tracks"] == []
    assert client.tables["rekordbox_imports"] == []


def test_storage_failure_preserves_asset_metadata_for_cleanup_retry(monkeypatch):
    import_id = "job-storage-retry-paths"
    client = FakeClient([
        {
            "id": import_id,
            "user_id": "u",
            "status": "deleting",
            "analysis_status": "stopping",
            "analysis_worker_stopped_acknowledged": True,
        }
    ])
    client.tables["rekordbox_analysis_assets"] = [
        {"id": "asset-1", "import_id": import_id, "storage_path": "u/i/a.dat"}
    ]
    client.tables["rekordbox_tracks"] = [
        {"id": "track-1", "import_id": import_id}
    ]

    class FailingBucket:
        def remove(self, paths):
            assert paths == ["u/i/a.dat"]
            raise RuntimeError("storage offline")

    class FailingStorage:
        def from_(self, _bucket):
            return FailingBucket()

    client.storage = FailingStorage()
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)
    import_jobs.worker_registry.acknowledge_stopped(import_id, status="stopped")

    with pytest.raises(RuntimeError, match="storage offline"):
        import_jobs.cleanup_partial_import(
            import_id,
            "u",
            sb=client,
            require_worker_ack=True,
        )

    assert client.tables["rekordbox_analysis_assets"] == [
        {"id": "asset-1", "import_id": import_id, "storage_path": "u/i/a.dat"}
    ]
    assert client.tables["rekordbox_tracks"] == [
        {"id": "track-1", "import_id": import_id}
    ]


def test_delete_cleanup_failure_remains_retryable_and_idempotent(monkeypatch):
    import_id = "job-delete-cleanup-retry"
    client = FakeClient([
        {
            "id": import_id,
            "user_id": "u",
            "status": "failed",
            "analysis_status": "failed",
        }
    ])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)
    monkeypatch.setattr(
        import_jobs,
        "cleanup_partial_import",
        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("storage unavailable")),
    )

    with pytest.raises(HTTPException) as exc:
        import_jobs.delete_import_job(import_id, "u", wait_timeout_seconds=0)

    assert exc.value.status_code == 503
    row = client.tables["rekordbox_imports"][0]
    assert row["status"] == "deleting"
    assert row["error_code"] == "DELETE_CLEANUP_FAILED"
    assert row["retryable"] is True

    monkeypatch.setattr(import_jobs, "cleanup_partial_import", lambda *_a, **_k: None)
    retried = import_jobs.delete_import_job(import_id, "u", wait_timeout_seconds=0)
    assert retried["status"] == "cancelled"
    assert client.tables["rekordbox_imports"] == []


def test_delete_removes_associated_analysis_children_before_parent_hard_delete(monkeypatch):
    import_id = "job-analysis-delete"
    client = FakeClient([{"id": import_id, "user_id": "u", "status": "completed"}])
    client.tables["rekordbox_tracks"] = [{"id": "track-1", "import_id": import_id}]
    client.tables["rekordbox_cues"] = [{"id": "cue-1", "import_id": import_id}]
    client.tables["rekordbox_track_beat_grids"] = [{"id": "grid-1", "import_id": import_id}]
    client.tables["rekordbox_track_waveforms"] = [{"id": "wave-1", "import_id": import_id}]
    client.tables["rekordbox_track_phrases"] = [{"id": "phrase-1", "import_id": import_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    import_jobs.delete_import_job(import_id, "u", wait_timeout_seconds=0)

    assert client.tables["rekordbox_imports"] == []
    assert client.tables["rekordbox_tracks"] == []
    assert client.tables["rekordbox_cues"] == []
    assert client.tables["rekordbox_track_beat_grids"] == []
    assert client.tables["rekordbox_track_waveforms"] == []
    assert client.tables["rekordbox_track_phrases"] == []


def test_hard_delete_finalization_failure_keeps_retryable_visible_import(monkeypatch):
    import_id = "job-finalize-retry"

    class FinalizeFailClient(FakeClient):
        def rpc(self, name, payload):
            class Failure:
                def execute(self):
                    raise RuntimeError("database finalize unavailable")
            return Failure()

    client = FinalizeFailClient([{"id": import_id, "user_id": "u", "status": "failed"}])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    with pytest.raises(HTTPException) as exc:
        import_jobs.delete_import_job(import_id, "u", wait_timeout_seconds=0)

    assert exc.value.status_code == 503
    row = client.tables["rekordbox_imports"][0]
    assert row["status"] == "deleting"
    assert row["error_code"] == "DELETE_FINALIZE_FAILED"
    assert row["retryable"] is True


def test_delete_active_library_activates_newest_remaining_usable_snapshot(monkeypatch):
    active_id = "job-active"
    fallback_id = "job-fallback"
    client = FakeClient([
        {"id": active_id, "user_id": "u", "status": "completed"},
        {"id": fallback_id, "user_id": "u", "status": "paused"},
        {"id": "job-failed", "user_id": "u", "status": "failed"},
    ])
    client.tables["rekordbox_user_settings"] = [{"user_id": "u", "active_import_id": active_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    result = import_jobs.delete_import_job(active_id, "u", wait_timeout_seconds=0, active_strategy="activate_next")

    assert result["status"] == "cancelled"
    assert {row["id"] for row in client.tables["rekordbox_imports"]} == {fallback_id, "job-failed"}
    assert client.tables["rekordbox_user_settings"][0]["active_import_id"] == fallback_id


def test_delete_active_library_start_over_leaves_explicitly_no_active_library(monkeypatch):
    active_id = "job-active"
    client = FakeClient([
        {"id": active_id, "user_id": "u", "status": "completed"},
        {"id": "job-older", "user_id": "u", "status": "completed"},
    ])
    client.tables["rekordbox_user_settings"] = [{"user_id": "u", "active_import_id": active_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    import_jobs.delete_import_job(active_id, "u", wait_timeout_seconds=0, active_strategy="start_over")

    assert [row["id"] for row in client.tables["rekordbox_imports"]] == ["job-older"]
    assert client.tables["rekordbox_user_settings"][0]["active_import_id"] is None


def test_delete_only_library_returns_to_explicit_empty_state(monkeypatch):
    active_id = "job-only"
    client = FakeClient([{"id": active_id, "user_id": "u", "status": "completed"}])
    client.tables["rekordbox_user_settings"] = [{"user_id": "u", "active_import_id": active_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    import_jobs.delete_import_job(active_id, "u", wait_timeout_seconds=0, active_strategy="start_over")

    assert client.tables["rekordbox_imports"] == []
    assert client.tables["rekordbox_user_settings"][0]["active_import_id"] is None


def test_delete_inactive_snapshot_does_not_change_active_library(monkeypatch):
    active_id = "job-active"
    inactive_id = "job-inactive"
    client = FakeClient([
        {"id": active_id, "user_id": "u", "status": "completed"},
        {"id": inactive_id, "user_id": "u", "status": "completed"},
    ])
    client.tables["rekordbox_user_settings"] = [{"user_id": "u", "active_import_id": active_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    import_jobs.delete_import_job(inactive_id, "u", wait_timeout_seconds=0, active_strategy="start_over")

    assert [row["id"] for row in client.tables["rekordbox_imports"]] == [active_id]
    assert client.tables["rekordbox_user_settings"][0]["active_import_id"] == active_id


def test_invalid_delete_active_strategy_is_rejected_before_mutation(monkeypatch):
    client = FakeClient([{"id": "job-1", "user_id": "u", "status": "completed"}])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    with pytest.raises(HTTPException) as exc:
        import_jobs.delete_import_job("job-1", "u", active_strategy="surprise")

    assert exc.value.status_code == 422
    assert client.tables["rekordbox_imports"][0]["id"] == "job-1"


def test_late_pause_acknowledgement_persists_resumable_state(monkeypatch):
    import_id = "job-late-pause"
    client = FakeClient([
        {
            "id": import_id,
            "user_id": "u",
            "status": "stopping",
            "analysis_status": "stopping",
            "analysis_worker_stopped_acknowledged": False,
        }
    ])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)
    import_jobs.worker_registry.register(import_id)
    import_jobs.worker_registry.acknowledge_stopped(import_id, status="paused")

    row = import_jobs.finalize_paused_import(import_id, "u")

    assert row["status"] == "paused"
    assert row["analysis_status"] == "paused"
    assert row["analysis_worker_stopped_acknowledged"] is True


def test_restart_recovery_marks_processing_job_resumable_interrupted(monkeypatch):
    client = FakeClient([{"id": "job-2", "user_id": "u", "status": "processing"}])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    assert import_jobs.recover_interrupted_import_jobs() == 1
    row = client.tables["rekordbox_imports"][0]
    assert row["status"] == "interrupted"
    assert row["analysis_status"] == "interrupted"
    assert row["analysis_worker_stopped_acknowledged"] is True
    assert row["error_code"] == "ANALYSIS_INTERRUPTED"
    assert row["retryable"] is True


def test_restart_recovery_preserves_completed_snapshot_as_resumable(monkeypatch):
    client = FakeClient([
        {
            "id": "job-analysis-restart",
            "user_id": "u",
            "status": "completed",
            "analysis_status": "parsing",
            "analysis_expected_track_count": 20,
            "analysis_parsed_track_count": 0,
            "analysis_failed_track_count": 0,
            "analysis_current_track_label": "Current Track",
        }
    ])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    assert import_jobs.recover_interrupted_import_jobs() == 1
    row = client.tables["rekordbox_imports"][0]
    assert row["status"] == "completed"
    assert row["analysis_status"] == "interrupted"
    assert row["analysis_worker_status"] == "interrupted"
    assert row["analysis_worker_stopped_acknowledged"] is True
    assert row["analysis_current_track_label"] is None
    assert row["error_code"] == "ANALYSIS_INTERRUPTED"
    assert row["retryable"] is True


def test_restart_preserves_delete_intent_without_cleaning_data(monkeypatch):
    import_id = "job-delete-restart"
    client = FakeClient([
        {
            "id": import_id,
            "user_id": "u",
            "status": "stopping",
            "analysis_status": "stopping",
            "analysis_worker_status": "cancel_requested",
        }
    ])
    client.tables["rekordbox_tracks"] = [{"id": "track-1", "import_id": import_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    assert import_jobs.recover_interrupted_import_jobs() == 1
    row = client.tables["rekordbox_imports"][0]
    assert row["status"] == "stopping"
    assert row["analysis_status"] == "stopping"
    assert row["analysis_worker_status"] == "stopped"
    assert row["analysis_worker_stopped_acknowledged"] is True
    assert row["error_code"] == "DELETE_INTERRUPTED"
    assert row["retryable"] is True
    assert client.tables["rekordbox_tracks"] == [{"id": "track-1", "import_id": import_id}]


def test_failed_transition_terminates_stale_analysis_progress(monkeypatch):
    client = FakeClient([
        {
            "id": "job-analysis-fail",
            "user_id": "u",
            "status": "processing",
            "analysis_status": "parsing",
            "analysis_current_track_id": "track-1",
            "analysis_current_track_title": "Current Song",
            "analysis_current_track_artist": "Current Artist",
            "analysis_current_track_label": "Current Artist - Current Song",
        }
    ])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    import_jobs.mark_import_failed(
        "job-analysis-fail",
        "u",
        error_code="ANALYSIS_FAILED",
        message="Parser stopped.",
        retryable=True,
    )

    row = client.tables["rekordbox_imports"][0]
    assert row["status"] == "failed"
    assert row["analysis_status"] == "failed"
    assert row["analysis_completed_at"]
    assert row["analysis_current_track_id"] is None
    assert row["analysis_current_track_label"] is None
    assert row["retryable"] is True


def test_completed_transition_clears_old_error_and_live_track(monkeypatch):
    client = FakeClient([
        {
            "id": "job-complete",
            "user_id": "u",
            "status": "processing",
            "analysis_status": "completed",
            "analysis_expected_track_count": 12,
            "analysis_parsed_track_count": 12,
            "analysis_failed_track_count": 0,
            "analysis_current_track_id": "track-12",
            "analysis_current_track_label": "Last Track",
            "error_code": "OLD_ERROR",
            "error_message": "Old failure",
            "retryable": True,
        }
    ])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    row = import_jobs.complete_import_job("job-complete", "u")

    assert row["status"] == "completed"
    assert row["analysis_status"] == "completed"
    assert row["analysis_current_track_id"] is None
    assert row["analysis_current_track_label"] is None
    assert row["error_code"] is None
    assert row["error_message"] is None
    assert row["retryable"] is False


def test_completed_transition_normalizes_legacy_active_analysis(monkeypatch):
    client = FakeClient([
        {
            "id": "job-legacy-complete",
            "user_id": "u",
            "status": "processing",
            "analysis_status": "parsing",
            "analysis_expected_track_count": 8,
            "analysis_parsed_track_count": 8,
            "analysis_failed_track_count": 0,
        }
    ])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    row = import_jobs.complete_import_job("job-legacy-complete", "u")

    assert row["status"] == "completed"
    assert row["analysis_status"] == "completed"
    assert row["analysis_completed_at"]


def test_completed_transition_preserves_explicit_partial_analysis(monkeypatch):
    client = FakeClient([
        {
            "id": "job-partial-complete",
            "user_id": "u",
            "status": "processing",
            "analysis_status": "partial",
            "analysis_expected_track_count": 8,
            "analysis_parsed_track_count": 8,
            "analysis_failed_track_count": 0,
        }
    ])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    row = import_jobs.complete_import_job("job-partial-complete", "u")

    assert row["status"] == "completed"
    assert row["analysis_status"] == "partial"


@pytest.mark.asyncio
async def test_database_processing_does_not_block_event_loop(monkeypatch):
    library = SimpleNamespace(
        device_name=None,
        source_filename="exportLibrary.db",
        tracks=[],
        playlists=[],
        placements=[],
        analysis_manifest=[],
    )

    def slow_parse(_path):
        time.sleep(0.12)
        return library

    monkeypatch.setattr("app.import_service.parse_library", slow_parse)
    monkeypatch.setattr(
        "app.import_service.validate", lambda _library: SimpleNamespace(ok=True, errors=[])
    )
    monkeypatch.setattr(
        "app.import_service._write_library",
        lambda *_args: SimpleNamespace(import_id="done"),
    )
    monkeypatch.setattr("app.import_service.upsert_active_import", lambda *_args: None)

    ticks = 0

    async def heartbeat():
        nonlocal ticks
        for _ in range(8):
            await asyncio.sleep(0.02)
            ticks += 1

    upload = UploadFile(filename="exportLibrary.db", file=io.BytesIO(b"db"))
    await asyncio.gather(run_import(upload, "u"), heartbeat())
    assert ticks >= 4
