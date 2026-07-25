"""Regression coverage for the fast-path migration and terminal import guard."""

from pathlib import Path
import re


_REPO_ROOT = Path(__file__).resolve().parents[2]
_FAST_PATH = _REPO_ROOT / "supabase" / "migrations" / "20260725010000_rekordbox_import_fast_path.sql"
_WORKER_SAFETY = _REPO_ROOT / "supabase" / "migrations" / "20260724010000_usb_stream_analysis_worker_safety.sql"


def _normalized_sql(path: Path) -> str:
    return re.sub(r"\s+", " ", path.read_text(encoding="utf-8").lower()).strip()


def test_fast_path_backfill_excludes_statuses_blocked_by_child_write_trigger():
    fast_path = _normalized_sql(_FAST_PATH)
    worker_safety = _normalized_sql(_WORKER_SAFETY)

    trigger_match = re.search(
        r"parent_status in \((?P<statuses>[^)]+)\)",
        worker_safety,
    )
    assert trigger_match is not None
    blocked_statuses = {
        token.strip().strip("'")
        for token in trigger_match.group("statuses").split(",")
    }

    backfill_match = re.search(
        r"update public\.rekordbox_tracks as track .*?;",
        fast_path,
    )
    assert backfill_match is not None
    backfill = backfill_match.group(0)

    assert "not exists" in backfill
    assert "import_job.id = track.import_id" in backfill
    for status in blocked_statuses:
        assert f"'{status}'" in backfill


def test_fast_path_migration_is_atomic_for_dashboard_execution():
    sql = _FAST_PATH.read_text(encoding="utf-8").strip().lower()

    assert sql.startswith("-- dropdex")
    assert "\nbegin;" in sql[:300]
    assert sql.endswith("commit;")
