"""Stage 5 DjmdCue staging writer and verifier tests."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

import pytest

from rekordbox_bridge.writer import (
    HOT_KIND_BY_SLOT,
    StagingWriterError,
    build_djmdcue_values,
    mutate_staging_database,
    verify_staging_database,
)
from rekordbox_bridge.writer_models import PlannedCue
from rekordbox_bridge.writer_plan import adapt_saved_cue_drafts
from rekordbox_bridge.security import create_backup_and_staging, file_identity


CUE_COLUMNS = [
    "ID", "ContentID", "ContentUUID", "UUID", "InMsec", "InFrame", "InMpegFrame",
    "InMpegAbs", "OutMsec", "OutFrame", "OutMpegFrame", "OutMpegAbs", "Kind",
    "Color", "ColorTableIndex", "ActiveLoop", "Comment", "BeatLoopSize", "CueMicrosec",
]


class DjmdCue:
    @classmethod
    def create(cls, **kwargs):
        return SimpleNamespace(**kwargs)


class Tables:
    DjmdCue = DjmdCue


class SqliteTestDb:
    """Small disposable physical-DB adapter with the pyrekordbox methods Stage 5 uses."""

    def __init__(self, path: str):
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row

    def get_content(self, **filters):
        row = self.conn.execute(
            "select ID, UUID from djmdContent where ID = ?", (str(filters["ID"]),)
        ).fetchone()
        return None if row is None else SimpleNamespace(ID=row["ID"], UUID=row["UUID"])

    def get_cue(self, **filters):
        rows = self.conn.execute(
            "select " + ",".join(CUE_COLUMNS) + " from djmdCue where ContentID = ?",
            (str(filters["ContentID"]),),
        ).fetchall()
        return [SimpleNamespace(**dict(row)) for row in rows]

    def generate_unused_id(self, _table):
        row = self.conn.execute("select max(cast(ID as integer)) as max_id from djmdCue").fetchone()
        return int(row["max_id"] or 0) + 1

    def delete(self, cue):
        self.conn.execute("delete from djmdCue where ID = ?", (str(cue.ID),))

    def add(self, cue):
        values = [getattr(cue, column, None) for column in CUE_COLUMNS]
        placeholders = ",".join("?" for _ in CUE_COLUMNS)
        self.conn.execute(
            f"insert into djmdCue ({','.join(CUE_COLUMNS)}) values ({placeholders})",
            values,
        )

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()

    def close(self):
        self.conn.close()


def init_fixture(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute("create table djmdContent (ID text primary key, UUID text not null)")
    conn.execute(
        """create table djmdCue (
        ID text primary key, ContentID text, ContentUUID text, UUID text,
        InMsec integer, InFrame integer, InMpegFrame integer, InMpegAbs integer,
        OutMsec integer, OutFrame integer, OutMpegFrame integer, OutMpegAbs integer,
        Kind integer, Color integer, ColorTableIndex integer, ActiveLoop integer,
        Comment text, BeatLoopSize integer, CueMicrosec integer
        )"""
    )
    conn.execute("insert into djmdContent values (?, ?)", ("101", "local-uuid-101"))
    conn.execute("insert into djmdContent values (?, ?)", ("202", "local-uuid-202"))
    for cue_id, content_id in (("10", "101"), ("20", "202")):
        conn.execute(
            "insert into djmdCue values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                cue_id, content_id, f"local-uuid-{content_id}", f"old-{cue_id}",
                500, 0, 0, 0, -1, -1, -1, -1, 0, -1, None, -1,
                "existing", 0, 0,
            ),
        )
    conn.commit()
    conn.close()


def draft_cue(**overrides):
    value = {
        "family": "hot",
        "hotCueSlot": 1,
        "pointType": "cue",
        "startMs": 1000,
        "endMs": None,
        "colorTableIndex": 18,
        "colorHex": None,
        "colorName": "Green",
        "comment": "A",
        "isActiveLoop": False,
        "beatLoopNumerator": None,
        "beatLoopDenominator": None,
        "rekordboxKind": 1,
    }
    value.update(overrides)
    return value


def draft_row(content_id="101", cues=None):
    return {
        "revision": 4,
        "desiredFingerprint": "a" * 64,
        "importedBaselineFingerprint": "b" * 64,
        "importId": "import-1",
        "trackId": f"track-{content_id}",
        "rekordboxContentId": content_id,
        "desiredDocument": {
            "schemaVersion": 1,
            "importId": "import-1",
            "trackId": f"track-{content_id}",
            "rekordboxContentId": content_id,
            "cues": list(cues or [draft_cue()]),
            # Must never be trusted by writer:
            "ContentUUID": "cloud-bogus",
        },
    }


def planned_cue(**overrides) -> PlannedCue:
    values = dict(
        family="hot",
        hot_cue_slot=1,
        point_type="cue",
        start_ms=1000.0,
        end_ms=None,
        color_table_index=18,
        color_hex=None,
        color_name="Green",
        comment="A",
        is_active_loop=False,
        beat_loop_numerator=None,
        beat_loop_denominator=None,
        rekordbox_kind=1,
    )
    values.update(overrides)
    return PlannedCue(**values)


class TestDjmdCueBuilder:
    @pytest.mark.parametrize("slot,kind", sorted(HOT_KIND_BY_SLOT.items()))
    def test_hot_cue_a_through_h_kind_mapping(self, slot, kind):
        cue = planned_cue(hot_cue_slot=slot, rekordbox_kind=kind)
        row = build_djmdcue_values(
            cue, content_id="101", content_uuid="local-u", cue_id="1", cue_uuid="cue-u"
        )
        assert row["Kind"] == kind

    def test_memory_kind_is_zero(self):
        cue = planned_cue(
            family="memory", hot_cue_slot=None, rekordbox_kind=None, color_name="Red"
        )
        row = build_djmdcue_values(
            cue, content_id="101", content_uuid="local-u", cue_id="1", cue_uuid="cue-u"
        )
        assert row["Kind"] == 0
        assert row["Color"] == 1

    def test_point_uses_djcues_out_sentinels(self):
        row = build_djmdcue_values(
            planned_cue(), content_id="101", content_uuid="u", cue_id="1", cue_uuid="x"
        )
        assert (
            row["OutMsec"],
            row["OutFrame"],
            row["OutMpegFrame"],
            row["OutMpegAbs"],
        ) == (-1, -1, -1, -1)
        assert row["ActiveLoop"] == -1
        assert row["BeatLoopSize"] == 0
        assert row["CueMicrosec"] == 0

    def test_loop_uses_djcues_loop_fields_and_active_flag(self):
        row = build_djmdcue_values(
            planned_cue(point_type="loop", end_ms=5000, is_active_loop=True),
            content_id="101", content_uuid="u", cue_id="1", cue_uuid="x",
        )
        assert row["OutMsec"] == 5000
        assert (row["OutFrame"], row["OutMpegFrame"], row["OutMpegAbs"]) == (0, 0, 0)
        assert row["ActiveLoop"] == 1
        assert row["Color"] == 255

    def test_comment_and_color_index_are_preserved(self):
        row = build_djmdcue_values(
            planned_cue(comment="Drop", color_table_index=42),
            content_id="101", content_uuid="u", cue_id="1", cue_uuid="x",
        )
        assert row["Comment"] == "Drop"
        assert row["ColorTableIndex"] == 42


class TestStagingMutationAndVerification:
    def setup_generation(self, tmp_path):
        source = tmp_path / "master.db"
        init_fixture(source)
        before = file_identity(source)
        generation = create_backup_and_staging(
            source,
            operation_id="writerfixture123",
            now=datetime(2026, 8, 20, 18, 0, tzinfo=timezone.utc),
        )
        return source, before, generation

    def test_disposable_physical_staging_db_is_mutated_and_reopened(self, tmp_path):
        source, before, generation = self.setup_generation(tmp_path)
        plan = adapt_saved_cue_drafts([
            draft_row(cues=[
                draft_cue(hotCueSlot=1, rekordboxKind=1, comment="First"),
                draft_cue(
                    family="memory", hotCueSlot=None, rekordboxKind=None,
                    startMs=2000, colorTableIndex=4, colorName="Green", comment="Memory",
                ),
                draft_cue(
                    hotCueSlot=8, rekordboxKind=9, pointType="loop", startMs=3000,
                    endMs=5000, isActiveLoop=True, colorTableIndex=0, comment="Loop",
                ),
            ])
        ])
        expected = mutate_staging_database(
            plan, generation, database_factory=SqliteTestDb, tables_module=Tables,
            uuid_factory=lambda: UUID("00000000-0000-0000-0000-000000000001"),
        )
        verification = verify_staging_database(
            plan, generation, expected, database_factory=SqliteTestDb
        )
        assert verification.ok is True
        assert verification.verified_content_ids == ("101",)
        assert file_identity(source) == before
        assert file_identity(source) == generation.source_identity
        assert file_identity(generation.staging_path) != before

    def test_content_uuid_is_resolved_from_local_staging_not_saved_document(self, tmp_path):
        _, _, generation = self.setup_generation(tmp_path)
        plan = adapt_saved_cue_drafts([draft_row()])
        expected = mutate_staging_database(
            plan, generation, database_factory=SqliteTestDb, tables_module=Tables
        )
        assert expected["101"][0]["ContentUUID"] == "local-uuid-101"
        assert expected["101"][0]["ContentUUID"] != "cloud-bogus"

    def test_only_planned_content_id_is_replaced(self, tmp_path):
        _, _, generation = self.setup_generation(tmp_path)
        plan = adapt_saved_cue_drafts([draft_row(content_id="101")])
        mutate_staging_database(
            plan, generation, database_factory=SqliteTestDb, tables_module=Tables
        )
        db = SqliteTestDb(str(generation.staging_path))
        try:
            planned = db.get_cue(ContentID="101")
            untouched = db.get_cue(ContentID="202")
        finally:
            db.close()
        assert len(planned) == 1
        assert planned[0].Comment == "A"
        assert len(untouched) == 1
        assert untouched[0].Comment == "existing"
        assert untouched[0].ID == "20"

    def test_missing_content_id_fails_before_any_delete(self, tmp_path):
        _, _, generation = self.setup_generation(tmp_path)
        plan = adapt_saved_cue_drafts([
            draft_row(content_id="101"), draft_row(content_id="999")
        ])
        with pytest.raises(StagingWriterError, match="does not exist"):
            mutate_staging_database(
                plan, generation, database_factory=SqliteTestDb, tables_module=Tables
            )
        db = SqliteTestDb(str(generation.staging_path))
        try:
            still_there = db.get_cue(ContentID="101")
        finally:
            db.close()
        assert len(still_there) == 1
        assert still_there[0].Comment == "existing"

    def test_verifier_reports_mismatch(self, tmp_path):
        _, _, generation = self.setup_generation(tmp_path)
        plan = adapt_saved_cue_drafts([draft_row()])
        expected = mutate_staging_database(
            plan, generation, database_factory=SqliteTestDb, tables_module=Tables
        )
        db = SqliteTestDb(str(generation.staging_path))
        db.conn.execute("update djmdCue set Comment='tampered' where ContentID='101'")
        db.commit()
        db.close()
        verification = verify_staging_database(
            plan, generation, expected, database_factory=SqliteTestDb
        )
        assert verification.ok is False
        assert verification.mismatches[0].content_id == "101"

    def test_corrupt_staging_db_fails_without_source_mutation(self, tmp_path):
        source, before, generation = self.setup_generation(tmp_path)
        generation.staging_path.write_bytes(b"not sqlite")
        plan = adapt_saved_cue_drafts([draft_row()])
        with pytest.raises(StagingWriterError, match="Could not resolve planned ContentID"):
            mutate_staging_database(
                plan, generation, database_factory=SqliteTestDb, tables_module=Tables
            )
        assert file_identity(source) == before
