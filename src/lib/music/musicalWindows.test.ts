import { describe, expect, it } from 'vitest';
import type { BeatEntry } from './beatGridHelpers';
import { resolveMusicalBarWindow, shiftMusicalAnchorByBeats } from './musicalWindows';

function beats(bars: number, bpm = 120): BeatEntry[] {
  const beatMs = 60_000 / bpm;
  return Array.from({ length: bars * 4 }, (_, i) => ({
    seq: i + 1,
    srcIdx: i,
    beatInBar: (i % 4) + 1,
    bar: Math.floor(i / 4) + 1,
    ms: i * beatMs,
    bpm,
    isDownbeat: i % 4 === 0,
  }));
}

describe('musical bar windows', () => {
  it('resolves exact 4/8/16-bar boundaries from stored Rekordbox downbeats', () => {
    const grid = beats(96);
    expect(resolveMusicalBarWindow({
      beats: grid,
      anchorMs: 64_000,
      barCount: 4,
      direction: 'before',
      durationMs: 180_000,
      fallbackBpm: 120,
    })).toMatchObject({ startMs: 56_000, endMs: 64_000, timingSource: 'beat-grid' });

    expect(resolveMusicalBarWindow({
      beats: grid,
      anchorMs: 64_000,
      barCount: 8,
      direction: 'before',
      durationMs: 180_000,
      fallbackBpm: 120,
    })?.startMs).toBe(48_000);

    expect(resolveMusicalBarWindow({
      beats: grid,
      anchorMs: 32_000,
      barCount: 16,
      direction: 'after',
      durationMs: 180_000,
      fallbackBpm: 120,
    })).toMatchObject({ startMs: 32_000, endMs: 64_000, timingSource: 'beat-grid' });
  });

  it('falls back deterministically to BPM when the beat grid is malformed', () => {
    const malformed = beats(8);
    malformed[5] = { ...malformed[5], ms: malformed[4].ms };

    expect(resolveMusicalBarWindow({
      beats: malformed,
      anchorMs: 32_000,
      barCount: 4,
      direction: 'before',
      durationMs: 180_000,
      fallbackBpm: 120,
    })).toEqual({
      startMs: 24_000,
      endMs: 32_000,
      durationMs: 8_000,
      timingSource: 'bpm',
    });
  });

  it('shifts anchors by exact beats and uses beat/BPM fallback only beyond the usable grid', () => {
    const grid = beats(8);
    expect(shiftMusicalAnchorByBeats(8_000, grid, 1, 120)).toBe(8_500);
    expect(shiftMusicalAnchorByBeats(15_500, grid, 1, 120)).toBe(16_000);
    expect(shiftMusicalAnchorByBeats(0, [], -1, 120)).toBe(0);
  });
});
