import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260820010000_cue_draft_persistence_stage4.sql', import.meta.url),
  'utf8',
);

describe('Stage 4 cue draft migration contract', () => {
  it('owns drafts separately from imported rekordbox_cues and cascades snapshot deletion', () => {
    expect(migration).toContain('create table if not exists public.cue_drafts');
    expect(migration).toContain('references public.rekordbox_imports(id) on delete cascade');
    expect(migration).toContain('references public.rekordbox_tracks(id) on delete cascade');
    expect(migration).not.toMatch(/update\s+public\.rekordbox_cues/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.rekordbox_cues/i);
  });

  it('enforces user-scoped reads and revision-protected writes', () => {
    expect(migration).toContain('user_id = auth.uid()');
    expect(migration).toContain('create or replace function public.save_cue_draft');
    expect(migration).toContain('where cue_drafts.revision = p_expected_revision');
    expect(migration).toContain("raise exception 'cue_draft_revision_conflict'");
    expect(migration).toContain('constraint cue_drafts_owner_track_unique unique (user_id, track_id)');
  });

  it('does not grant direct cue-draft mutation policies to authenticated clients', () => {
    expect(migration).toContain('for select');
    expect(migration).not.toMatch(/create policy[^;]+for insert/is);
    expect(migration).not.toMatch(/create policy[^;]+for update/is);
    expect(migration).not.toMatch(/create policy[^;]+for delete/is);
  });
});
