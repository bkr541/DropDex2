from __future__ import annotations

import math
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app import analysis_fast_pipeline as fast
from app import analysis_import_service as import_service
from app.analysis_staging import build_staging_key, write_staged_bytes
from app.config import settings


class NoStorageClient:
    class _Storage:
        def from_(self, _bucket):
            raise AssertionError("staged assets must not be downloaded from storage")

    storage = _Storage()


def _track(index: int) -> dict:
    return {
        "id": f"track-{index}",
        "rekordbox_content_id": str(index),
        "analysis_parse_status": "queued",
        "analysis_manifest_status": "needs_analysis",
    }


def test_materialized_staged_asset_avoids_upload_download_boomerang(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "analysis_staging_root", str(tmp_path))
    key = build_staging_key("import-1", "track-1", "DAT", "a" * 64)
    path = write_staged_bytes(key, b"DAT bytes", str(tmp_path))
    asset = {"id": "asset-1", "track_id": "track-1", "asset_type": "DAT", "staging_key": key}

    prepared = fast._materialize_asset_sources(NoStorageClient(), [asset], str(tmp_path / "temp"))

    assert prepared[0]["_local_path"] == str(path)
    assert prepared[0]["_temporary_path"] is None


def test_retained_asset_is_checkpointed_into_new_import_staging(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "analysis_staging_root", str(tmp_path / "staging"))
    source = tmp_path / "source.dat"
    source.write_bytes(b"retained DAT")
    asset = {
        "id": "source-asset",
        "import_id": "prior-import",
        "track_id": "new-track",
        "asset_type": "DAT",
        "relative_path": "pioneer/usbanlz/p001/a.dat",
        "original_filename": "A.DAT",
        "sha256": "b" * 64,
        "size_bytes": source.stat().st_size,
        "storage_bucket": "rekordbox-analysis-assets",
        "storage_path": "user/prior-import/anlz/A.DAT",
        "upload_status": "archived",
        "parse_status": "completed",
        "_retained_reference": True,
    }
    sb = MagicMock()
    sb.table.return_value.upsert.return_value.execute.return_value.data = [{
        **{key: value for key, value in asset.items() if not key.startswith("_")},
        "id": "new-asset",
        "import_id": "new-import",
        "storage_path": None,
        "staging_key": "new-import/assets/new-track/b.dat",
        "retained_from_asset_id": "source-asset",
    }]
    monkeypatch.setattr(
        fast,
        "_resolve_asset_source",
        lambda *_: fast.AssetSource(row=asset, local_path=str(source)),
    )

    prepared = fast._materialize_asset_sources(
        sb,
        [asset],
        str(tmp_path / "temp"),
        import_id="new-import",
    )

    assert prepared[0]["id"] == "new-asset"
    assert prepared[0]["import_id"] == "new-import"
    assert prepared[0]["retained_from_asset_id"] == "source-asset"
    assert Path(prepared[0]["_local_path"]).read_bytes() == b"retained DAT"
    sb.rpc.assert_called_with(
        "release_rekordbox_retained_analysis_dependencies",
        {
            "p_import_id": "new-import",
            "p_track_ids": ["new-track"],
        },
    )


def test_resume_releases_stale_dependency_for_already_owned_staged_dat(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "analysis_staging_root", str(tmp_path / "staging"))
    key = build_staging_key("new-import", "new-track", "DAT", "c" * 64)
    write_staged_bytes(key, b"already independent", str(tmp_path / "staging"))
    asset = {
        "id": "new-asset",
        "import_id": "new-import",
        "track_id": "new-track",
        "asset_type": "DAT",
        "staging_key": key,
    }
    sb = MagicMock()

    prepared = fast._materialize_asset_sources(
        sb,
        [asset],
        str(tmp_path / "temp"),
        import_id="new-import",
    )

    assert prepared[0]["_local_path"]
    sb.rpc.assert_called_once_with(
        "release_rekordbox_retained_analysis_dependencies",
        {
            "p_import_id": "new-import",
            "p_track_ids": ["new-track"],
        },
    )


