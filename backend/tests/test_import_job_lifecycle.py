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
        self.filters: list[tuple[str, str, object]] = []
        self.order_column: str | None = None
        self.range_start: int | None = None
        self.range_end: int | None = None
        self.single = False

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
        self.filters.append(("eq", key, value))
        return self

    def neq(self, key, value):
        self.filters.append(("neq", key, value))
        return self

    def in_(self, key, values):
        self.filters.append(("in", key, list(values)))
        return self

    def order(self, column, *_args, **_kwargs):
        self.order_column = column
        return self

    def range(self, start, end):
        self.range_start = start
        self.range_end = end
        return self

    def maybe_single(self):
        self.single = True
        return self

    def _matches(self, row):
        for operation, key, value in self.filters:
            if operation == "eq" and row.get(key) != value:
                return False
            if operation == "neq" and row.get(key) == value:
                return False
            if operation == "in" and row.get(key) not in value:
                return False
        return True

    def execute(self):
        rows = self.client.tables.setdefault(self.table, [])
        if self.action == "select":
            matches = [dict(r) for r in rows if self._matches(r)]
            if self.order_column:
                matches.sort(key=lambda row: str(row.get(self.order_column) or ""))
            if self.range_start is not None and self.range_end is not None:
                matches = matches[self.range_start : self.range_end + 1]
                max_rows = getattr(self.client, "postgrest_max_rows", None)
                if max_rows is not None:
                    matches = matches[:max_rows]
            return SimpleNamespace(data=(matches[0] if self.single and matches else None) if self.single else matches)
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
    def __init__(self, storage, bucket: str):
        self.storage = storage
        self.bucket = bucket

    def remove(self, paths):
        self.storage.remove_calls.append((self.bucket, list(paths)))
        return None


class FakeStorage:
    def __init__(self):
        self.remove_calls: list[tuple[str, list[str]]] = []

    def from_(self, bucket):
        return FakeStorageBucket(self, bucket)


def _library_usable(row: dict) -> bool:
    return bool(row.get("library_ready_at")) and row.get("status") in {
        "completed",
        "paused",
        "interrupted",
    }


