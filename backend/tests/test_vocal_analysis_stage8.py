from __future__ import annotations

from types import SimpleNamespace

from app.analysis_feature_writer import write_vocal_analysis


class _Query:
    def __init__(self, fail: bool = False):
        self.fail = fail
        self.operations = []

    def upsert(self, row, on_conflict=None):
        self.operations.append(("upsert", row, on_conflict))
        return self

    def delete(self):
        self.operations.append(("delete",))
        return self

    def eq(self, column, value):
        self.operations.append(("eq", column, value))
        return self

    def execute(self):
        if self.fail:
            raise RuntimeError("db unavailable")
        self.operations.append(("execute",))
        return SimpleNamespace(data=[])


class _Client:
    def __init__(self, fail: bool = False):
        self.query = _Query(fail=fail)
        self.tables = []

    def table(self, name):
        self.tables.append(name)
        return self.query


class _Region:
    def as_dict(self):
        return {
            "start_frame": 10,
            "end_frame_exclusive": 60,
            "start_ms": 464.4,
            "end_ms": 2786.4,
            "duration_ms": 2322.0,
            "peak_confidence": 4,
        }


class _Warning:
    def as_dict(self):
        return {"code": "TEST", "asset_type": "2EX", "message": "diagnostic", "detail": None}


class _Result:
    source_tag = "PVDI"
    source_header_length = 24
    source_u1 = 0x400
    source_u2 = 0x56220001
    frame_duration_ms = 1024 / 22050 * 1000
    frame_count = 100
    regions = [_Region()]
    integrity_status = "valid"
    complete = True
    warnings = [_Warning()]

    def warning_dicts(self):
        return [warning.as_dict() for warning in self.warnings]


def test_write_vocal_analysis_persists_compact_regions_and_provenance():
    sb = _Client()
    assert write_vocal_analysis(sb, "import-1", "track-1", _Result(), "asset-2ex", "1.0.0") is True
    assert sb.tables == ["rekordbox_track_vocal_analysis"]
    op, row, conflict = sb.query.operations[0]
    assert op == "upsert"
    assert conflict == "track_id"
    assert row["track_id"] == "track-1"
    assert row["source_2ex_asset_id"] == "asset-2ex"
    assert row["source_header_length"] == 24
    assert row["frame_count"] == 100
    assert row["regions"][0]["peak_confidence"] == 4
    assert "confidence" not in row


def test_absent_pvdi_clears_stale_optional_row_without_creating_evidence():
    sb = _Client()
    assert write_vocal_analysis(sb, "import-1", "track-1", None, "asset-2ex", "1.0.0") is True
    assert sb.query.operations[:2] == [("delete",), ("eq", "track_id", "track-1")]


def test_persistence_failure_is_feature_local_and_returns_false():
    sb = _Client(fail=True)
    assert write_vocal_analysis(sb, "import-1", "track-1", _Result(), "asset-2ex", "1.0.0") is False


def test_stage8_migration_is_user_scoped_and_cascades_with_import_track_lifecycle():
    from pathlib import Path

    sql = Path("supabase/migrations/20260821020000_rekordbox_vocal_analysis_stage8.sql").read_text()
    assert "enable row level security" in sql.lower()
    assert "rekordbox_imports.user_id = auth.uid()" in sql
    assert "rekordbox_tracks.import_id = rekordbox_track_vocal_analysis.import_id" in sql
    assert "references public.rekordbox_imports(id) on delete cascade" in sql
    assert "references public.rekordbox_tracks(id) on delete cascade" in sql
    assert "source_2ex_asset_id" in sql


def test_optional_2ex_archival_parses_pvdi_before_staging_cleanup(tmp_path, monkeypatch):
    import struct
    from unittest.mock import MagicMock

    from app import analysis_feature_writer, analysis_import_service
    from app.analysis_staging import build_staging_key, write_staged_bytes
    from app.config import settings

    confidence = bytes([0] * 5 + [3] + [1] * 50 + [0])
    pvdi = struct.pack(">4sIIIII", b"PVDI", 24, 24 + len(confidence), 0x400, 0x56220001, len(confidence)) + confidence
    data = b"PMAI" + struct.pack(">II", 28, 28 + len(pvdi)) + b"\x00" * 16 + pvdi

    monkeypatch.setattr(settings, "analysis_staging_root", str(tmp_path))
    key = build_staging_key("import-1", "track-1", "2EX", "c" * 64)
    staged = write_staged_bytes(key, data, str(tmp_path))
    row = {
        "import_id": "import-1",
        "track_id": "track-1",
        "asset_type": "2EX",
        "relative_path": "pioneer/usbanlz/p001/a.2ex",
        "staging_key": key,
        "upload_status": "staged",
        "parse_status": "not_requested",
        "archival_status": "queued",
    }

    sb = MagicMock()
    sb.storage.from_.return_value.upload.return_value = None
    sb.table.return_value.upsert.return_value.execute.return_value = None
    monkeypatch.setattr(
        analysis_import_service,
        "_fetch_existing_assets_for_paths",
        lambda *_args, **_kwargs: {row["relative_path"]: {"id": "asset-2ex"}},
    )
    captured = {}

    def _capture(_sb, import_id, track_id, result, source_asset_id, parser_version):
        captured.update({
            "import_id": import_id,
            "track_id": track_id,
            "result": result,
            "source_asset_id": source_asset_id,
            "parser_version": parser_version,
        })
        return True

    monkeypatch.setattr(analysis_feature_writer, "write_vocal_analysis", _capture)

    archived = analysis_import_service._archive_optional_2ex_rows(
        sb, "user-1", "import-1", [row]
    )

    assert archived == 1
    assert not staged.exists()
    assert captured["import_id"] == "import-1"
    assert captured["track_id"] == "track-1"
    assert captured["source_asset_id"] == "asset-2ex"
    assert captured["result"].integrity_status == "valid"
    assert captured["result"].regions
