import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260908010000_roulette_stem_asset_contract_stage3.sql', import.meta.url),
  'utf8',
);

describe('Roulette stem asset Stage 3 migration', () => {
  it('is additive for fresh and existing databases and owns both canonical stem types', () => {
    expect(migration).toContain('create table if not exists public.roulette_stem_assets');
    expect(migration).toContain("check (stem_type in ('vocals', 'instrumental'))");
    expect(migration).toContain("check (status in ('pending', 'processing', 'ready', 'failed'))");
    expect(migration).toContain('unique (track_id, stem_type)');
    expect(migration).toContain('references public.rekordbox_tracks(id) on delete cascade');
  });

  it('requires complete ready metadata and authenticated parent-track ownership', () => {
    expect(migration).toContain("status <> 'ready'");
    expect(migration).toContain('storage_locator is not null');
    expect(migration).toContain('separator_version is not null');
    expect(migration).toContain('rekordbox_imports.user_id = auth.uid()');
    expect(migration).toContain('alter table public.roulette_stem_assets enable row level security');
  });
});
