import { describe, expect, it } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { RouletteCandidateAnalysis } from '../../features/roulette/rouletteMatching';
import {
  FLIP_LAB_MAX_RENDERED_ROWS,
  FLIP_LAB_ROW_HEIGHT,
  computeFlipLabWindowRange,
  filterFlipLabCandidates,
  isCurrentFlipLabLoad,
  scrollTopForFlipLabSelection,
} from './flipLabPerformance';

function candidate(id: string, title: string, artist: string): RouletteCandidateAnalysis {
  return {
    track: { id, title, artist } as RekordboxTrack,
    beatGrid: null,
    phraseCount: 0,
  };
}

describe('Flip Lab performance helpers', () => {
  it('keeps title + artist search cheap and deterministic', () => {
    const rows = [
      candidate('1', 'Afterglow', 'Nova'),
      candidate('2', 'Signal', 'Daydream'),
      candidate('3', 'Daylight', 'Other'),
    ];

    expect(filterFlipLabCandidates(rows, 'daydream').map((row) => row.track.id)).toEqual(['2']);
    expect(filterFlipLabCandidates(rows, 'after').map((row) => row.track.id)).toEqual(['1']);
  });

  it('windows thousands of rows and keeps rendered/waveform demand bounded', () => {
    const range = computeFlipLabWindowRange(5_000, 51 * 2_000, 420);
    expect(range.startIndex).toBeGreaterThan(1_990);
    expect(range.endIndex - range.startIndex).toBeLessThanOrEqual(FLIP_LAB_MAX_RENDERED_ROWS);
    expect(range.topSpacerHeight + range.bottomSpacerHeight).toBeGreaterThan(0);
  });

  it('returns a scroll position that makes the selected row reachable', () => {
    const selectedIndex = 900;
    const next = scrollTopForFlipLabSelection(selectedIndex, 0, 400);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThanOrEqual(selectedIndex * FLIP_LAB_ROW_HEIGHT);
  });

  it('rejects stale or aborted active-import loads', () => {
    const current = new AbortController();
    expect(isCurrentFlipLabLoad(2, 2, 'import-b', 'import-b', current.signal)).toBe(true);
    expect(isCurrentFlipLabLoad(1, 2, 'import-a', 'import-b', current.signal)).toBe(false);
    current.abort();
    expect(isCurrentFlipLabLoad(2, 2, 'import-b', 'import-b', current.signal)).toBe(false);
  });
});