class FakeRpc:
    def __init__(self, client, name: str, payload: dict):
        self.client = client
        self.name = name
        self.payload = payload

    def execute(self):
        if self.name == "reconcile_rekordbox_retained_analysis_dependencies":
            import_id = self.payload["p_import_id"]
            dependencies = self.client.tables.setdefault(
                "rekordbox_retained_analysis_dependencies", []
            )
            tracks = self.client.tables.setdefault("rekordbox_tracks", [])
            kept = []
            removed = 0
            for dependency in dependencies:
                if dependency.get("dependent_import_id") != import_id:
                    kept.append(dependency)
                    continue
                track = next(
                    (
                        row
                        for row in tracks
                        if row.get("id") == dependency.get("dependent_track_id")
                    ),
                    None,
                )
                valid = bool(
                    track
                    and track.get("analysis_reused_from_track_id")
                    == dependency.get("source_track_id")
                    and track.get("analysis_manifest_status")
                    in {"reused", "metadata_only", "reparse_from_retained"}
                )
                if valid:
                    kept.append(dependency)
                else:
                    removed += 1
            self.client.tables["rekordbox_retained_analysis_dependencies"] = kept
            return SimpleNamespace(data=removed)

        if self.name == "begin_rekordbox_import_hard_delete":
            import_id = self.payload["p_import_id"]
            user_id = self.payload["p_user_id"]
            target = next(
                (
                    row
                    for row in self.client.tables.setdefault("rekordbox_imports", [])
                    if row.get("id") == import_id and row.get("user_id") == user_id
                ),
                None,
            )
            if target is None:
                raise RuntimeError("Import not found")
            dependencies = self.client.tables.setdefault(
                "rekordbox_retained_analysis_dependencies", []
            )
            if any(row.get("source_import_id") == import_id for row in dependencies):
                return SimpleNamespace(data=False)
            target["status"] = "deleting"
            return SimpleNamespace(data=True)

        if self.name != "hard_delete_rekordbox_import":
            raise AssertionError(self.name)
        import_id = self.payload["p_import_id"]
        user_id = self.payload["p_user_id"]
        strategy = self.payload["p_active_strategy"]
        imports = self.client.tables.setdefault("rekordbox_imports", [])
        target = next(
            (
                row
                for row in imports
                if row.get("id") == import_id and row.get("user_id") == user_id
            ),
            None,
        )
        if target is None:
            raise RuntimeError("Import not found")
        dependencies = self.client.tables.setdefault(
            "rekordbox_retained_analysis_dependencies", []
        )
        if any(row.get("source_import_id") == import_id for row in dependencies):
            raise RuntimeError("Retained-analysis dependency still active")

        settings = self.client.tables.setdefault("rekordbox_user_settings", [])
        settings_row = next((row for row in settings if row.get("user_id") == user_id), None)
        settings_needs_repair = False
        if settings_row is not None:
            effective_active = settings_row.get("active_import_id")
            if (
                effective_active is not None
                and effective_active != import_id
                and not any(
                    row.get("id") == effective_active
                    and row.get("user_id") == user_id
                    and _library_usable(row)
                    for row in imports
                )
            ):
                settings_needs_repair = True
                effective_active = next(
                    (
                        row.get("id")
                        for row in imports
                        if row.get("user_id") == user_id and _library_usable(row)
                    ),
                    None,
                )
        else:
            effective_active = next(
                (
                    row.get("id")
                    for row in imports
                    if row.get("user_id") == user_id and _library_usable(row)
                ),
                None,
            )

        self.client.tables["rekordbox_imports"] = [
            row
            for row in imports
            if not (row.get("id") == import_id and row.get("user_id") == user_id)
        ]
        for table, rows in list(self.client.tables.items()):
            if table in {
                "rekordbox_imports",
                "rekordbox_user_settings",
                "rekordbox_retained_analysis_dependencies",
            }:
                continue
            self.client.tables[table] = [
                row for row in rows if row.get("import_id") != import_id
            ]
        self.client.tables["rekordbox_retained_analysis_dependencies"] = [
            row
            for row in dependencies
            if row.get("dependent_import_id") != import_id
        ]

        next_active = effective_active
        if effective_active != import_id and settings_needs_repair and settings_row is not None:
            settings_row["active_import_id"] = effective_active
        if effective_active == import_id:
            if strategy == "activate_next":
                next_active = next(
                    (
                        row.get("id")
                        for row in self.client.tables["rekordbox_imports"]
                        if row.get("user_id") == user_id and _library_usable(row)
                    ),
                    None,
                )
            else:
                next_active = None
            if settings_row is None:
                settings_row = {"user_id": user_id}
                settings.append(settings_row)
            settings_row["active_import_id"] = next_active

        return SimpleNamespace(data=next_active)


class FakeClient:
    def __init__(self, rows, *, postgrest_max_rows: int | None = None):
        self.tables = {"rekordbox_imports": rows}
        self.storage = FakeStorage()
        self.postgrest_max_rows = postgrest_max_rows

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


