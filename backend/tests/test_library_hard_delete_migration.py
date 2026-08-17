"""Regression coverage for Rekordbox library hard-delete database semantics."""

from pathlib import Path
import re


_REPO_ROOT = Path(__file__).resolve().parents[2]
_MIGRATION = _REPO_ROOT / "supabase" / "migrations" / "20260816010000_rekordbox_library_hard_delete.sql"


def _normalized_sql() -> str:
    return re.sub(r"\s+", " ", _MIGRATION.read_text(encoding="utf-8").lower()).strip()


def test_hard_delete_migration_is_atomic_and_service_role_only():
    raw = _MIGRATION.read_text(encoding="utf-8").strip().lower()
    sql = _normalized_sql()

    assert "\nbegin;" in raw[:400]
    assert raw.endswith("commit;")
    assert "create or replace function public.hard_delete_rekordbox_import" in sql
    assert "delete from public.rekordbox_imports" in sql
    assert "revoke all on function public.hard_delete_rekordbox_import(uuid, uuid, text) from authenticated" in sql
    assert "grant execute on function public.hard_delete_rekordbox_import(uuid, uuid, text) to service_role" in sql


def test_hard_delete_repairs_active_selection_or_persists_start_over():
    sql = _normalized_sql()

    assert "p_active_strategy not in ('activate_next', 'start_over')" in sql
    assert "status in ('completed', 'paused', 'interrupted')" in sql
    assert "insert into public.rekordbox_user_settings" in sql
    assert "active_import_id = excluded.active_import_id" in sql
    assert "v_next_active := null" in sql


def test_set_active_import_rejects_non_usable_snapshots():
    sql = _normalized_sql()
    function_match = re.search(
        r"create or replace function public\.set_active_import\(p_import_id uuid\).*?end; \$\$;",
        sql,
    )

    assert function_match is not None
    function_sql = function_match.group(0)
    assert "status in ('completed', 'paused', 'interrupted')" in function_sql
    assert "failed" not in function_sql
    assert "cancelled" not in function_sql
