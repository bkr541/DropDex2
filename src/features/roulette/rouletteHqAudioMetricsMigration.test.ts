import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260914040000_roulette_hq_audio_metrics_stage4.sql', import.meta.url),
  'utf8',
);

describe('Roulette Stage 4 HQ audio metrics migration', () => {
  it('adds supplemental JSON metrics without making them a ready-state requirement', () => {
    expect(migration).toContain('add column if not exists analysis_metrics jsonb');
    expect(migration).toContain("analysis_metrics is null or jsonb_typeof(analysis_metrics) = 'object'");
    expect(migration).not.toContain('analysis_metrics is not null');
  });

  it('publishes both metric payloads in the installation-scoped per-track transaction', () => {
    expect(migration).toContain('p_vocals_analysis_metrics jsonb');
    expect(migration).toContain('p_instrumental_analysis_metrics jsonb');
    expect(migration).toContain('on conflict (track_id, stem_type, installation_id) do update');
    expect(migration).toContain('analysis_metrics = excluded.analysis_metrics');
    expect(migration).toContain('asset.installation_id = p_installation_id');
  });
});