def test_delete_api_reaches_real_service_cleanup_and_finalization(monkeypatch):
    pytest.importorskip("jose")
    from fastapi.testclient import TestClient
    from jose import jwt

    from app.config import settings
    from app.main import app

    user_id = "user-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    import_id = "job-api-hard-delete"
    detail_path = f"{user_id}/{import_id}/waveform/detail.bin"
    client = FakeClient([
        {
            "id": import_id,
            "user_id": user_id,
            "status": "completed",
            "source_filename": "exportLibrary.db",
            "library_ready_at": "2026-08-16T12:00:00Z",
        }
    ])
    client.tables["rekordbox_track_waveforms"] = [
        {
            "id": "wave-api",
            "import_id": import_id,
            "detail_storage_bucket": "rekordbox-analysis-assets",
            "detail_storage_path": detail_path,
        }
    ]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)
    token = jwt.encode(
        {"sub": user_id, "aud": "authenticated", "role": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )

    response = TestClient(app, raise_server_exceptions=False).delete(
        f"/api/rekordbox/import/{import_id}?active_strategy=start_over",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    assert client.tables["rekordbox_imports"] == []
    assert client.storage.remove_calls == [
        ("rekordbox-analysis-assets", [detail_path])
    ]


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


def test_pending_start_over_retry_preserves_original_strategy(monkeypatch):
    active_id = "job-delete-start-over-retry"
    fallback_id = "job-delete-start-over-fallback"
    client = FakeClient([
        {
            "id": active_id,
            "user_id": "u",
            "status": "processing",
            "analysis_status": "parsing",
            "library_ready_at": "2026-08-16T14:00:00Z",
        },
        {
            "id": fallback_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T12:00:00Z",
        },
    ])
    client.tables["rekordbox_user_settings"] = [{"user_id": "u", "active_import_id": active_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)
    monkeypatch.setattr(import_jobs, "_schedule_delete_finalizer", lambda *_a, **_k: None)
    import_jobs.worker_registry.register(active_id)

    first = import_jobs.delete_import_job(
        active_id, "u", wait_timeout_seconds=0, active_strategy="start_over"
    )
    retried = import_jobs.delete_import_job(
        active_id, "u", wait_timeout_seconds=0, active_strategy="activate_next"
    )

    assert first["status"] == "stopping"
    assert retried["status"] == "stopping"
    assert retried["delete_active_strategy"] == "start_over"

    import_jobs.worker_registry.acknowledge_stopped(active_id, status="stopped")
    import_jobs.delete_import_job(
        active_id, "u", wait_timeout_seconds=0, active_strategy="activate_next"
    )

    assert [row["id"] for row in client.tables["rekordbox_imports"]] == [fallback_id]
    assert client.tables["rekordbox_user_settings"][0]["active_import_id"] is None


def test_pending_activate_next_retry_preserves_original_strategy(monkeypatch):
    active_id = "job-delete-activate-next-retry"
    fallback_id = "job-delete-activate-next-fallback"
    client = FakeClient([
        {
            "id": active_id,
            "user_id": "u",
            "status": "processing",
            "analysis_status": "parsing",
            "library_ready_at": "2026-08-16T14:00:00Z",
        },
        {
            "id": fallback_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T12:00:00Z",
        },
    ])
    client.tables["rekordbox_user_settings"] = [{"user_id": "u", "active_import_id": active_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)
    monkeypatch.setattr(import_jobs, "_schedule_delete_finalizer", lambda *_a, **_k: None)
    import_jobs.worker_registry.register(active_id)

    import_jobs.delete_import_job(
        active_id, "u", wait_timeout_seconds=0, active_strategy="activate_next"
    )
    retried = import_jobs.delete_import_job(
        active_id, "u", wait_timeout_seconds=0, active_strategy="start_over"
    )

    assert retried["delete_active_strategy"] == "activate_next"

    import_jobs.worker_registry.acknowledge_stopped(active_id, status="stopped")
    import_jobs.delete_import_job(
        active_id, "u", wait_timeout_seconds=0, active_strategy="start_over"
    )

    assert [row["id"] for row in client.tables["rekordbox_imports"]] == [fallback_id]
    assert client.tables["rekordbox_user_settings"][0]["active_import_id"] == fallback_id


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


def test_waveform_detail_storage_is_removed_before_waveform_metadata(monkeypatch):
    import_id = "job-waveform-detail"
    detail_path = "u/job-waveform-detail/waveform/track-1/detail.bin"
    client = FakeClient([
        {
            "id": import_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T12:00:00Z",
        }
    ])
    client.tables["rekordbox_track_waveforms"] = [
        {
            "id": "wave-1",
            "import_id": import_id,
            "detail_storage_bucket": "rekordbox-analysis-assets",
            "detail_storage_path": detail_path,
        }
    ]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    result = import_jobs.delete_import_job(import_id, "u", wait_timeout_seconds=0)

    assert result["status"] == "cancelled"
    assert client.storage.remove_calls == [
        ("rekordbox-analysis-assets", [detail_path])
    ]
    assert client.tables["rekordbox_track_waveforms"] == []
    assert client.tables["rekordbox_imports"] == []


def test_waveform_storage_failure_preserves_retry_metadata(monkeypatch):
    import_id = "job-waveform-storage-retry"
    detail_path = "u/job-waveform-storage-retry/waveform/track-1/detail.bin"
    client = FakeClient([
        {
            "id": import_id,
            "user_id": "u",
            "status": "deleting",
            "analysis_worker_stopped_acknowledged": True,
        }
    ])
    waveform_row = {
        "id": "wave-1",
        "import_id": import_id,
        "detail_storage_bucket": "rekordbox-analysis-assets",
        "detail_storage_path": detail_path,
    }
    client.tables["rekordbox_track_waveforms"] = [waveform_row.copy()]

    class FailingBucket:
        def remove(self, paths):
            assert paths == [detail_path]
            raise RuntimeError("waveform storage offline")

    class FailingStorage:
        def from_(self, _bucket):
            return FailingBucket()

    client.storage = FailingStorage()
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)
    import_jobs.worker_registry.acknowledge_stopped(import_id, status="stopped")

    with pytest.raises(RuntimeError, match="waveform storage offline"):
        import_jobs.cleanup_partial_import(
            import_id,
            "u",
            sb=client,
            require_worker_ack=True,
        )

    assert client.tables["rekordbox_track_waveforms"] == [waveform_row]
    assert client.tables["rekordbox_imports"][0]["id"] == import_id


def test_storage_enumeration_is_complete_when_postgrest_clamps_pages(monkeypatch):
    import_id = "job-large-storage"
    client = FakeClient(
        [
            {
                "id": import_id,
                "user_id": "u",
                "status": "deleting",
                "analysis_worker_stopped_acknowledged": True,
            }
        ],
        postgrest_max_rows=250,
    )
    client.tables["rekordbox_analysis_assets"] = [
        {
            "id": f"asset-{index:04d}",
            "import_id": import_id,
            "storage_bucket": "rekordbox-analysis-assets",
            "storage_path": f"u/{import_id}/asset-{index:04d}.dat",
            "archive_storage_bucket": "rekordbox-analysis-assets",
            "archive_storage_path": (
                f"u/{import_id}/archive-{index:04d}.dat" if index % 2 == 0 else None
            ),
        }
        for index in range(1001)
    ]
    client.tables["rekordbox_track_waveforms"] = [
        {
            "id": f"wave-{index:04d}",
            "import_id": import_id,
            "detail_storage_bucket": "rekordbox-analysis-assets",
            "detail_storage_path": f"u/{import_id}/wave-{index:04d}.bin",
        }
        for index in range(1001)
    ]
    # Null and duplicate metadata must not create invalid or repeated deletes.
    client.tables["rekordbox_analysis_assets"].append(
        {
            "id": "asset-null",
            "import_id": import_id,
            "storage_path": None,
            "archive_storage_path": "",
        }
    )
    client.tables["rekordbox_track_waveforms"].append(
        {
            "id": "wave-duplicate",
            "import_id": import_id,
            "detail_storage_bucket": "rekordbox-analysis-assets",
            "detail_storage_path": f"u/{import_id}/wave-0000.bin",
        }
    )
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)
    import_jobs.worker_registry.acknowledge_stopped(import_id, status="stopped")

    import_jobs.cleanup_partial_import(
        import_id,
        "u",
        sb=client,
        require_worker_ack=True,
    )

    removed = [path for _bucket, paths in client.storage.remove_calls for path in paths]
    expected = {
        *(f"u/{import_id}/asset-{index:04d}.dat" for index in range(1001)),
        *(f"u/{import_id}/archive-{index:04d}.dat" for index in range(0, 1001, 2)),
        *(f"u/{import_id}/wave-{index:04d}.bin" for index in range(1001)),
    }
    assert set(removed) == expected
    assert len(removed) == len(expected)
    assert client.tables["rekordbox_analysis_assets"] == []
    assert client.tables["rekordbox_track_waveforms"] == []


def test_shared_waveform_reference_lookup_splits_oversized_postgrest_filters():
    import_id = "job-uri-limited-storage"
    shared_path = f"u/{import_id}/waveform/track-0000/detail.json.gz"
    attempted_batch_sizes: list[int] = []

    class UriTooLargeError(RuntimeError):
        code = 400

        def __str__(self):
            return (
                "{'message': 'JSON could not be generated', 'code': 400, "
                "'hint': 'Refer to full message for details', 'details': \"b'Bad Request'\"}"
            )

    class UriLimitedQuery(FakeQuery):
        def execute(self):
            path_filter = next(
                (
                    values
                    for operation, key, values in self.filters
                    if operation == "in" and key == "detail_storage_path"
                ),
                None,
            )
            if path_filter is not None:
                attempted_batch_sizes.append(len(path_filter))
                if len(path_filter) > 2:
                    raise UriTooLargeError()
            return super().execute()

    class UriLimitedClient(FakeClient):
        def table(self, name):
            return UriLimitedQuery(self, name)

    client = UriLimitedClient(
        [
            {
                "id": import_id,
                "user_id": "u",
                "status": "deleting",
                "analysis_worker_stopped_acknowledged": True,
            }
        ]
    )
    paths = [
        f"u/{import_id}/waveform/track-{index:04d}/detail.json.gz"
        for index in range(25)
    ]
    client.tables["rekordbox_track_waveforms"] = [
        {
            "id": f"wave-{index:04d}",
            "import_id": import_id,
            "detail_storage_bucket": "rekordbox-analysis-assets",
            "detail_storage_path": path,
        }
        for index, path in enumerate(paths)
    ]
    client.tables["rekordbox_track_waveforms"].append(
        {
            "id": "wave-shared-by-newer-import",
            "import_id": "newer-import",
            "detail_storage_bucket": "rekordbox-analysis-assets",
            "detail_storage_path": shared_path,
        }
    )

    objects = import_jobs._enumerate_import_storage_objects(client, import_id)

    assert attempted_batch_sizes[0] == import_jobs._STORAGE_REFERENCE_QUERY_CHUNK == 20
    assert any(size > 2 for size in attempted_batch_sizes)
    assert any(size <= 2 for size in attempted_batch_sizes)
    assert ("rekordbox-analysis-assets", shared_path) not in objects
    assert objects == {
        ("rekordbox-analysis-assets", path)
        for path in paths
        if path != shared_path
    }


def test_intermediate_storage_batch_failure_keeps_all_cloud_metadata(monkeypatch):
    import_id = "job-storage-mid-batch"
    client = FakeClient([
        {
            "id": import_id,
            "user_id": "u",
            "status": "deleting",
            "analysis_worker_stopped_acknowledged": True,
        }
    ])
    asset_rows = [
        {
            "id": f"asset-{index:03d}",
            "import_id": import_id,
            "storage_path": f"u/{import_id}/{index:03d}.dat",
        }
        for index in range(201)
    ]
    client.tables["rekordbox_analysis_assets"] = [row.copy() for row in asset_rows]

    class MidBatchFailBucket:
        def __init__(self):
            self.calls = 0

        def remove(self, _paths):
            self.calls += 1
            if self.calls == 2:
                raise RuntimeError("second storage batch failed")

    bucket = MidBatchFailBucket()

    class MidBatchFailStorage:
        def from_(self, _bucket):
            return bucket

    client.storage = MidBatchFailStorage()
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)
    import_jobs.worker_registry.acknowledge_stopped(import_id, status="stopped")

    with pytest.raises(RuntimeError, match="second storage batch failed"):
        import_jobs.cleanup_partial_import(
            import_id,
            "u",
            sb=client,
            require_worker_ack=True,
        )

    assert bucket.calls == 2
    assert client.tables["rekordbox_analysis_assets"] == asset_rows


def test_shared_waveform_detail_path_is_preserved_for_surviving_snapshot(monkeypatch):
    source_id = "job-wave-source"
    dependent_id = "job-wave-dependent"
    shared_path = f"u/{source_id}/waveform/shared.bin"
    client = FakeClient([
        {"id": source_id, "user_id": "u", "status": "deleting"},
        {
            "id": dependent_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T13:00:00Z",
        },
    ])
    client.tables["rekordbox_track_waveforms"] = [
        {
            "id": "wave-source",
            "import_id": source_id,
            "detail_storage_bucket": "rekordbox-analysis-assets",
            "detail_storage_path": shared_path,
        },
        {
            "id": "wave-dependent",
            "import_id": dependent_id,
            "detail_storage_bucket": "rekordbox-analysis-assets",
            "detail_storage_path": shared_path,
        },
    ]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)
    import_jobs.worker_registry.acknowledge_stopped(source_id, status="stopped")

    import_jobs.cleanup_partial_import(
        source_id,
        "u",
        sb=client,
        require_worker_ack=True,
    )

    assert client.storage.remove_calls == []
    assert client.tables["rekordbox_track_waveforms"] == [
        {
            "id": "wave-dependent",
            "import_id": dependent_id,
            "detail_storage_bucket": "rekordbox-analysis-assets",
            "detail_storage_path": shared_path,
        }
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
    assert exc.value.detail["error_code"] == "DELETE_CLEANUP_FAILED"
    assert exc.value.detail["diagnostic"] == "storage unavailable"
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
            if name != "hard_delete_rekordbox_import":
                return super().rpc(name, payload)

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
        {
            "id": active_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T12:00:00Z",
        },
        {
            "id": fallback_id,
            "user_id": "u",
            "status": "paused",
            "library_ready_at": "2026-08-16T11:00:00Z",
        },
        {"id": "job-failed", "user_id": "u", "status": "failed"},
    ])
    client.tables["rekordbox_user_settings"] = [{"user_id": "u", "active_import_id": active_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    result = import_jobs.delete_import_job(active_id, "u", wait_timeout_seconds=0, active_strategy="activate_next")

    assert result["status"] == "cancelled"
    assert {row["id"] for row in client.tables["rekordbox_imports"]} == {fallback_id, "job-failed"}
    assert client.tables["rekordbox_user_settings"][0]["active_import_id"] == fallback_id


def test_activate_next_selects_newest_of_three_remaining_usable_snapshots(monkeypatch):
    active_id = "job-active-three-fallbacks"
    newest_id = "job-newest-fallback"
    middle_id = "job-middle-fallback"
    oldest_id = "job-oldest-fallback"
    client = FakeClient([
        {
            "id": active_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T15:00:00Z",
            "imported_at": "2026-08-16T15:00:00Z",
        },
        {
            "id": newest_id,
            "user_id": "u",
            "status": "paused",
            "library_ready_at": "2026-08-16T14:00:00Z",
            "imported_at": "2026-08-16T14:00:00Z",
        },
        {
            "id": middle_id,
            "user_id": "u",
            "status": "interrupted",
            "library_ready_at": "2026-08-16T13:00:00Z",
            "imported_at": "2026-08-16T13:00:00Z",
        },
        {
            "id": oldest_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T12:00:00Z",
            "imported_at": "2026-08-16T12:00:00Z",
        },
    ])
    client.tables["rekordbox_user_settings"] = [{"user_id": "u", "active_import_id": active_id}]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    import_jobs.delete_import_job(
        active_id, "u", wait_timeout_seconds=0, active_strategy="activate_next"
    )

    assert client.tables["rekordbox_user_settings"][0]["active_import_id"] == newest_id
    assert {row["id"] for row in client.tables["rekordbox_imports"]} == {
        newest_id, middle_id, oldest_id
    }


def test_activate_next_skips_interrupted_snapshot_that_never_became_library_ready(monkeypatch):
    active_id = "job-active-ready"
    pre_ready_id = "job-pre-ready-interrupted"
    fallback_id = "job-ready-older"
    client = FakeClient([
        {
            "id": active_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T14:00:00Z",
        },
        {
            "id": pre_ready_id,
            "user_id": "u",
            "status": "interrupted",
            "library_ready_at": None,
        },
        {
            "id": fallback_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T12:00:00Z",
        },
    ])
    client.tables["rekordbox_user_settings"] = [
        {"user_id": "u", "active_import_id": active_id}
    ]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    import_jobs.delete_import_job(
        active_id,
        "u",
        wait_timeout_seconds=0,
        active_strategy="activate_next",
    )

    assert client.tables["rekordbox_user_settings"][0]["active_import_id"] == fallback_id


def test_activate_next_excludes_terminal_and_deletion_lifecycle_states(monkeypatch):
    active_id = "job-active-ready"
    fallback_id = "job-ready-paused"
    client = FakeClient([
        {
            "id": active_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T14:00:00Z",
        },
        {
            "id": "job-failed-ready",
            "user_id": "u",
            "status": "failed",
            "library_ready_at": "2026-08-16T13:50:00Z",
        },
        {
            "id": "job-cancelled-ready",
            "user_id": "u",
            "status": "cancelled",
            "library_ready_at": "2026-08-16T13:40:00Z",
        },
        {
            "id": "job-stopping-ready",
            "user_id": "u",
            "status": "stopping",
            "library_ready_at": "2026-08-16T13:30:00Z",
        },
        {
            "id": "job-deleting-ready",
            "user_id": "u",
            "status": "deleting",
            "library_ready_at": "2026-08-16T13:20:00Z",
        },
        {
            "id": fallback_id,
            "user_id": "u",
            "status": "paused",
            "library_ready_at": "2026-08-16T13:00:00Z",
        },
    ])
    client.tables["rekordbox_user_settings"] = [
        {"user_id": "u", "active_import_id": active_id}
    ]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    import_jobs.delete_import_job(
        active_id,
        "u",
        wait_timeout_seconds=0,
        active_strategy="activate_next",
    )

    assert client.tables["rekordbox_user_settings"][0]["active_import_id"] == fallback_id


def test_activate_next_allows_library_ready_interrupted_snapshot(monkeypatch):
    active_id = "job-active-ready"
    fallback_id = "job-ready-interrupted"
    client = FakeClient([
        {
            "id": active_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T14:00:00Z",
        },
        {
            "id": fallback_id,
            "user_id": "u",
            "status": "interrupted",
            "library_ready_at": "2026-08-16T13:00:00Z",
        },
    ])
    client.tables["rekordbox_user_settings"] = [
        {"user_id": "u", "active_import_id": active_id}
    ]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    import_jobs.delete_import_job(
        active_id,
        "u",
        wait_timeout_seconds=0,
        active_strategy="activate_next",
    )

    assert client.tables["rekordbox_user_settings"][0]["active_import_id"] == fallback_id


def test_active_retained_dependency_blocks_source_delete_until_materialized(monkeypatch):
    source_id = "job-source"
    dependent_id = "job-dependent"
    client = FakeClient([
        {
            "id": source_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T12:00:00Z",
        },
        {"id": dependent_id, "user_id": "u", "status": "processing"},
    ])
    client.tables["rekordbox_retained_analysis_dependencies"] = [
        {
            "id": "dep-1",
            "source_import_id": source_id,
            "dependent_import_id": dependent_id,
            "source_track_id": "source-track-1",
            "dependent_track_id": "dependent-track-1",
        }
    ]
    client.tables["rekordbox_analysis_assets"] = [
        {
            "id": "source-asset",
            "import_id": source_id,
            "storage_path": f"u/{source_id}/source.dat",
        }
    ]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    with pytest.raises(HTTPException) as exc:
        import_jobs.delete_import_job(source_id, "u", wait_timeout_seconds=0)

    assert exc.value.status_code == 409
    assert exc.value.detail["error_code"] == "DELETE_DEPENDENCY_ACTIVE"
    assert any(row["id"] == source_id for row in client.tables["rekordbox_imports"])
    assert client.storage.remove_calls == []

    # Simulate B completing durable DAT materialization and releasing its guard.
    client.tables["rekordbox_retained_analysis_dependencies"] = []
    retried = import_jobs.delete_import_job(source_id, "u", wait_timeout_seconds=0)

    assert retried["status"] == "cancelled"
    assert all(row["id"] != source_id for row in client.tables["rekordbox_imports"])
    assert client.storage.remove_calls == [
        ("rekordbox-analysis-assets", [f"u/{source_id}/source.dat"])
    ]


def test_multiple_retained_dependencies_block_until_all_are_released(monkeypatch):
    source_id = "job-source-many"
    client = FakeClient([
        {
            "id": source_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T12:00:00Z",
        },
        {"id": "job-dependent-1", "user_id": "u", "status": "processing"},
        {"id": "job-dependent-2", "user_id": "u", "status": "processing"},
    ])
    client.tables["rekordbox_retained_analysis_dependencies"] = [
        {
            "id": "dep-1",
            "source_import_id": source_id,
            "dependent_import_id": "job-dependent-1",
        },
        {
            "id": "dep-2",
            "source_import_id": source_id,
            "dependent_import_id": "job-dependent-2",
        },
    ]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    with pytest.raises(HTTPException) as exc:
        import_jobs.delete_import_job(source_id, "u", wait_timeout_seconds=0)
    assert exc.value.detail["error_code"] == "DELETE_DEPENDENCY_ACTIVE"

    client.tables["rekordbox_retained_analysis_dependencies"] = [
        client.tables["rekordbox_retained_analysis_dependencies"][1]
    ]
    with pytest.raises(HTTPException) as exc:
        import_jobs.delete_import_job(source_id, "u", wait_timeout_seconds=0)
    assert exc.value.detail["error_code"] == "DELETE_DEPENDENCY_ACTIVE"

    client.tables["rekordbox_retained_analysis_dependencies"] = []
    assert import_jobs.delete_import_job(source_id, "u", wait_timeout_seconds=0)["status"] == "cancelled"


def test_deleting_dependent_import_releases_source_guard_via_parent_cascade(monkeypatch):
    source_id = "job-source-cascade"
    dependent_id = "job-dependent-cascade"
    client = FakeClient([
        {
            "id": source_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T12:00:00Z",
        },
        {"id": dependent_id, "user_id": "u", "status": "processing"},
    ])
    client.tables["rekordbox_retained_analysis_dependencies"] = [
        {
            "id": "dep-cascade",
            "source_import_id": source_id,
            "dependent_import_id": dependent_id,
        }
    ]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    import_jobs.delete_import_job(dependent_id, "u", wait_timeout_seconds=0)
    assert client.tables["rekordbox_retained_analysis_dependencies"] == []

    result = import_jobs.delete_import_job(source_id, "u", wait_timeout_seconds=0)
    assert result["status"] == "cancelled"


def test_user_cannot_delete_another_users_snapshot(monkeypatch):
    client = FakeClient([
        {
            "id": "job-other-user",
            "user_id": "owner",
            "status": "completed",
            "library_ready_at": "2026-08-16T12:00:00Z",
        }
    ])
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    with pytest.raises(HTTPException) as exc:
        import_jobs.delete_import_job("job-other-user", "attacker", wait_timeout_seconds=0)

    assert exc.value.status_code == 404
    assert client.tables["rekordbox_imports"][0]["user_id"] == "owner"


def test_hard_delete_repairs_pre_ready_active_pointer_before_fallback(monkeypatch):
    deleting_id = "job-visible-ready"
    invalid_active_id = "job-pre-ready-active"
    fallback_id = "job-ready-fallback"
    client = FakeClient([
        {
            "id": invalid_active_id,
            "user_id": "u",
            "status": "interrupted",
            "library_ready_at": None,
        },
        {
            "id": deleting_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T14:00:00Z",
        },
        {
            "id": fallback_id,
            "user_id": "u",
            "status": "paused",
            "library_ready_at": "2026-08-16T12:00:00Z",
        },
    ])
    client.tables["rekordbox_user_settings"] = [
        {"user_id": "u", "active_import_id": invalid_active_id}
    ]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    import_jobs.delete_import_job(
        deleting_id,
        "u",
        wait_timeout_seconds=0,
        active_strategy="activate_next",
    )

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
        {
            "id": active_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T13:00:00Z",
        },
        {
            "id": inactive_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T12:00:00Z",
        },
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


def test_restart_recovery_prunes_guard_registered_before_manifest_persist(monkeypatch):
    source_id = "job-source-crash-window"
    dependent_id = "job-dependent-crash-window"
    client = FakeClient([
        {
            "id": source_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T12:00:00Z",
        },
        {"id": dependent_id, "user_id": "u", "status": "processing"},
    ])
    client.tables["rekordbox_tracks"] = [
        {
            "id": "dependent-track",
            "import_id": dependent_id,
            "analysis_manifest_status": "needs_analysis",
            "analysis_reused_from_track_id": None,
        }
    ]
    client.tables["rekordbox_retained_analysis_dependencies"] = [
        {
            "id": "dep-stale",
            "source_import_id": source_id,
            "dependent_import_id": dependent_id,
            "source_track_id": "source-track",
            "dependent_track_id": "dependent-track",
        }
    ]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    assert import_jobs.recover_interrupted_import_jobs() == 1
    assert client.tables["rekordbox_retained_analysis_dependencies"] == []

    result = import_jobs.delete_import_job(source_id, "u", wait_timeout_seconds=0)
    assert result["status"] == "cancelled"


def test_restart_recovery_preserves_persisted_reparse_dependency(monkeypatch):
    source_id = "job-source-reparse-restart"
    dependent_id = "job-dependent-reparse-restart"
    client = FakeClient([
        {
            "id": source_id,
            "user_id": "u",
            "status": "completed",
            "library_ready_at": "2026-08-16T12:00:00Z",
        },
        {"id": dependent_id, "user_id": "u", "status": "processing"},
    ])
    client.tables["rekordbox_tracks"] = [
        {
            "id": "dependent-track",
            "import_id": dependent_id,
            "analysis_manifest_status": "reparse_from_retained",
            "analysis_reused_from_track_id": "source-track",
        }
    ]
    dependency = {
        "id": "dep-valid",
        "source_import_id": source_id,
        "dependent_import_id": dependent_id,
        "source_track_id": "source-track",
        "dependent_track_id": "dependent-track",
    }
    client.tables["rekordbox_retained_analysis_dependencies"] = [dependency.copy()]
    monkeypatch.setattr(import_jobs, "_create_supabase", lambda: client)

    assert import_jobs.recover_interrupted_import_jobs() == 1
    assert client.tables["rekordbox_retained_analysis_dependencies"] == [dependency]

    with pytest.raises(HTTPException) as exc:
        import_jobs.delete_import_job(source_id, "u", wait_timeout_seconds=0)
    assert exc.value.detail["error_code"] == "DELETE_DEPENDENCY_ACTIVE"


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
