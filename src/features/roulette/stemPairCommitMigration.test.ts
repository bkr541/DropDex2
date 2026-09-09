import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260908020000_roulette_stem_pair_commit_stage6.sql', import.meta.url),
  'utf8',
);

describe('Roulette Stage 6 atomic stem pair commit migration', () => {
  it('commits vocals and instrumental in one invoker-security database function', () => {
    expect(migration).toContain('create or replace function public.commit_roulette_stem_pair');
    expect(migration).toContain('security invoker');
    expect(migration).toContain("'vocals'");
    expect(migration).toContain("'instrumental'");
    expect(migration).toContain('on conflict (track_id, stem_type) do update');
    expect(migration).toContain("status = excluded.status");
  });
});
