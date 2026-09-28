import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const view = fs.readFileSync(path.join(root, 'src/components/flip-lab/FlipLabView.tsx'), 'utf8');
const candidates = fs.readFileSync(path.join(root, 'src/lib/queries/rouletteCandidates.ts'), 'utf8');
const analysis = fs.readFileSync(path.join(root, 'src/lib/queries/analysisData.ts'), 'utf8');
const importHook = fs.readFileSync(path.join(root, 'src/hooks/useLatestRekordboxImport.ts'), 'utf8');

describe('Flip Lab Prompt 07 performance/lifecycle wiring', () => {
  it('loads one shared base pool and keeps full phrase detail selected-track-only', () => {
    expect(view).toContain('fetchRouletteCandidatePools(requestImportId');
    expect(candidates).toContain('fetchTrackPhraseCounts(trackIds, signal)');
    expect(candidates).not.toContain('fetchTracksPhrases(trackIds)');
    expect(analysis).toContain(".select('track_id')");
    expect(view).toContain('fetchTrackPhrases(trackId, controller.signal)');
  });

  it('uses a lean candidate projection rather than selecting every Rekordbox track column', () => {
    expect(candidates).toContain('ROULETTE_CANDIDATE_TRACK_COLUMNS');
    expect(candidates).toContain('.select(ROULETTE_CANDIDATE_TRACK_COLUMNS)');
    expect(candidates).not.toContain(".from('rekordbox_tracks')\n      .select('*')");
  });

  it('bounds rendered rows and waveform requests to the virtualized visible windows', () => {
    expect(view).toContain('computeFlipLabWindowRange');
    expect(view).toContain('visibleCandidates.map');
    expect(view).toContain('onVisibleTrackIdsChange={setVocalVisibleIds}');
    expect(view).toContain('onVisibleTrackIdsChange={setInstrVisibleIds}');
    expect(view).toContain('...vocalVisibleIds');
    expect(view).toContain('...instrVisibleIds');
    expect(view).not.toContain('filtered.map(c =>');
  });

  it('cancels stale candidate/detail loads and reacts to active-import setting changes', () => {
    expect(view).toContain('const controller = new AbortController();');
    expect(view).toContain('isCurrentFlipLabLoad(');
    expect(view).toContain("flipLabStemLifecycle.select('vocal', null)");
    expect(view).toContain("flipLabStemLifecycle.select('instrumental', null)");
    expect(importHook).toContain("table: 'rekordbox_user_settings'");
    expect(importHook).toContain(".channel(`active-rekordbox-import:${userId}`)");
  });

  it('removes the impossible short-window min/max height pair', () => {
    expect(view).not.toContain('minHeight: 480');
    expect(view).toContain("minHeight: 0");
    expect(view).toContain("maxHeight: 'calc(100vh - 320px)'");
  });
});
