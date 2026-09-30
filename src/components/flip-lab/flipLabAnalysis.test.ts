import { describe, expect, it } from 'vitest';
import type { PhraseRow } from '../../lib/queries/analysisData';
import { mapPhrasesToTimelineSegments, trackDurationMs } from './flipLabAnalysis';
import { fixtureGrid } from './flipLabTestFixtures';

function phrase(start: number, end: number, label: string): PhraseRow {
  return { start_ms: start, end_ms: end, normalized_label: label, source_kind: null } as unknown as PhraseRow;
}

describe('Flip Lab phrase and beat-grid lanes', () => {
  it('maps phrases to percentages of the whole track', () => {
    const segments = mapPhrasesToTimelineSegments([phrase(0, 30_000, 'Intro'), phrase(30_000, 60_000, 'Drop')], 120_000);
    expect(segments).toEqual([
      { label: 'Intro', tone: 'intro', startPercent: 0, endPercent: 25 },
      { label: 'Drop', tone: 'drop', startPercent: 25, endPercent: 50 },
    ]);
  });

  it('places phrases that only have beat numbers using the beat grid', () => {
    const grid = fixtureGrid('t', 0, 120); // one beat every 500 ms
    const beatOnly = [
      { start_ms: null, end_ms: null, start_beat: 1, end_beat: 5, normalized_label: 'Intro', source_kind: null },
      { start_ms: null, end_ms: null, start_beat: 5, end_beat: null, normalized_label: 'Chorus', source_kind: null },
    ] as unknown as PhraseRow[];
    expect(mapPhrasesToTimelineSegments(beatOnly, 8000, grid)).toEqual([
      { label: 'Intro', tone: 'intro', startPercent: 0, endPercent: 25 },
      { label: 'Chorus', tone: 'chorus', startPercent: 25, endPercent: 100 },
    ]);
  });

  it('reads track length from milliseconds or seconds', () => {
    expect(trackDurationMs({ duration_ms: 5000, duration_seconds: null } as never)).toBe(5000);
    expect(trackDurationMs({ duration_ms: null, duration_seconds: 3 } as never)).toBe(3000);
  });
});
