import { describe, expect, it } from 'vitest';
import type { BeatEntry } from '../music/beatGridHelpers';
import { gridBeatsForMode,
  MIN_CUE_TIMELINE_WINDOW_MS,
  panCueTimelineView,
  zoomCueTimelineView, applyTimelineWheel } from './cueTimelineViewport';

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
    expect(gridBeatsForMode(source, 'beats')).toEqual(source);
    expect(gridBeatsForMode(source, 'bars').map((beat) => beat.seq)).toEqual([1, 5]);
    expect(gridBeatsForMode(source, '4-bars').map((beat) => beat.seq)).toEqual([1]);
    expect(gridBeatsForMode(source, '8-bars').map((beat) => beat.seq)).toEqual([1]);
    expect(gridBeatsForMode(source, '16-bars').map((beat) => beat.seq)).toEqual([1]);
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

describe('zoom limits and the mouse wheel', () => {
  it('stops zooming in at a custom closest window', () => {
    const zoomed = zoomCueTimelineView({ start: 0, end: 64 }, 64, 0.01, 0.5, 8);
    expect(zoomed).toEqual({ start: 28, end: 36 });
  });

  it('scrolling down zooms out and scrolling up zooms in, around the pointer', () => {
    const view = { start: 16, end: 48 };
    const out = applyTimelineWheel(view, 64, { deltaX: 0, deltaY: 100, focusFraction: 0.5, width: 800 }, 8);
    const into = applyTimelineWheel(view, 64, { deltaX: 0, deltaY: -100, focusFraction: 0.5, width: 800 }, 8);
    expect(out!.end - out!.start).toBeGreaterThan(32);
    expect(into!.end - into!.start).toBeLessThan(32);
    expect((into!.start + into!.end) / 2).toBeCloseTo(32);
  });

  it('keeps the point under the pointer still while zooming', () => {
    const view = { start: 0, end: 64 };
    const next = applyTimelineWheel(view, 64, { deltaX: 0, deltaY: -100, focusFraction: 0.25, width: 800 }, 8)!;
    const before = view.start + 0.25 * (view.end - view.start);
    const after = next.start + 0.25 * (next.end - next.start);
    expect(after).toBeCloseTo(before);
  });

  it('a mostly sideways scroll pans instead of zooming', () => {
    const next = applyTimelineWheel({ start: 0, end: 32 }, 64, { deltaX: 100, deltaY: 5, focusFraction: 0.5, width: 800 }, 8)!;
    expect(next.end - next.start).toBe(32);
    expect(next.start).toBeCloseTo(4);
  });

  it('never leaves the timeline when panning or zooming out', () => {
    expect(applyTimelineWheel({ start: 40, end: 64 }, 64, { deltaX: 5000, deltaY: 0, focusFraction: 0.5, width: 800 })).toEqual({ start: 40, end: 64 });
    expect(applyTimelineWheel({ start: 0, end: 64 }, 64, { deltaX: 0, deltaY: 900, focusFraction: 0.5, width: 800 }, 8)).toEqual({ start: 0, end: 64 });
  });

  it('ignores a pan when the timeline has no width yet', () => {
    expect(applyTimelineWheel({ start: 0, end: 32 }, 64, { deltaX: 100, deltaY: 0, focusFraction: 0.5, width: 0 })).toBeNull();
  });
});
