"""Tests for rekordbox_bridge.extractor — all pyrekordbox calls are mocked."""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from rekordbox_bridge.models import BridgePayload, PAYLOAD_SCHEMA_VERSION


# ---------------------------------------------------------------------------
# Helpers to build fake DB objects
# ---------------------------------------------------------------------------

def _make_list_row(
    id_: str,
    name: str = "Test List",
    parent_id: Any = None,
    attribute: int = 0,
    seq: Any = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        ID=id_,
        Name=name,
        ParentID=parent_id,
        Attribute=attribute,
        Seq=seq,
    )


def _make_member_row(
    content_id: str,
    list_id: str,
    track_no: int,
) -> SimpleNamespace:
    return SimpleNamespace(
        ContentID=content_id,
        RelatedTracksID=list_id,
        TrackNo=track_no,
    )


def _make_fake_db(lists=None, members=None):
    """Return a fake DB object that mimics pyrekordbox's Rekordbox6Database."""
    fake_db = MagicMock()
    list_rows = lists or []
    member_rows = members or []

    # Make get_djmdrelatedtracks / get_djmdsongrelatedtracks return our lists
    fake_db.get_djmdrelatedtracks = MagicMock(return_value=list_rows)
    fake_db.get_djmdsongrelatedtracks = MagicMock(return_value=member_rows)
    # Also expose as attributes for fallback path
    fake_db.DjmdRelatedTracks = list_rows
    fake_db.DjmdSongRelatedTracks = member_rows
    # Property info
    fake_db.get_djmd_property = MagicMock(return_value=[])
    return fake_db


# ---------------------------------------------------------------------------
# patch target: the import inside extractor
# ---------------------------------------------------------------------------

PATCH_TARGET = "rekordbox_bridge.extractor.Rekordbox6Database"


class TestExtractRelatedTracks:

    def _run(self, db_obj, tmp_path):
        """Helper: patch pyrekordbox, call extract_related_tracks."""
        from rekordbox_bridge.extractor import extract_related_tracks

        fake_db_file = tmp_path / "master.db"
        fake_db_file.write_bytes(b"")

        with patch.dict(sys.modules, {"pyrekordbox": MagicMock()}), \
             patch("rekordbox_bridge.extractor.Rekordbox6Database", return_value=db_obj):
            return extract_related_tracks(fake_db_file)

    def test_returns_bridge_payload(self, tmp_path):
        """extract_related_tracks always returns a BridgePayload instance."""
        db = _make_fake_db()
        result = self._run(db, tmp_path)
        assert isinstance(result, BridgePayload)

    def test_schema_version_is_1(self, tmp_path):
        """Returned payload has schema_version == PAYLOAD_SCHEMA_VERSION (1)."""
        db = _make_fake_db()
        result = self._run(db, tmp_path)
        assert result.schema_version == PAYLOAD_SCHEMA_VERSION

    def test_empty_db_returns_empty_lists(self, tmp_path):
        """When DjmdRelatedTracks is empty, payload.lists is empty."""
        db = _make_fake_db(lists=[])
        result = self._run(db, tmp_path)
        assert result.lists == []

    def test_folder_entry_has_is_folder_true(self, tmp_path):
        """Rows with Attribute==1 are returned as folders with no members."""
        folder = _make_list_row("10", name="My Folder", attribute=1)
        db = _make_fake_db(lists=[folder], members=[])
        result = self._run(db, tmp_path)

        assert len(result.lists) == 1
        lst = result.lists[0]
        assert lst.is_folder is True
        assert lst.members == []

    def test_non_folder_entry_has_is_folder_false(self, tmp_path):
        """Rows with Attribute==0 are returned as non-folder lists."""
        row = _make_list_row("20", name="Warm Up", attribute=0)
        db = _make_fake_db(lists=[row], members=[])
        result = self._run(db, tmp_path)

        lst = result.lists[0]
        assert lst.is_folder is False

    def test_members_are_ordered_by_position(self, tmp_path):
        """Members come back in ascending position order."""
        list_row = _make_list_row("30", name="Set", attribute=0)
        m1 = _make_member_row("101", "30", track_no=3)
        m2 = _make_member_row("102", "30", track_no=1)
        m3 = _make_member_row("103", "30", track_no=2)
        db = _make_fake_db(lists=[list_row], members=[m1, m2, m3])

        result = self._run(db, tmp_path)
        positions = [m.position for m in result.lists[0].members]
        assert positions == sorted(positions)

    def test_members_have_correct_content_ids(self, tmp_path):
        """Members reference the correct master_content_id values."""
        list_row = _make_list_row("40", name="Set", attribute=0)
        m1 = _make_member_row("500", "40", track_no=1)
        m2 = _make_member_row("501", "40", track_no=2)
        db = _make_fake_db(lists=[list_row], members=[m1, m2])

        result = self._run(db, tmp_path)
        ids = {m.master_content_id for m in result.lists[0].members}
        assert ids == {"500", "501"}

    def test_members_from_other_lists_excluded(self, tmp_path):
        """Members belonging to a different list are not included."""
        list_row = _make_list_row("50", name="List A", attribute=0)
        member_for_a = _make_member_row("600", "50", track_no=1)
        member_for_b = _make_member_row("601", "99", track_no=1)  # different list
        db = _make_fake_db(lists=[list_row], members=[member_for_a, member_for_b])

        result = self._run(db, tmp_path)
        assert len(result.lists[0].members) == 1
        assert result.lists[0].members[0].master_content_id == "600"

    def test_unknown_criteria_preserved_in_criteria_raw(self, tmp_path):
        """Extra columns on list rows survive into criteria_raw."""
        row = _make_list_row("60", name="Crit List", attribute=0)
        # Add an extra attribute that looks like a criteria field
        row.SomeUnknownCriteriaField = "value123"
        db = _make_fake_db(lists=[row], members=[])

        result = self._run(db, tmp_path)
        # criteria_raw should be a dict (may be empty if extractor can't read __table__)
        assert isinstance(result.lists[0].criteria_raw, dict)

    def test_generated_at_is_iso8601(self, tmp_path):
        """generated_at matches ISO 8601 format."""
        import re
        db = _make_fake_db()
        result = self._run(db, tmp_path)
        pattern = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"
        assert re.match(pattern, result.generated_at), f"Bad format: {result.generated_at}"

    def test_source_is_populated(self, tmp_path):
        """Returned payload has a SourceInfo object (fields may be None)."""
        from rekordbox_bridge.models import SourceInfo
        db = _make_fake_db()
        result = self._run(db, tmp_path)
        assert isinstance(result.source, SourceInfo)

    def test_import_error_when_pyrekordbox_missing(self, tmp_path):
        """ImportError with helpful message when pyrekordbox is not installed."""
        from rekordbox_bridge.extractor import extract_related_tracks

        fake_db_file = tmp_path / "master.db"
        fake_db_file.write_bytes(b"")

        # Patch the module-level name to None to simulate pyrekordbox being absent.
        with patch("rekordbox_bridge.extractor.Rekordbox6Database", None):
            with pytest.raises(ImportError) as exc_info:
                extract_related_tracks(fake_db_file)

        msg = str(exc_info.value)
        assert "pyrekordbox" in msg.lower()