def test_reparse_from_retained_loads_prior_assets_as_read_only_sources(monkeypatch):
    track = {
        **_track(1),
        "analysis_manifest_status": "reparse_from_retained",
        "analysis_reused_from_track_id": "prior-track",
    }
    calls = 0

    def load_all(_factory, order_column="id"):
        nonlocal calls
        calls += 1
        if calls == 1:
            return []
        return [{
            "id": "prior-asset",
            "import_id": "prior-import",
            "track_id": "prior-track",
            "asset_type": "DAT",
            "relative_path": "pioneer/usbanlz/p001/a.dat",
            "upload_status": "archived",
        }]

    monkeypatch.setattr(fast, "_load_all", load_all)
    assets = fast._load_assets(MagicMock(), "new-import", [track])

    assert len(assets) == 1
    assert assets[0]["track_id"] == "track-1"
    assert assets[0]["_source_track_id"] == "prior-track"
    assert assets[0]["_retained_reference"] is True


def test_parser_excludes_2ex_from_blocking_path(monkeypatch, tmp_path):
    calls: dict[str, object] = {}

    parsed_dat = SimpleNamespace(
        asset_type="DAT",
        parse_status="completed",
        parser_version="test-parser",
        warnings=[],
    )
    parsed_ext = SimpleNamespace(
        asset_type="EXT",
        parse_status="completed",
        parser_version="test-parser",
        warnings=[],
    )
    bundle = SimpleNamespace(
        dat=parsed_dat,
        ext=parsed_ext,
        assets=[parsed_dat, parsed_ext],
        warnings=[],
        overall_status="completed",
    )

    import dropdex_importer.anlz_parser as anlz_parser
    import dropdex_importer.beatgrid_parser as beatgrid_parser
    import dropdex_importer.cue_parser as cue_parser
    import dropdex_importer.phrase_parser as phrase_parser
    import dropdex_importer.waveform_parser as waveform_parser

    def parse_bundle(*, dat_path, ext_path, two_ex_path):
        calls.update(dat_path=dat_path, ext_path=ext_path, two_ex_path=two_ex_path)
        return bundle

    monkeypatch.setattr(anlz_parser, "parse_track_analysis_bundle", parse_bundle)
    monkeypatch.setattr(beatgrid_parser, "extract_beat_grid", lambda *_: None)
    monkeypatch.setattr(cue_parser, "parse_anlz_cues", lambda *_: ([], []))
    monkeypatch.setattr(phrase_parser, "extract_phrases", lambda *_: ([], []))
    monkeypatch.setattr(waveform_parser, "extract_waveforms", lambda *_: None)

    dat = tmp_path / "track.dat"
    ext = tmp_path / "track.ext"
    two_ex = tmp_path / "track.2ex"
    for path in (dat, ext, two_ex):
        path.write_bytes(b"x")

    result = fast._parse_track(
        _track(1),
        [
            {"id": "dat", "asset_type": "DAT", "_local_path": str(dat)},
            {"id": "ext", "asset_type": "EXT", "_local_path": str(ext)},
            {"id": "2ex", "asset_type": "2EX", "_local_path": str(two_ex)},
        ],
        str(tmp_path),
    )

    assert calls["two_ex_path"] is None
    assert result.parse_status == "completed"
    assert next(row for row in result.asset_parse_updates if row["asset_type"] == "2EX")[
        "parse_status"
    ] == "skipped"


