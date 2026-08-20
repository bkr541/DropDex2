from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from rekordbox_bridge.cue_writer import (
    CueWriterError,
    build_djmd_cue_fields,
    inspect_staging_plan,
    verify_staging_plan,
    write_plan_to_staging,
)
from rekordbox_bridge.writer_models import CueApplyPlan, CueIntent, TrackCueIntent


class FakeCueTable:
    @staticmethod
    def create(**kwargs):
        return SimpleNamespace(**kwargs)


class FakeDb:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.data = json.loads(self.path.read_text())
        self.pending_delete: list[SimpleNamespace] = []
        self.pending_add: list[SimpleNamespace] = []
        self.next_id = 9000
        self.closed = False
        self.rolled_back = False

    def get_content(self, **kwargs):
        content_id = str(kwargs["ID"])
        item = self.data["contents"].get(content_id)
        if item is None:
            return None
        return SimpleNamespace(ID=content_id, UUID=item["UUID"])

    def get_cue(self, **kwargs):
        content_id = str(kwargs["ContentID"])
        item = self.data["contents"].get(content_id)
        if item is None:
            return []
        return [SimpleNamespace(**row) for row in item.get("cues", [])]

    def delete(self, row):
        self.pending_delete.append(row)

    def generate_unused_id(self, _table):
        self.next_id += 1
        return self.next_id

    def add(self, row):
        self.pending_add.append(row)

    def commit(self):
        touched = {str(row.ContentID) for row in self.pending_delete + self.pending_add}
        for content_id in touched:
            additions = [row for row in self.pending_add if str(row.ContentID) == content_id]
            self.data["contents"][content_id]["cues"] = [vars(row).copy() for row in additions]
        self.path.write_text(json.dumps(self.data, sort_keys=True))
        self.pending_delete.clear()
        self.pending_add.clear()

    def rollback(self):
        self.rolled_back = True
        self.pending_delete.clear()
        self.pending_add.clear()

    def close(self):
        self.closed = True


def fake_db_factory(path: Path):
    return FakeDb(path)


def make_db(path: Path):
    path.write_text(json.dumps({
        "contents": {
            "100": {
                "UUID": "content-uuid-100",
                "cues": [
                    {
                        "ID": "old-1", "UUID": "old-u1", "ContentID": "100",
                        "ContentUUID": "content-uuid-100", "Kind": 1, "InMsec": 111,
                        "InFrame": 0, "InMpegFrame": 0, "InMpegAbs": 0,
                        "OutMsec": -1, "OutFrame": -1, "OutMpegFrame": -1,
                        "OutMpegAbs": -1, "Color": -1, "ColorTableIndex": 18,
                        "ActiveLoop": -1, "Comment": "old", "BeatLoopSize": 0,
                        "CueMicrosec": 0,
                    }
                ],
            },
            "200": {
                "UUID": "content-uuid-200",
                "cues": [
                    {
                        "ID": "keep-1", "UUID": "keep-u1", "ContentID": "200",
                        "ContentUUID": "content-uuid-200", "Kind": 0, "InMsec": 222,
                        "InFrame": 0, "InMpegFrame": 0, "InMpegAbs": 0,
                        "OutMsec": -1, "OutFrame": -1, "OutMpegFrame": -1,
                        "OutMpegAbs": -1, "Color": 4, "ColorTableIndex": None,
                        "ActiveLoop": -1, "Comment": "keep", "BeatLoopSize": 0,
                        "CueMicrosec": 0,
                    }
                ],
            },
        }
    }, sort_keys=True))


@pytest.mark.parametrize(
    ("slot", "kind"),
    [(1, 1), (2, 2), (3, 3), (4, 5), (5, 6), (6, 7), (7, 8), (8, 9)],
)
def test_hot_cue_kind_mapping_a_through_h(slot, kind):
    fields = build_djmd_cue_fields(
        CueIntent(family="hot", hot_cue_slot=slot, point_type="cue", start_ms=1234)
    )
    assert fields.Kind == kind
    assert fields.OutMsec == -1
    assert fields.OutFrame == -1
    assert fields.BeatLoopSize == 0
    assert fields.CueMicrosec == 0


