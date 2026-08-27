import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260827030000_genre_round_trip_final_hardening_stage7.sql', import.meta.url),
  'utf8',
);

describe('Genre Editing Stage 7 round-trip hardening migration', () => {
  it('blocks hard delete for recovery first and then any unresolved pending Genre intent', () => {
    expect(migration).toContain('create or replace function public.rekordbox_import_metadata_delete_block_v1');
    expect(migration).toContain("return 'recovery';");
    expect(migration).toContain('d.pending_value is distinct from d.current_baseline_value');
    expect(migration).toContain("return 'pending';");
    expect(migration).toContain(
      'revoke all on function public.rekordbox_import_metadata_delete_block_v1(uuid, uuid)',
    );
    expect(migration).toContain(
      'grant execute on function public.rekordbox_import_metadata_delete_block_v1(uuid, uuid)',
    );
    expect(migration).toContain('to service_role;');
  });

  it('rechecks the metadata deletion predicate at both destructive transaction boundaries', () => {
    expect(migration.match(/create or replace function public\.begin_rekordbox_import_hard_delete/g)).toHaveLength(1);
    expect(migration.match(/create or replace function public\.hard_delete_rekordbox_import/g)).toHaveLength(1);
    expect(migration.match(/public\.rekordbox_import_metadata_delete_block_v1\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration.match(/metadata_delete_blocked:/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration.match(/pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 0\)\)/g)).toHaveLength(2);
  });

  it('prevents a deleting import from gaining new unresolved drafts and protects recovery rows from cascade delete', () => {
    expect(migration).toContain('create or replace function public.guard_track_metadata_draft_delete_lifecycle_v1');
    expect(migration).toContain("if tg_op = 'DELETE' then");
    expect(migration).toContain("raise exception 'metadata_draft_recovery_locked'");
    expect(migration).toContain("v_import_status in ('cancel_requested', 'stopping', 'deleting', 'cancelled')");
    expect(migration).toContain("raise exception 'metadata_draft_import_deleting'");
    expect(migration).toContain('before insert or update or delete on public.track_metadata_drafts');
  });

  it('clears stale applied proof when the latest operation did not apply locally', () => {
    expect(migration).toContain('create or replace function public.normalize_track_metadata_apply_evidence_v1');
    expect(migration).toContain(
      "new.last_apply_state in ('rejected', 'failed', 'rolled-back', 'recovery-unverified')",
    );
    expect(migration).toContain('new.applied_revision := null;');
    expect(migration).toContain('new.applied_value := null;');
    expect(migration).toContain('new.applied_at := null;');
    expect(migration).toContain('new.cloud_finalized_at := null;');
    expect(migration).toContain('old.last_apply_operation_id is distinct from new.last_apply_operation_id');
    expect(migration).toContain('new.applied_at := now();');
    expect(migration).toContain('track_metadata_drafts_non_success_has_no_applied_evidence');
  });
});