@pytest.mark.parametrize(
    ("library_size", "changed_count", "expected_write_batches"),
    [
        (100, 100, 4),
        (2_000, 2_000, 63),
        (2_000, 0, 0),
        (2_000, 100, 4),
    ],
)
def test_operation_counts_scale_by_changed_batches(
    monkeypatch,
    tmp_path,
    library_size,
    changed_count,
    expected_write_batches,
):
    affected = [f"track-{index}" for index in range(changed_count)]
    selected_tracks = [_track(index) for index in range(changed_count)]
    seen: dict[str, object] = {}
    write_batches: list[int] = []

    def load_tracks(_sb, _import_id, affected_track_ids):
        seen["affected"] = list(affected_track_ids or [])
        return selected_tracks

    monkeypatch.setattr(fast, "_load_tracks", load_tracks)
    monkeypatch.setattr(fast, "_load_assets", lambda *_: [])
    monkeypatch.setattr(fast, "_materialize_asset_sources", lambda *_: [])
    monkeypatch.setattr(
        fast,
        "_rolling_parse_results",
        lambda tracks, *_args, **_kwargs: iter(
            fast.ParsedTrack(track=track, assets=[], parse_status="completed") for track in tracks
        ),
    )
    monkeypatch.setattr(fast, "_bulk_track_status", lambda *_: None)
    monkeypatch.setattr(fast, "_write_batch", lambda _sb, _user, _import, batch, *_: write_batches.append(len(batch)))
    monkeypatch.setattr(fast, "merge_import_metrics", lambda *_: None)
    monkeypatch.setattr(settings, "analysis_writer_batch_size", 32)
    monkeypatch.setattr(settings, "analysis_staging_root", str(tmp_path))

    result = fast.run_fast_analysis_import(
        object(),
        "import-1",
        "user-1",
        affected_track_ids=affected,
        parser_version="test-parser",
        checkpoint=lambda *_: None,
        progress=lambda *_: None,
    )

    assert seen["affected"] == affected
    assert result["total_tracks"] == changed_count
    assert len(write_batches) == expected_write_batches
    assert sum(write_batches) == changed_count
    assert result["metrics"].counts["track_map_builds"] == 1
    assert expected_write_batches == (math.ceil(changed_count / 32) if changed_count else 0)
    if library_size == 2_000 and changed_count == 100:
        assert result["total_tracks"] == library_size * 0.05


def test_bulk_writer_bisects_and_isolates_one_malformed_track(monkeypatch):
    parsed = [
        fast.ParsedTrack(track=_track(index), assets=[], parse_status="completed")
        for index in range(8)
    ]
    written: list[str] = []
    failed_statuses: list[dict] = []

    def flaky_write(_sb, _user, _import, batch, *_versions):
        ids = [str(item.track["id"]) for item in batch]
        if "track-5" in ids:
            raise ValueError("synthetic malformed row")
        written.extend(ids)

    monkeypatch.setattr(fast, "_write_batch", flaky_write)
    monkeypatch.setattr(
        fast,
        "_bulk_track_status",
        lambda _sb, _import, rows: failed_statuses.extend(rows),
    )

    attempts = fast._write_batch_resilient(
        object(),
        "user-1",
        "import-1",
        parsed,
        "parser-v1",
        "schema-v1",
    )

    assert attempts > 1
    assert set(written) == {f"track-{index}" for index in range(8)} - {"track-5"}
    assert parsed[5].parse_status == "failed"
    assert len(failed_statuses) == 1
    assert failed_statuses[0]["track_id"] == "track-5"
    assert failed_statuses[0]["analysis_parse_status"] == "failed"


def test_result_queue_is_bounded_and_failures_are_isolated(monkeypatch, tmp_path):
    tracks = [_track(index) for index in range(12)]

    def parse(track, *_args):
        if track["id"] == "track-5":
            raise ValueError("malformed")
        return fast.ParsedTrack(track=track, assets=[], parse_status="completed")

    monkeypatch.setattr(fast, "_parse_track", parse)
    results = list(
        fast._rolling_parse_results(
            tracks,
            {},
            str(tmp_path),
            workers=4,
            result_queue_size=2,
            checkpoint=lambda *_: None,
        )
    )

    assert len(results) == 12
    failed = next(result for result in results if result.track["id"] == "track-5")
    assert failed.parse_status == "failed"
    assert all(result.track["id"] != "track-5" or result.parse_status == "failed" for result in results)


