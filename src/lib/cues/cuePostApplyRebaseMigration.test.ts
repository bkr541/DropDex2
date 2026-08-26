import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260826020000_cue_post_apply_rebase_stage10.sql', import.meta.url),
  'utf8',
);

describe('Stage 10 post-Apply rebase migration contract', () => {
  it('separates immutable import provenance from the moving current comparison baseline', () => {
    expect(migration).toContain('add column if not exists current_baseline_fingerprint text');
    expect(migration).toContain('add column if not exists current_baseline_local_cue_fingerprint text');
    expect(migration).toContain('current_baseline_fingerprint = lower(p_desired_fingerprint)');
    expect(migration).toContain('current_baseline_local_cue_fingerprint = lower(p_post_apply_local_cue_fingerprint)');

    const v3 = migration.slice(migration.indexOf('create or replace function public.mark_cue_draft_applied_v3'));
    expect(v3).not.toContain('imported_baseline_fingerprint = lower(p_desired_fingerprint)');
    expect(v3).not.toContain('imported_baseline_local_cue_fingerprint = lower(p_post_apply_local_cue_fingerprint)');
  });

  it('makes verified rebase authenticated, import scoped, revision safe, and idempotent by operation id', () => {
    expect(migration).toContain('create or replace function public.mark_cue_draft_applied_v3');
    expect(migration).toContain('where user_id = v_user_id');
    expect(migration).toContain('and import_id = p_import_id');
    expect(migration).toContain('and track_id = p_track_id');
    expect(migration).toContain('v_current.revision <> p_revision');
    expect(migration).toContain('v_current.desired_fingerprint <> lower(p_desired_fingerprint)');
    expect(migration).toContain('if v_current.last_apply_operation_id = p_operation_id then');
    expect(migration).toContain('return next v_current;');
    expect(migration).toContain("raise exception 'cue_apply_idempotency_conflict'");
  });

  it('keeps older v2 callers from rewriting import provenance', () => {
    const v2Start = migration.indexOf('create or replace function public.mark_cue_draft_applied_v2');
    const v3Start = migration.indexOf('create or replace function public.mark_cue_draft_applied_v3');
    const v2 = migration.slice(v2Start, v3Start);
    expect(v2).toContain('current_baseline_fingerprint = lower(p_desired_fingerprint)');
    expect(v2).toContain('current_baseline_local_cue_fingerprint = lower(p_post_apply_local_cue_fingerprint)');
    expect(v2).not.toContain('imported_baseline_fingerprint = lower(p_desired_fingerprint)');
    expect(v2).not.toContain('imported_baseline_local_cue_fingerprint = lower(p_post_apply_local_cue_fingerprint)');
  });
});