def test_loop_uses_djcues_frame_and_out_defaults():
    fields = build_djmd_cue_fields(
        CueIntent(
            family="hot", hot_cue_slot=2, point_type="loop", start_ms=1000, end_ms=9000,
        )
    )
    assert fields.Kind == 2
    assert fields.OutMsec == 9000
    assert fields.OutFrame == 0
    assert fields.OutMpegFrame == 0
    assert fields.OutMpegAbs == 0
    assert fields.ActiveLoop == 0


def test_explicit_color_and_comment_are_preserved_with_djcues_loop_flag():
    fields = build_djmd_cue_fields(
        CueIntent(
            family="hot", hot_cue_slot=8, point_type="loop", start_ms=1000, end_ms=5000,
            color=77, color_table_index=12, comment="Custom", is_active_loop=True,
        )
    )
    assert fields.Color == 77
    assert fields.ColorTableIndex == 12
    assert fields.Comment == "Custom"
    assert fields.ActiveLoop == 0


def test_memory_defaults_can_derive_from_paired_hot_slot():
    fields = build_djmd_cue_fields(
        CueIntent(
            family="memory", paired_hot_cue_slot=4, point_type="cue", start_ms=4000,
        )
    )
    assert fields.Kind == 0
    assert fields.Color == 1
    assert fields.ColorTableIndex is None
    assert fields.Comment == "Drop"


def test_inspect_reports_missing_content_before_mutation(tmp_path):
    db = tmp_path / "master.db"
    make_db(db)
    plan = CueApplyPlan(tracks=(TrackCueIntent("999"),))
    result = inspect_staging_plan(db, plan, db_factory=fake_db_factory)
    assert result[0].found is False


def test_writer_resolves_content_uuid_locally_and_only_replaces_planned_track(tmp_path):
    db = tmp_path / "master.db"
    make_db(db)
    plan = CueApplyPlan(tracks=(
        TrackCueIntent("100", (
            CueIntent(
                family="hot", hot_cue_slot=4, point_type="cue", start_ms=32000,
                comment="Drop",
            ),
            CueIntent(
                family="memory", paired_hot_cue_slot=4, point_type="cue", start_ms=16000,
                comment="Before Drop",
            ),
        )),
    ))
    before_unplanned = json.loads(db.read_text())["contents"]["200"]
    written = write_plan_to_staging(
        db,
        plan,
        db_factory=fake_db_factory,
        cue_table=FakeCueTable,
    )
    data = json.loads(db.read_text())
    assert written == 2
    assert len(data["contents"]["100"]["cues"]) == 2
    assert all(row["ContentUUID"] == "content-uuid-100" for row in data["contents"]["100"]["cues"])
    assert data["contents"]["200"] == before_unplanned


def test_writer_refuses_missing_content_without_deleting_existing(tmp_path):
    db = tmp_path / "master.db"
    make_db(db)
    before = db.read_bytes()
    plan = CueApplyPlan(tracks=(TrackCueIntent("100"), TrackCueIntent("999")))
    with pytest.raises(CueWriterError, match="missing"):
        write_plan_to_staging(db, plan, db_factory=fake_db_factory, cue_table=FakeCueTable)
    assert db.read_bytes() == before


def test_verifier_detects_mismatch(tmp_path):
    db = tmp_path / "master.db"
    make_db(db)
    plan = CueApplyPlan(tracks=(
        TrackCueIntent("100", (
            CueIntent(family="hot", hot_cue_slot=4, point_type="cue", start_ms=99999),
        )),
    ))
    result = verify_staging_plan(db, plan, db_factory=fake_db_factory)
    assert result.verified is False
    assert result.mismatches == ("Cue verification mismatch for ContentID 100",)
