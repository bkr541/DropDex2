import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260827020000_track_metadata_finalization_stage6a.sql', import.meta.url),
  'utf8',
);

describe('Genre Editing Stage 6A metadata finalization contract', () => {
  it('keeps canonical Genre convergence inside one narrow SECURITY DEFINER finalizer', () => {
    expect(migration).toContain('create or replace function public.finalize_track_metadata_apply_v1');
    expect(migration).toContain('security definer');
    expect(migration).toContain('for update of t');
    expect(migration).toContain('for update;');
    expect(migration).toContain('update public.rekordbox_tracks');
    expect(migration).toContain('set genre = v_applied_value');
    expect(migration).toContain('set current_baseline_value = v_applied_value');
    expect(migration).toContain("last_apply_state = 'applied'");
    expect(migration).not.toMatch(/grant\s+update\s+on\s+public\.rekordbox_tracks\s+to\s+authenticated/i);
  });

  it('binds finalization to revision, draft fingerprint, operation, plan, identity, value, and baseline', () => {
    for (const expected of [
      'v_current.revision <> p_revision',
      'v_current.draft_fingerprint <> lower(p_draft_fingerprint)',
      'v_current.last_apply_operation_id <> p_operation_id',
      'v_current.last_apply_plan_fingerprint <> lower(p_plan_fingerprint)',
      'v_current.pending_value is distinct from v_applied_value',
      'v_track.genre is distinct from v_expected_baseline',
      'v_current.master_db_id <> p_master_db_id',
      'v_track.master_content_id <> p_master_content_id',
      'v_current.last_apply_source_identity_after <> lower(p_source_identity_after)',
    ]) expect(migration).toContain(expected);
  });

  it('persists distinct recovery/outcome states without rebasing failed attempts', () => {
    expect(migration).toContain('create or replace function public.mark_track_metadata_apply_outcome_v1');
    expect(migration).toContain("'rejected'");
    expect(migration).toContain("'failed'");
    expect(migration).toContain("'rolled-back'");
    expect(migration).toContain("'recovery-unverified'");
    expect(migration).toContain("'cloud-finalization-pending'");
    expect(migration).toContain("'cloud-finalization-failed'");
    expect(migration).toContain('safe_track_metadata_apply_summary_v1');
  });

  it('locks ordinary Save and Discard while recovery evidence is unresolved', () => {
    expect(migration.match(/metadata_draft_recovery_locked/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("v_current.last_apply_state in ('cloud-finalization-pending', 'cloud-finalization-failed', 'recovery-unverified')");
  });

  it('has an explicit lost-response idempotency branch after finalization rebase', () => {
    expect(migration).toContain("v_current.last_apply_state = 'applied'");
    expect(migration).toContain('v_current.last_apply_draft_fingerprint = lower(p_draft_fingerprint)');
    expect(migration).toContain('v_current.current_baseline_value is not distinct from v_applied_value');
    expect(migration).toContain('return next v_current;');
  });
});
