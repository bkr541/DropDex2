from __future__ import annotations

from types import SimpleNamespace

import pytest

from app import analysis_raw_archival as archival
from app.analysis_staging import build_staging_key, write_staged_bytes
from app.config import settings


class _Query:
    def __init__(self, client, table_name):
        self.client = client
        self.table_name = table_name
        self.operation = None
        self.payload = None

    def update(self, payload):
        self.operation = "update"
        self.payload = payload
        return self

    def upsert(self, payload, **_kwargs):
        self.operation = "upsert"
        self.payload = payload
        return self

    def eq(self, *_args):
        return self

    def in_(self, *_args):
        return self

    def execute(self):
        if self.operation == "update":
            self.client.updates.append((self.table_name, self.payload))
        elif self.operation == "upsert":
            self.client.upserts.extend(self.payload)
        return SimpleNamespace(data=[])


class _Bucket:
    def __init__(self, client):
        self.client = client

    def upload(self, *, path, file, file_options):
        assert hasattr(file, "read"), "raw archive uploads must stream from disk"
        self.client.uploads.append((path, file.read(), file_options))


class _Storage:
    def __init__(self, client):
        self.client = client

    def from_(self, bucket):
        assert bucket == "rekordbox-analysis-assets"
        return _Bucket(self.client)


class _Client:
    def __init__(self):
        self.updates = []
        self.upserts = []
        self.uploads = []
        self.storage = _Storage(self)

    def table(self, name):
        return _Query(self, name)


class _Lease:
    def __init__(self):
        self.checkpoints = []

    def checkpoint(self, stage, current_track_id=None, *, force=False):
        self.checkpoints.append((stage, current_track_id, force))


def _row(import_id: str, track_id: str, asset_type: str, staging_key: str, size: int):
    return {
        "id": f"asset-{track_id}-{asset_type}",
        "import_id": import_id,
        "track_id": track_id,
        "asset_type": asset_type,
        "relative_path": f"pioneer/usbanlz/{track_id}/source.{asset_type.lower()}",
        "original_filename": f"source.{asset_type.lower()}",
        "sha256": "a" * 64,
        "size_bytes": size,
        "storage_bucket": "rekordbox-analysis-assets",
        "storage_path": None,
        "staging_key": staging_key,
        "upload_status": "staged",
        "parse_status": "completed",
        "parser_version": "test",
        "parse_warnings": [],
        "uploaded_at": None,
        "parsed_at": None,
        "source_mtime_ms": None,
        "source_fingerprint": None,
        "feature_schema_version": "test",
        "archive_storage_bucket": None,
        "archive_storage_path": None,
        "archive_member_path": None,
        "retained_from_asset_id": None,
        "archival_status": "queued",
    }


def test_raw_archival_streams_group_then_removes_staging(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "analysis_staging_root", str(tmp_path))
    import_id = "import-1"
    rows = []
    for track_id, asset_type, content in (
        ("track-1", "DAT", b"dat bytes"),
        ("track-1", "EXT", b"ext bytes"),
    ):
        key = build_staging_key(import_id, track_id, asset_type, "a" * 64)
        write_staged_bytes(key, content, str(tmp_path))
        rows.append(_row(import_id, track_id, asset_type, key, len(content)))

    client = _Client()
    lease = _Lease()
    monkeypatch.setattr(archival, "_load_raw_assets", lambda *_args: rows)
    monkeypatch.setattr(archival, "merge_import_metrics", lambda *_args: None)

    archived = archival._archive_raw_assets(
        client,
        import_id,
        "user-1",
        lease,
    )

    assert archived == 2
    assert len(client.uploads) == 1
    assert client.uploads[0][0].startswith("user-1/import-1/archives/group-raw-")
    assert client.uploads[0][1].startswith(b"\x1f\x8b")
    assert {row["archival_status"] for row in client.upserts} == {"archived"}
    assert all(row["archive_member_path"] for row in client.upserts)
    assert all(
        not archival.resolve_staging_key(row["staging_key"], str(tmp_path)).exists()
        for row in rows
    )
    assert lease.checkpoints == [
        ("raw_archive_preparing", None, True),
        ("raw_archive_uploading", None, True),
        ("raw_archive_persisting", None, True),
    ]
    import_statuses = [
        payload["raw_archival_status"]
        for table, payload in client.updates
        if table == "rekordbox_imports"
    ]
    assert import_statuses == ["running", "completed"]


def test_missing_raw_source_fails_instead_of_reporting_completed(monkeypatch):
    row = _row("import-1", "track-1", "DAT", "missing/key.dat", 10)
    client = _Client()
    monkeypatch.setattr(archival, "_load_raw_assets", lambda *_args: [row])

    with pytest.raises(RuntimeError, match="no staged or archived source"):
        archival._archive_raw_assets(
            client,
            "import-1",
            "user-1",
            _Lease(),
        )

    asset_updates = [
        payload
        for table, payload in client.updates
        if table == "rekordbox_analysis_assets"
    ]
    assert {payload["archival_status"] for payload in asset_updates} == {"failed"}
