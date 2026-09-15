import { describe, expect, it } from 'vitest';
import {
  clampCueTransportTime,
  cueAdjacentTrackIndex,
  cuePlaybackPlayheadPercent,
} from './cuePlaybackTransport';

describe('Cue Points playback transport helpers', () => {
  it('clamps rewind and forward by exactly ten seconds at duration boundaries', () => {
    expect(clampCueTransportTime(4, 120, -10)).toBe(0);
    expect(clampCueTransportTime(64.5, 120, -10)).toBe(54.5);
    expect(clampCueTransportTime(64.5, 120, 10)).toBe(74.5);
    expect(clampCueTransportTime(116, 120, 10)).toBe(120);
    expect(clampCueTransportTime(Number.NaN, Number.NaN, 10)).toBe(0);
  });

  it('uses the active visible track as the Previous/Next anchor and disables at boundaries', () => {
    const ids = ['a', 'b', 'c'];
    expect(cueAdjacentTrackIndex(ids, 'b', 'c', -1)).toBe(0);
    expect(cueAdjacentTrackIndex(ids, 'b', 'a', 1)).toBe(2);
    expect(cueAdjacentTrackIndex(ids, 'a', 'c', -1)).toBeNull();
    expect(cueAdjacentTrackIndex(ids, 'c', 'a', 1)).toBeNull();
  });

  it('falls back deterministically to the selected track or the current source boundary', () => {
    const ids = ['a', 'b', 'c'];
    expect(cueAdjacentTrackIndex(ids, 'outside', 'b', -1)).toBe(0);
    expect(cueAdjacentTrackIndex(ids, 'outside', 'b', 1)).toBe(2);
    expect(cueAdjacentTrackIndex(ids, 'outside', 'outside-too', 1)).toBe(0);
    expect(cueAdjacentTrackIndex(ids, null, null, -1)).toBe(2);
    expect(cueAdjacentTrackIndex([], null, null, 1)).toBeNull();
  });

  it('positions the playhead inside a zoomed timeline and hides it outside the visible window', () => {
    expect(cuePlaybackPlayheadPercent(35_000, 30_000, 50_000)).toBe(25);
    expect(cuePlaybackPlayheadPercent(40_000, 30_000, 50_000)).toBe(50);
    expect(cuePlaybackPlayheadPercent(29_999, 30_000, 50_000)).toBeNull();
    expect(cuePlaybackPlayheadPercent(50_001, 30_000, 50_000)).toBeNull();
    expect(cuePlaybackPlayheadPercent(40_000, 50_000, 50_000)).toBeNull();
  });
});
