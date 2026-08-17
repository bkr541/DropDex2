"""Regression coverage for the Rekordbox worker-lease claim SQL repair."""

from pathlib import Path
import re


_REPO_ROOT = Path(__file__).resolve().parents[2]
_MIGRATION = (
    _REPO_ROOT
    / "supabase"
    / "migrations"
    / "20260817130000_rekordbox_worker_lease_claim_fix.sql"
)


def _normalized_sql() -> str:
    return re.sub(r"\s+", " ", _MIGRATION.read_text(encoding="utf-8").lower()).strip()


def test_worker_lease_claim_targets_primary_key_constraint_not_ambiguous_outputs():
    sql = _normalized_sql()

    assert "create or replace function public.claim_rekordbox_import_worker_lease" in sql
    assert "returns table ( acquired boolean, import_id uuid, worker_kind text, owner_token uuid, lease_expires_at timestamptz )" in sql
    assert "on conflict on constraint rekordbox_import_worker_leases_pkey do update" in sql
    assert "on conflict (import_id, worker_kind)" not in sql


def test_worker_lease_claim_repair_preserves_service_role_only_contract():
    raw = _MIGRATION.read_text(encoding="utf-8").strip().lower()
    sql = _normalized_sql()
    signature = (
        "public.claim_rekordbox_import_worker_lease"
        "(uuid, uuid, text, text, uuid, integer)"
    )

    assert "\nbegin;" in raw[:1200]
    assert raw.endswith("commit;")
    assert f"revoke all on function {signature} from public, anon, authenticated" in sql
    assert f"grant execute on function {signature} to service_role" in sql
    assert "notify pgrst, 'reload schema'" in sql
