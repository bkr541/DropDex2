import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260826010000_cue_truth_semantics_stage9.sql', import.meta.url),
  'utf8',
);

describe('Stage 9 cue truth semantics migration contract', () => {
  it('rebases both safety baselines only in the verified post-Apply RPC', () => {
    expect(migration).toContain('create or replace function public.mark_cue_draft_applied_v2');
    expect(migration).toContain('imported_baseline_fingerprint = lower(p_desired_fingerprint)');
    expect(migration).toContain('imported_baseline_local_cue_fingerprint = lower(p_post_apply_local_cue_fingerprint)');
    expect(migration).toContain('and revision = p_revision');
    expect(migration).toContain('and desired_fingerprint = lower(p_desired_fingerprint)');
  });

  it('requires authenticated ownership and validated post-Apply proof', () => {
    expect(migration).toContain('v_user_id uuid := auth.uid()');
    expect(migration).toContain("p_post_apply_local_cue_fingerprint, '') !~ '^[0-9a-f]{64}$'");
    expect(migration).toContain('where user_id = v_user_id');
    expect(migration).toContain("raise exception 'cue_apply_revision_conflict'");
  });
});