def test_upload_path_map_is_constructed_once_per_import(monkeypatch):
    sb = MagicMock()
    sb.table.return_value.update.return_value.eq.return_value.execute.return_value = None
    tracks = [{
        "id": "track-1",
        "analysis_data_file_path": "PIONEER/USBANLZ/P001/A.DAT",
        "analysis_manifest_status": "needs_dat",
        "analysis_source_fingerprint": "fingerprint",
    }]
    loads: list[str] = []

    monkeypatch.setattr(import_service, "_create_supabase", lambda: sb)
    monkeypatch.setattr(
        import_service,
        "_require_import_for_user",
        lambda *_: {"status": "processing", "retryable": True},
    )
    monkeypatch.setattr(
        import_service,
        "_get_tracks_with_paths",
        lambda _sb, import_id: loads.append(import_id) or tracks,
    )
    import_service._invalidate_path_map_cache("import-1")

    _, first, first_built, _ = import_service._prepare_analysis_batch("import-1", "user-1")
    _, second, second_built, _ = import_service._prepare_analysis_batch("import-1", "user-1")

    assert first_built is True
    assert second_built is False
    assert first is second
    assert loads == ["import-1"]


def test_metadata_only_track_does_not_enter_upload_or_analysis_work():
    metadata_only = {
        "id": "track-meta",
        "analysis_data_file_path": "PIONEER/USBANLZ/P001/META.DAT",
        "analysis_manifest_status": "metadata_only",
        "analysis_parse_status": "reused",
    }
    changed = {
        "id": "track-changed",
        "analysis_data_file_path": "PIONEER/USBANLZ/P001/CHANGED.DAT",
        "analysis_manifest_status": "needs_dat",
        "analysis_parse_status": "queued",
    }

    path_map = import_service._build_path_map([metadata_only, changed])
    selected = import_service._select_tracks_for_analysis(
        [metadata_only, changed], ["track-changed"]
    )

    assert all("meta" not in path for path in path_map)
    assert {entry["asset_type"] for entry in path_map.values()} == {"DAT", "EXT"}
    assert [track["id"] for track in selected] == ["track-changed"]


def test_optional_2ex_batch_archives_without_changing_track_parse_state(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "analysis_staging_root", str(tmp_path))
    key = build_staging_key("import-1", "track-1", "2EX", "b" * 64)
    staged = write_staged_bytes(key, b"optional waveform bytes", str(tmp_path))
    sb = MagicMock()
    sb.storage.from_.return_value.upload.return_value = None
    sb.table.return_value.upsert.return_value.execute.return_value = None
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

    archived = import_service._archive_optional_2ex_rows(
        sb, "user-1", "import-1", [row]
    )

    assert archived == 1
    assert not staged.exists()
    sb.storage.from_.return_value.upload.assert_called_once()
    persisted = sb.table.return_value.upsert.call_args.args[0][0]
    assert persisted["upload_status"] == "archived"
    assert persisted["parse_status"] == "not_requested"
    assert persisted["archival_status"] == "archived"


def test_optional_batch_activity_does_not_regress_completed_analysis():
    sb = MagicMock()
    sb.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value = None

    import_service._mark_batch_activity(
        sb,
        "import-1",
        "user-1",
        required_upload=False,
        optional_upload=True,
    )

    payload = sb.table.return_value.update.call_args.args[0]
    assert payload["optional_archival_status"] == "running"
    assert "analysis_status" not in payload


def test_optional_2ex_archival_status_is_independent_from_track_readiness(monkeypatch):
    from app import supabase_pagination

    monkeypatch.setattr(settings, "analysis_archive_2ex", True)
    monkeypatch.setattr(supabase_pagination, "fetch_all_rows", lambda *_args, **_kwargs: [])
    assert import_service._resolve_optional_archival_status(object(), "import-1", 2) == "queued"

    rows = [
        {"id": "a", "upload_status": "uploaded", "archival_status": "not_requested"},
        {"id": "b", "upload_status": "archived", "archival_status": "archived"},
    ]
    monkeypatch.setattr(supabase_pagination, "fetch_all_rows", lambda *_args, **_kwargs: rows)
    assert import_service._resolve_optional_archival_status(object(), "import-1", 2) == "completed"

    monkeypatch.setattr(settings, "analysis_archive_2ex", False)
    assert import_service._resolve_optional_archival_status(object(), "import-1", 2) == "skipped"


