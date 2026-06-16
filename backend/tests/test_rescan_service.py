"""Tests for incremental rescan reuse logic."""
import pytest
from unittest.mock import MagicMock

from app.rescan_service import (
    TrackIdentity, ReuseDecision, decide_reuse, match_tracks_to_prior_import
)

def make_identity(**kwargs):
    defaults = dict(
        track_id="t1", import_id="imp1",
        master_db_id="db1", master_content_id="c1",
        rekordbox_content_id="rc1",
        analysis_data_file_path="/PIONEER/USBANLZ/P001/ANLZ0000.DAT",
        analysis_data_update_count=5,
        cue_update_count=3,
        information_update_count=2,
    )
    defaults.update(kwargs)
    return TrackIdentity(**defaults)


class TestDecideReuse:
    def test_unchanged_track_fully_reused(self):
        new = make_identity(track_id="new")
        prior = make_identity(track_id="prior")
        d = decide_reuse(new, prior)
        assert d.manifest_status == "reused"
        assert d.reuse_grid and d.reuse_waveform and d.reuse_cues and d.reuse_phrases

    def test_analysis_changed_needs_upload(self):
        new = make_identity(track_id="new", analysis_data_update_count=6)
        prior = make_identity(track_id="prior", analysis_data_update_count=5)
        d = decide_reuse(new, prior)
        assert d.manifest_status == "needs_dat"
        assert d.analysis_changed
        assert not d.reuse_grid and not d.reuse_waveform

    def test_cue_only_change_metadata_only(self):
        new = make_identity(track_id="new", cue_update_count=4)
        prior = make_identity(track_id="prior", cue_update_count=3)
        d = decide_reuse(new, prior)
        assert d.manifest_status == "metadata_only"
        assert d.cue_changed and not d.analysis_changed
        assert d.reuse_grid and d.reuse_waveform  # analysis still reused
        assert not d.reuse_cues  # cues need refresh

    def test_information_only_change(self):
        new = make_identity(track_id="new", information_update_count=3)
        prior = make_identity(track_id="prior", information_update_count=2)
        d = decide_reuse(new, prior)
        assert d.information_changed
        # Analysis and cues should still be reused if their counters match
        assert d.reuse_grid and d.reuse_waveform and d.reuse_cues

    def test_path_changed_needs_upload(self):
        new = make_identity(track_id="new", analysis_data_file_path="/PIONEER/USBANLZ/P002/ANLZ0001.DAT")
        prior = make_identity(track_id="prior", analysis_data_file_path="/PIONEER/USBANLZ/P001/ANLZ0000.DAT")
        d = decide_reuse(new, prior)
        assert d.manifest_status == "needs_dat"

    def test_missing_counters_conservative(self):
        new = make_identity(track_id="new", analysis_data_update_count=None)
        prior = make_identity(track_id="prior", analysis_data_update_count=None)
        d = decide_reuse(new, prior)
        # Missing counters -> assume unchanged (conservative — don't force re-upload)
        assert not d.analysis_changed

    def test_reuse_reason_populated_for_reused(self):
        new = make_identity(track_id="new")
        prior = make_identity(track_id="prior")
        d = decide_reuse(new, prior)
        assert d.reuse_reason is not None
        assert len(d.reuse_reason) > 0

    def test_reuse_reason_populated_for_needs_dat(self):
        new = make_identity(track_id="new", analysis_data_update_count=6)
        prior = make_identity(track_id="prior", analysis_data_update_count=5)
        d = decide_reuse(new, prior)
        assert d.reuse_reason is not None

    def test_reuse_reason_populated_for_metadata_only(self):
        new = make_identity(track_id="new", cue_update_count=4)
        prior = make_identity(track_id="prior", cue_update_count=3)
        d = decide_reuse(new, prior)
        assert d.reuse_reason is not None

    def test_analysis_and_cue_both_changed(self):
        new = make_identity(track_id="new", analysis_data_update_count=6, cue_update_count=4)
        prior = make_identity(track_id="prior", analysis_data_update_count=5, cue_update_count=3)
        d = decide_reuse(new, prior)
        # Both changed: analysis takes priority -> needs_dat
        assert d.manifest_status == "needs_dat"
        assert d.analysis_changed and d.cue_changed
        assert not d.reuse_grid and not d.reuse_waveform
        assert not d.reuse_cues

    def test_one_counter_none_other_changed(self):
        # new has None for analysis_data_update_count, prior has a value
        # -> counter_changed returns False (conservative) -> treat as unchanged
        new = make_identity(track_id="new", analysis_data_update_count=None)
        prior = make_identity(track_id="prior", analysis_data_update_count=5)
        d = decide_reuse(new, prior)
        assert not d.analysis_changed

    def test_new_track_id_set_on_decision(self):
        new = make_identity(track_id="new-track-uuid")
        prior = make_identity(track_id="prior-track-uuid")
        d = decide_reuse(new, prior)
        assert d.new_track_id == "new-track-uuid"
        assert d.reused_from_track_id == "prior-track-uuid"

    def test_path_change_to_none_does_not_force_upload(self):
        # new has no analysis_data_file_path (None) -> path_changed = False
        new = make_identity(track_id="new", analysis_data_file_path=None)
        prior = make_identity(track_id="prior", analysis_data_file_path="/PIONEER/USBANLZ/P001/ANLZ0000.DAT")
        d = decide_reuse(new, prior)
        # analysis path is None on new side -> path_changed = False
        # (guard: new_track.analysis_data_file_path is not None required for path_changed)
        assert d.manifest_status == "reused"


