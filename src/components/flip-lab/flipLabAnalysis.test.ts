import { describe, expect, it } from 'vitest';
import type { PhraseRow } from '../../lib/queries/analysisData';
import { flipLabBarLines, mapPhrasesToTimelineSegments, trackDurationMs } from './flipLabAnalysis';
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

  it('draws one line per bar, marking the first downbeat and every fourth bar', () => {
    const lines = flipLabBarLines(fixtureGrid('t', 1000, 120), 10_000);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ bar: 1, percent: 10, first: true, major: true });
    expect(lines[1]).toMatchObject({ first: false, major: false });
  });

  it('has no bar lines without a beat grid', () => {
    expect(flipLabBarLines(null, 10_000)).toEqual([]);
  });

  it('reads track length from milliseconds or seconds', () => {
    expect(trackDurationMs({ duration_ms: 5000, duration_seconds: null } as never)).toBe(5000);
    expect(trackDurationMs({ duration_ms: null, duration_seconds: 3 } as never)).toBe(3000);
  });
});