def test_client_metrics_keep_only_safe_aggregate_fields():
    from app.analysis_performance import sanitize_client_import_metrics

    sanitized = sanitize_client_import_metrics({
        "timings_ms": {
            "usb_file_matching": 12.3456,
            "private_track_lookup": 99,
        },
        "counts": {
            "usb_files_matched": 3_704,
            "affected_tracks": 152,
            "track_titles": 1,
        },
        "bytes": {
            "required_analysis_files": 123_456,
            "source_paths": 10,
        },
        "paths": ["PIONEER/USBANLZ/private.DAT"],
    })

    assert sanitized == {
        "timings_ms": {"usb_file_matching": 12.346},
        "counts": {"usb_files_matched": 3_704, "affected_tracks": 152},
        "bytes": {"required_analysis_files": 123_456},
    }


def test_status_honors_manifest_work_and_does_not_requeue_reused_tracks(monkeypatch):
    import app.supabase_pagination as pagination

    tracks = [
        {
            "id": "track-reused",
            "rekordbox_content_id": "1",
            "analysis_data_file_path": "PIONEER/USBANLZ/P001/REUSED.DAT",
            "analysis_manifest_status": "reused",
            "analysis_parse_status": "reused",
        },
        {
            "id": "track-metadata",
            "rekordbox_content_id": "2",
            "analysis_data_file_path": "PIONEER/USBANLZ/P001/META.DAT",
            "analysis_manifest_status": "metadata_only",
            "analysis_parse_status": "reused",
        },
        {
            "id": "track-unavailable",
            "rekordbox_content_id": "3",
            "analysis_data_file_path": "PIONEER/USBANLZ/P001/MISSING.DAT",
            "analysis_manifest_status": "unavailable",
            "analysis_parse_status": "skipped",
        },
        {
            "id": "track-changed",
            "rekordbox_content_id": "4",
            "analysis_data_file_path": "PIONEER/USBANLZ/P001/CHANGED.DAT",
            "analysis_manifest_status": "needs_dat",
            "analysis_parse_status": "queued",
        },
    ]
    import_row = {
        "analysis_status": "queued",
        "analysis_expected_track_count": 4,
        "analysis_matched_track_count": 4,
        "analysis_parsed_track_count": 3,
        "analysis_failed_track_count": 0,
        "analysis_asset_count": 0,
        "status": "processing",
        "library_ready_at": "2026-07-25T00:00:00+00:00",
        "readiness_stage": "library_metadata_ready",
        "required_analysis_file_count": 2,
        "optional_archival_file_count": 4,
        "optional_archival_status": "skipped",
        "analysis_queue_track_count": 1,
        "analysis_running_track_count": 0,
        "performance_metrics": {},
    }

    monkeypatch.setattr(import_service, "_create_supabase", lambda: object())
    monkeypatch.setattr(import_service, "_require_import_for_user", lambda *_: import_row)
    monkeypatch.setattr(import_service, "_get_tracks_for_analysis_status", lambda *_: tracks)
    monkeypatch.setattr(pagination, "fetch_all_rows", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(import_service.worker_registry, "snapshot", lambda *_: {})
    monkeypatch.setattr(import_service, "get_worker_lease", lambda *_: None)

    status = import_service._get_analysis_status_sync("import-1", "user-1")

    assert status.affected_track_count == 1
    assert {target.track_id for target in status.unresolved_targets} == {"track-changed"}
    assert [target.asset_type for target in status.unresolved_targets] == ["DAT", "EXT"]
    assert status.unresolved_targets[0].required is True
    assert status.unresolved_targets[1].required is False
    assert status.missing_optional_2ex == []
    assert status.tracks_ready_count == 3


def test_upload_path_map_is_constructed_once_for_concurrent_batches(monkeypatch):
    import threading
    import time

    sb = MagicMock()
    sb.table.return_value.update.return_value.eq.return_value.execute.return_value = None
    tracks = [{
        "id": "track-1",
        "analysis_data_file_path": "PIONEER/USBANLZ/P001/A.DAT",
        "analysis_manifest_status": "needs_dat",
        "analysis_source_fingerprint": "fingerprint",
    }]
    load_count = 0
    count_lock = threading.Lock()

    def load_tracks(_sb, _import_id):
        nonlocal load_count
        with count_lock:
            load_count += 1
        time.sleep(0.02)
        return tracks

    monkeypatch.setattr(import_service, "_create_supabase", lambda: sb)
    monkeypatch.setattr(
        import_service,
        "_require_import_for_user",
        lambda *_: {"status": "processing", "retryable": True},
    )
    monkeypatch.setattr(import_service, "_get_tracks_with_paths", load_tracks)
    import_service._invalidate_path_map_cache("import-concurrent")

    results: list[tuple] = []
    threads = [
        threading.Thread(
            target=lambda: results.append(
                import_service._prepare_analysis_batch("import-concurrent", "user-1")
            )
        )
        for _ in range(3)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert load_count == 1
    assert len(results) == 3
    assert sum(1 for _sb, _map, built, _row in results if built) == 1
    assert all(result[1] is results[0][1] for result in results)


def test_load_tracks_chunks_real_usb_scale_affected_filter(monkeypatch):
    """2,213 selective IDs must never become one PostgREST query URL."""
    affected = [f"track-{index:04d}" for index in range(2_213)]
    seen_chunks: list[list[str]] = []

    class Query:
        def __init__(self):
            self.ids: list[str] = []

        def select(self, *_args, **_kwargs):
            return self

        def eq(self, *_args, **_kwargs):
            return self

        def in_(self, column, values):
            assert column == "id"
            self.ids = list(values)
            return self

    class Supabase:
        def table(self, table_name):
            assert table_name == "rekordbox_tracks"
            return Query()

    def load_all(factory, order_column="id"):
        assert order_column == "id"
        query = factory()
        seen_chunks.append(query.ids)
        return [
            {
                "id": track_id,
                "analysis_parse_status": "queued",
                "analysis_manifest_status": "needs_analysis",
            }
            for track_id in query.ids
        ]

    monkeypatch.setattr(fast, "_load_all", load_all)

    rows = fast._load_tracks(Supabase(), "import-1", affected)

    assert [row["id"] for row in rows] == affected
    assert len(seen_chunks) == math.ceil(len(affected) / 100)
    assert max(map(len, seen_chunks)) <= 100
    assert [track_id for chunk in seen_chunks for track_id in chunk] == affected


def test_bulk_track_status_bounds_real_usb_scale_rpc_payloads():
    rows = [{"track_id": f"track-{index}", "analysis_parse_status": "queued"} for index in range(2_213)]
    sb = MagicMock()
    sb.rpc.return_value.execute.return_value.data = None

    fast._bulk_track_status(sb, "import-1", rows)

    rpc_rows = [call.args[1]["p_rows"] for call in sb.rpc.call_args_list]
    assert len(rpc_rows) == math.ceil(2_213 / 250)
    assert max(map(len, rpc_rows)) <= 250
    assert sum(map(len, rpc_rows)) == 2_213


def test_manifest_persistence_bounds_real_usb_scale_rpc_payloads():
    entries = [
        SimpleNamespace(
            track_id=f"track-{index}",
            manifest_status="needs_dat",
            reused_from_track_id=None,
            source_fingerprint=f"fingerprint-{index}",
            reuse_reason=None,
        )
        for index in range(2_213)
    ]
    sb = MagicMock()
    sb.rpc.return_value.execute.return_value.data = None

    import_service._persist_track_manifest_state(sb, "import-1", entries)

    rpc_rows = [call.args[1]["p_rows"] for call in sb.rpc.call_args_list]
    assert len(rpc_rows) == math.ceil(2_213 / 250)
    assert max(map(len, rpc_rows)) <= 250
    assert sum(map(len, rpc_rows)) == 2_213


def test_release_retained_dependencies_bounds_large_parser_upgrade_payloads():
    from app.retained_analysis_dependencies import release_retained_analysis_dependencies

    track_ids = [f"track-{index}" for index in range(751)]
    sb = MagicMock()
    sb.rpc.return_value.execute.return_value.data = 0

    release_retained_analysis_dependencies(sb, "import-1", track_ids)

    rpc_ids = [call.args[1]["p_track_ids"] for call in sb.rpc.call_args_list]
    assert len(rpc_ids) == math.ceil(751 / 250)
    assert max(map(len, rpc_ids)) <= 250
    assert sum(map(len, rpc_ids)) == 751


@pytest.mark.asyncio
async def test_full_complete_derives_2213_pending_tracks_server_side(monkeypatch):
    """Full imports must not pass the browser's 2,213-ID list into the worker."""
    sb = MagicMock()
    sb.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
    pending = [f"track-{index}" for index in range(2_213)]
    started_with: list[object] = []

    monkeypatch.setattr(import_service, "_create_supabase", lambda: sb)
    monkeypatch.setattr(
        import_service,
        "_require_import_for_user",
        lambda *_: {
            "analysis_expected_track_count": 2_213,
            "analysis_parsed_track_count": 0,
            "analysis_failed_track_count": 0,
            "optional_archival_status": "skipped",
            "raw_archival_status": "skipped",
        },
    )
    monkeypatch.setattr(import_service, "_pending_analysis_track_ids", lambda *_: pending)
    monkeypatch.setattr(
        import_service,
        "_start_background_analysis",
        lambda _import_id, _user_id, affected: started_with.append(affected) or True,
    )

    result = await import_service.complete_analysis_import(
        "import-1",
        "user-1",
        affected_track_ids=None,
        background=True,
    )

    assert result.queued_track_count == 2_213
    assert result.background_started is True
    assert started_with == [None]


@pytest.mark.asyncio
async def test_zero_pending_resume_durably_finalizes_parent_import(monkeypatch):
    """A crash after the last track checkpoint must self-heal on resume."""
    sb = MagicMock()
    sb.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
    finalized: list[tuple[str, str]] = []
    activated: list[tuple[str, str]] = []

    monkeypatch.setattr(import_service, "_create_supabase", lambda: sb)
    monkeypatch.setattr(
        import_service,
        "_require_import_for_user",
        lambda *_: {
            "status": "processing",
            "analysis_expected_track_count": 2_213,
            "analysis_parsed_track_count": 2_212,
            "analysis_failed_track_count": 0,
            "optional_archival_file_count": 0,
            "optional_archival_status": "skipped",
            "raw_archival_status": "skipped",
        },
    )
    monkeypatch.setattr(import_service, "_pending_analysis_track_ids", lambda *_: [])
    monkeypatch.setattr(
        import_service,
        "_summarize_track_states",
        lambda *_: {"completed": 2_212, "partial": 1, "total": 2_213},
    )
    monkeypatch.setattr(
        import_service, "_resolve_optional_archival_status", lambda *_: "skipped"
    )
    monkeypatch.setattr(
        import_service,
        "complete_import_job",
        lambda import_id, user_id: finalized.append((import_id, user_id)) or {},
    )
    monkeypatch.setattr(
        import_service,
        "upsert_active_import",
        lambda _url, _key, user_id, import_id: activated.append((user_id, import_id)),
    )

    result = await import_service.complete_analysis_import(
        "import-1",
        "user-1",
        background=True,
    )

    assert result.analysis_status == "partial"
    assert result.total_tracks == 2_213
    assert result.completed_count == 2_212
    assert result.partial_count == 1
    assert result.queued_track_count == 0
    assert result.background_started is False
    assert finalized == [("import-1", "user-1")]
    assert activated == [("user-1", "import-1")]

    updates = sb.table.return_value.update.call_args.args[0]
    assert updates["analysis_status"] == "partial"
    assert updates["analysis_queue_track_count"] == 0
    assert updates["analysis_running_track_count"] == 0
    assert updates["analysis_worker_status"] == "completed"
    assert updates["analysis_worker_stopped_acknowledged"] is True
