import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260914010000_roulette_runtime_local_asset_truth_stage1.sql', import.meta.url),
  'utf8',
);

describe('Roulette corrective Stage 1 installation-local asset migration', () => {
  it('preserves legacy rows while scoping all new canonical rows by installation', () => {
    expect(migration).toContain('add column if not exists installation_id text');
    expect(migration).toContain('drop constraint if exists roulette_stem_assets_track_type_unique');
    expect(migration).toContain('unique (track_id, stem_type, installation_id)');
    expect(migration).not.toContain('update public.roulette_stem_assets set installation_id');
  });

  it('replaces the pair commit with an installation-scoped conflict and return contract', () => {
    expect(migration).toContain('p_installation_id text');
    expect(migration).toContain('on conflict (track_id, stem_type, installation_id) do update');
    expect(migration).toContain('asset.installation_id = p_installation_id');
  });
});
