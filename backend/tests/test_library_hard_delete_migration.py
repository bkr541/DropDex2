"""Regression coverage for Rekordbox hard-delete database safety semantics."""

from pathlib import Path
import re


_REPO_ROOT = Path(__file__).resolve().parents[2]
_MIGRATION = (
    _REPO_ROOT
    / "supabase"
    / "migrations"
    / "20260816020000_rekordbox_hard_delete_correctness_stage1.sql"
)


def _normalized_sql() -> str:
    return re.sub(r"\s+", " ", _MIGRATION.read_text(encoding="utf-8").lower()).strip()


def test_hard_delete_migration_is_atomic_and_service_role_only():
    raw = _MIGRATION.read_text(encoding="utf-8").strip().lower()
    sql = _normalized_sql()

    assert "\nbegin;" in raw[:500]
    assert raw.endswith("commit;")
    assert "create or replace function public.hard_delete_rekordbox_import" in sql
    assert "delete from public.rekordbox_imports" in sql
    assert (
        "revoke all on function public.hard_delete_rekordbox_import(uuid, uuid, text) "
        "from public, anon, authenticated"
    ) in sql
    assert (
        "grant execute on function public.hard_delete_rekordbox_import(uuid, uuid, text) "
        "to service_role"
    ) in sql


def test_canonical_library_usable_rule_requires_readiness_and_safe_status():
    sql = _normalized_sql()
    function_match = re.search(
        r"create or replace function public\.rekordbox_import_is_library_usable"
        r"\( p_status text, p_library_ready_at timestamptz \).*?\$\$;",
        sql,
    )

    assert function_match is not None
    function_sql = function_match.group(0)
    assert "p_library_ready_at is not null" in function_sql
    assert "p_status in ('completed', 'paused', 'interrupted')" in function_sql


def test_activation_and_fallback_share_canonical_library_rule():
    sql = _normalized_sql()

    assert "p_active_strategy not in ('activate_next', 'start_over')" in sql
    assert sql.count("rekordbox_import_is_library_usable(status, library_ready_at)") >= 3
    assert "insert into public.rekordbox_user_settings" in sql
    assert "active_import_id = excluded.active_import_id" in sql
    assert "v_next_active := null" in sql


def test_dependency_table_protects_source_and_cascades_dependent_cleanup():
    sql = _normalized_sql()

    assert "create table if not exists public.rekordbox_retained_analysis_dependencies" in sql
    assert (
        "source_import_id uuid not null references public.rekordbox_imports(id) "
        "on delete restrict"
    ) in sql
    assert (
        "dependent_import_id uuid not null references public.rekordbox_imports(id) "
        "on delete cascade"
    ) in sql
    assert (
        "source_track_id uuid not null references public.rekordbox_tracks(id) on delete restrict"
    ) in sql
    assert (
        "dependent_track_id uuid not null references public.rekordbox_tracks(id) on delete cascade"
    ) in sql


def test_dependency_registration_and_delete_start_share_serialization_lock():
    sql = _normalized_sql()
    lock = "pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0))"
    delete_lock = "pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0))"

    assert lock in sql
    assert delete_lock in sql
    assert "create or replace function public.begin_rekordbox_import_hard_delete" in sql
    assert "where source_import_id = p_import_id ) then return false" in sql
    assert "raise exception 'retained-analysis dependency still active'" in sql


def test_dependency_rpcs_are_service_role_only():
    sql = _normalized_sql()

    for signature in (
        "replace_rekordbox_retained_analysis_dependencies(uuid, jsonb)",
        "release_rekordbox_retained_analysis_dependencies(uuid, uuid[])",
        "reconcile_rekordbox_retained_analysis_dependencies(uuid)",
        "begin_rekordbox_import_hard_delete(uuid, uuid)",
    ):
        assert f"revoke all on function public.{signature} from public, anon, authenticated" in sql
        assert f"grant execute on function public.{signature} to service_role" in sql
