import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260827010000_track_metadata_draft_persistence_stage1.sql', import.meta.url),
  'utf8',
);

describe('Genre Editing Stage 1 metadata draft migration contract', () => {
  it('creates generic persisted metadata drafts while restricting Stage 1 to Genre', () => {
    expect(migration).toContain('create table if not exists public.track_metadata_drafts');
    expect(migration).toContain("check (field in ('genre'))");
    expect(migration).toContain('unique (user_id, track_id, field)');
    expect(migration).toContain('pending_value            text');
    expect(migration).toContain('check (pending_value is null or (pending_value = btrim(pending_value)');
    expect(migration).toContain('schema_version = 1');
    expect(migration).toContain('imported_baseline_value  text');
    expect(migration).toContain('current_baseline_value   text');
    expect(migration).toContain('references public.rekordbox_imports(id) on delete cascade');
    expect(migration).toContain('references public.rekordbox_tracks(id) on delete cascade');
  });

  it('normalizes Genre centrally using the verified Rekordbox 255-character limit', () => {
    expect(migration).toContain('create or replace function public.normalize_track_metadata_value_v1');
    expect(migration).toContain('v_value := btrim(p_value)');
    expect(migration).toContain("if v_value = '' then");
    expect(migration).toContain('char_length(v_value) > 255');
    expect(migration).toContain("raise exception 'metadata_draft_genre_too_long'");
  });

  it('captures canonical Genre and trusted master identity server-side', () => {
    expect(migration).toContain('select t.genre, t.master_db_id, t.master_content_id');
    expect(migration).toContain('and i.user_id = v_user_id');
    expect(migration).toContain("raise exception 'metadata_draft_missing_master_identity'");
    expect(migration).not.toContain('p_master_db_id');
    expect(migration).not.toContain('p_master_content_id');
  });

  it('uses revision protection and removes pending state when desired equals the moving baseline', () => {
    expect(migration).toContain('if p_expected_revision <> v_current.revision then');
    expect(migration).toContain("raise exception 'metadata_draft_revision_conflict'");
    expect(migration).toContain('if v_pending_value is not distinct from v_current.current_baseline_value then');
    expect(migration).toContain('delete from public.track_metadata_drafts');
    expect(migration).toContain('revision = revision + 1');
  });

  it('keeps canonical Rekordbox Genre out of the draft mutation surface', () => {
    expect(migration).not.toMatch(/update\s+public\.rekordbox_tracks/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.rekordbox_tracks/i);
    expect(migration).toContain('revoke all on public.track_metadata_drafts from public, anon, authenticated');
    expect(migration).not.toMatch(/create policy[^;]+for insert/is);
    expect(migration).not.toMatch(/create policy[^;]+for update/is);
    expect(migration).not.toMatch(/create policy[^;]+for delete/is);
  });
});
