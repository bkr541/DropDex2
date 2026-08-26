import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260825010000_cue_apply_safety_stage1.sql', import.meta.url),
  'utf8',
);

describe('Stage 1 cue apply safety migration contract', () => {
  it('adds explicit local cue-baseline and strong identity fields without inventing legacy values', () => {
    expect(migration).toContain('imported_baseline_local_cue_fingerprint text');
    expect(migration).toContain('master_db_id text');
    expect(migration).toContain('master_content_id text');
    expect(migration).not.toMatch(/update\s+public\.cue_drafts[\s\S]+imported_baseline_local_cue_fingerprint/is);
  });

  it('copies strong identity from the authenticated imported track rather than renderer input', () => {
    expect(migration).toContain('select t.master_db_id, t.master_content_id');
    expect(migration).toContain('from public.rekordbox_tracks t');
    expect(migration).toContain('and i.user_id = v_user_id');
    expect(migration).not.toContain('p_master_db_id');
    expect(migration).not.toContain('p_master_content_id');
  });

  it('extends save_cue_draft compatibly with a nullable canonical local baseline fingerprint', () => {
    expect(migration).toContain('p_imported_baseline_local_cue_fingerprint text default null');
    expect(migration).toContain('imported_baseline_local_cue_fingerprint = excluded.imported_baseline_local_cue_fingerprint');
    expect(migration).toContain('lower(p_imported_baseline_local_cue_fingerprint)');
  });
});
