"""Static regression coverage for Genre Stage 7 database hardening."""

from pathlib import Path
import re


_REPO_ROOT = Path(__file__).resolve().parents[2]
_MIGRATION = (
    _REPO_ROOT
    / "supabase"
    / "migrations"
    / "20260827030000_genre_round_trip_final_hardening_stage7.sql"
)


def _sql() -> str:
    return re.sub(r"\s+", " ", _MIGRATION.read_text(encoding="utf-8").lower()).strip()


def test_delete_block_is_service_owned_and_covers_pending_and_recovery_states():
    sql = _sql()

    assert "create or replace function public.rekordbox_import_metadata_delete_block_v1" in sql
    assert "d.pending_value is distinct from d.current_baseline_value" in sql
    for state in (
        "cloud-finalization-pending",
        "cloud-finalization-failed",
        "recovery-unverified",
    ):
        assert state in sql
    assert (
        "revoke all on function public.rekordbox_import_metadata_delete_block_v1(uuid, uuid) "
        "from public, anon, authenticated"
    ) in sql
    assert (
        "grant execute on function public.rekordbox_import_metadata_delete_block_v1(uuid, uuid) "
        "to service_role"
    ) in sql


def test_both_hard_delete_transactions_recheck_metadata_under_user_lock():
    sql = _sql()

    assert sql.count("public.rekordbox_import_metadata_delete_block_v1(") >= 3
    assert sql.count("metadata_delete_blocked:%") == 2
    assert sql.count("pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0))") == 2
    assert "create or replace function public.begin_rekordbox_import_hard_delete" in sql
    assert "create or replace function public.hard_delete_rekordbox_import" in sql


def test_draft_lifecycle_guard_closes_delete_races_without_blocking_normal_resolution():
    sql = _sql()

    assert "create or replace function public.guard_track_metadata_draft_delete_lifecycle_v1" in sql
    assert "if tg_op = 'delete' then" in sql
    assert "raise exception 'metadata_draft_recovery_locked'" in sql
    assert "new.pending_value is distinct from new.current_baseline_value" in sql
    assert "v_import_status in ('cancel_requested', 'stopping', 'deleting', 'cancelled')" in sql
    assert "raise exception 'metadata_draft_import_deleting'" in sql
    assert "before insert or update or delete on public.track_metadata_drafts" in sql


def test_non_success_operation_evidence_cannot_inherit_old_applied_proof():
    sql = _sql()

    assert "create or replace function public.normalize_track_metadata_apply_evidence_v1" in sql
    assert "new.applied_revision := null" in sql
    assert "new.applied_value := null" in sql
    assert "new.applied_at := null" in sql
    assert "new.cloud_finalized_at := null" in sql
    assert "old.last_apply_operation_id is distinct from new.last_apply_operation_id" in sql
    assert "new.applied_at := now()" in sql
    assert "track_metadata_drafts_non_success_has_no_applied_evidence" in sql
