import { describe, expect, it } from 'vitest';
import type { BeatEntry } from '../music/beatGridHelpers';
import {
  gridBeatsForMode,
  MIN_CUE_TIMELINE_WINDOW_MS,
  panCueTimelineView,
  zoomCueTimelineView,
} from './cueTimelineViewport';

function beats(): BeatEntry[] {
  return Array.from({ length: 8 }, (_, index) => ({
    seq: index + 1,
    srcIdx: index,
    beatInBar: (index % 4) + 1,
    bar: Math.floor(index / 4) + 1,
    ms: index * 500,
    bpm: 120,
    isDownbeat: index % 4 === 0,
  }));
}

describe('gridBeatsForMode', () => {
  it('keeps Snap-independent presentation choices explicit', () => {
    const source = beats();
    expect(gridBeatsForMode(source, 'off')).toEqual([]);
    expect(gridBeatsForMode(source, 'beats')).toEqual(source);
    expect(gridBeatsForMode(source, 'bars').map((beat) => beat.seq)).toEqual([1, 5]);
  });
});

describe('cue timeline viewport math', () => {
  it('zooms around the requested focus and preserves the center for button zoom', () => {
    const zoomed = zoomCueTimelineView({ start: 2_000, end: 8_000 }, 12_000, 0.75, 0.5);
    expect(zoomed).toEqual({ start: 2_750, end: 7_250 });
    expect(((zoomed?.start ?? 0) + (zoomed?.end ?? 0)) / 2).toBe(5_000);
  });

  it('clamps zoom to the shared minimum window and full duration', () => {
    expect(zoomCueTimelineView({ start: 4_000, end: 6_000 }, 10_000, 0.01, 0.5)).toEqual({
      start: 5_000 - MIN_CUE_TIMELINE_WINDOW_MS / 2,
      end: 5_000 + MIN_CUE_TIMELINE_WINDOW_MS / 2,
    });
    expect(zoomCueTimelineView({ start: 2_000, end: 8_000 }, 10_000, 10, 0.5)).toEqual({ start: 0, end: 10_000 });
  });

  it('pans without changing range and clamps at duration boundaries', () => {
    expect(panCueTimelineView({ start: 2_000, end: 6_000 }, 10_000, -5_000)).toEqual({ start: 0, end: 4_000 });
    expect(panCueTimelineView({ start: 2_000, end: 6_000 }, 10_000, 8_000)).toEqual({ start: 6_000, end: 10_000 });
  });
});