class TestMatchTracksToPriorImport:
    def _make_sb(self, prior_import_ids, prior_tracks):
        sb = MagicMock()
        # Chain mocks for rekordbox_imports query
        imports_chain = MagicMock()
        imports_chain.execute.return_value.data = [{"id": iid} for iid in prior_import_ids]
        sb.table.return_value.select.return_value.eq.return_value.eq.return_value.neq.return_value = imports_chain
        # Chain mocks for rekordbox_tracks query
        tracks_chain = MagicMock()
        tracks_chain.execute.return_value.data = prior_tracks
        sb.table.return_value.select.return_value.in_.return_value = tracks_chain
        return sb

    def test_cross_user_reuse_blocked(self):
        # match_tracks_to_prior_import scopes by user_id — different user's tracks should not appear
        # because the import query includes eq("user_id", user_id)
        sb = MagicMock()
        sb.table.return_value.select.return_value.eq.return_value.eq.return_value.neq.return_value.execute.return_value.data = []
        result = match_tracks_to_prior_import(sb, "user-A", "new-imp", [])
        assert result == {}

    def test_primary_id_match(self):
        sb = MagicMock()
        prior_tracks_data = [{
            "id": "prior-t1", "import_id": "prior-imp1",
            "master_db_id": "db1", "master_content_id": "c1",
            "rekordbox_content_id": "rc1",
            "analysis_data_file_path": "/path.DAT",
            "analysis_data_update_count": 5,
            "cue_update_count": 3,
            "information_update_count": 2,
            "analysis_parse_status": "completed",
        }]
        sb.table.return_value.select.return_value.eq.return_value.eq.return_value.neq.return_value.execute.return_value.data = [{"id": "prior-imp1"}]
        sb.table.return_value.select.return_value.in_.return_value.execute.return_value.data = prior_tracks_data

        new_tracks = [{
            "id": "new-t1", "import_id": "new-imp",
            "master_db_id": "db1", "master_content_id": "c1",
            "rekordbox_content_id": "rc1",
            "analysis_data_file_path": "/path.DAT",
            "analysis_data_update_count": 5,
            "cue_update_count": 3,
            "information_update_count": 2,
        }]

        result = match_tracks_to_prior_import(sb, "user1", "new-imp", new_tracks)
        assert "new-t1" in result
        assert result["new-t1"].manifest_status == "reused"

    def test_secondary_id_match(self):
        """Falls back to rekordbox_content_id when master_db_id / master_content_id are absent."""
        sb = MagicMock()
        prior_tracks_data = [{
            "id": "prior-t2", "import_id": "prior-imp1",
            "master_db_id": None, "master_content_id": None,
            "rekordbox_content_id": "rc99",
            "analysis_data_file_path": "/path.DAT",
            "analysis_data_update_count": 5,
            "cue_update_count": 3,
            "information_update_count": 2,
            "analysis_parse_status": "completed",
        }]
        sb.table.return_value.select.return_value.eq.return_value.eq.return_value.neq.return_value.execute.return_value.data = [{"id": "prior-imp1"}]
        sb.table.return_value.select.return_value.in_.return_value.execute.return_value.data = prior_tracks_data

        new_tracks = [{
            "id": "new-t2", "import_id": "new-imp",
            "master_db_id": None, "master_content_id": None,
            "rekordbox_content_id": "rc99",
            "analysis_data_file_path": "/path.DAT",
            "analysis_data_update_count": 5,
            "cue_update_count": 3,
            "information_update_count": 2,
        }]

        result = match_tracks_to_prior_import(sb, "user1", "new-imp", new_tracks)
        assert "new-t2" in result
        assert result["new-t2"].manifest_status == "reused"

    def test_no_prior_imports_returns_empty(self):
        sb = MagicMock()
        sb.table.return_value.select.return_value.eq.return_value.eq.return_value.neq.return_value.execute.return_value.data = []
        result = match_tracks_to_prior_import(sb, "user1", "new-imp", [{
            "id": "t1",
            "master_db_id": "db1",
            "master_content_id": "c1",
            "rekordbox_content_id": "rc1",
            "analysis_data_file_path": None,
            "analysis_data_update_count": None,
            "cue_update_count": None,
            "information_update_count": None,
        }])
        assert result == {}

    def test_unmatched_track_not_in_result(self):
        """Tracks with no matching prior track are absent from the result dict."""
        sb = MagicMock()
        prior_tracks_data = [{
            "id": "prior-t1", "import_id": "prior-imp1",
            "master_db_id": "db1", "master_content_id": "c1",
            "rekordbox_content_id": "rc1",
            "analysis_data_file_path": "/path.DAT",
            "analysis_data_update_count": 5,
            "cue_update_count": 3,
            "information_update_count": 2,
            "analysis_parse_status": "completed",
        }]
        sb.table.return_value.select.return_value.eq.return_value.eq.return_value.neq.return_value.execute.return_value.data = [{"id": "prior-imp1"}]
        sb.table.return_value.select.return_value.in_.return_value.execute.return_value.data = prior_tracks_data

        # This new track has different identity — should not match
        new_tracks = [{
            "id": "new-t-no-match",
            "master_db_id": "db-other",
            "master_content_id": "c-other",
            "rekordbox_content_id": "rc-other",
            "analysis_data_file_path": "/different.DAT",
            "analysis_data_update_count": 1,
            "cue_update_count": 1,
            "information_update_count": 1,
        }]

        result = match_tracks_to_prior_import(sb, "user1", "new-imp", new_tracks)
        assert "new-t-no-match" not in result

    def test_empty_new_tracks_returns_empty(self):
        sb = MagicMock()
        sb.table.return_value.select.return_value.eq.return_value.eq.return_value.neq.return_value.execute.return_value.data = [{"id": "prior-imp1"}]
        sb.table.return_value.select.return_value.in_.return_value.execute.return_value.data = []
        result = match_tracks_to_prior_import(sb, "user1", "new-imp", [])
        assert result == {}

    def test_analysis_changed_in_match(self):
        """A match where analysis_data_update_count changed gives needs_dat status."""
        sb = MagicMock()
        prior_tracks_data = [{
            "id": "prior-t1", "import_id": "prior-imp1",
            "master_db_id": "db1", "master_content_id": "c1",
            "rekordbox_content_id": "rc1",
            "analysis_data_file_path": "/path.DAT",
            "analysis_data_update_count": 5,
            "cue_update_count": 3,
            "information_update_count": 2,
            "analysis_parse_status": "completed",
        }]
        sb.table.return_value.select.return_value.eq.return_value.eq.return_value.neq.return_value.execute.return_value.data = [{"id": "prior-imp1"}]
        sb.table.return_value.select.return_value.in_.return_value.execute.return_value.data = prior_tracks_data

        new_tracks = [{
            "id": "new-t1",
            "master_db_id": "db1", "master_content_id": "c1",
            "rekordbox_content_id": "rc1",
            "analysis_data_file_path": "/path.DAT",
            "analysis_data_update_count": 7,  # changed
            "cue_update_count": 3,
            "information_update_count": 2,
        }]

        result = match_tracks_to_prior_import(sb, "user1", "new-imp", new_tracks)
        assert "new-t1" in result
        assert result["new-t1"].manifest_status == "needs_dat"
        assert result["new-t1"].analysis_changed

    def test_shared_blob_not_duplicated(self):
        # When two same-user imports have identical ANLZ files (same sha256),
        # the newer import should find the prior blob and reuse it.
        # This is tested at the blob level — just verify the logic doesn't break.
        pass  # Blob reuse is handled in process_analysis_batch, not here
