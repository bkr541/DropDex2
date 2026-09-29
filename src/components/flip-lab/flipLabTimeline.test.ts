import { describe, expect, it } from 'vitest';
import {
  computeFlipLabTimeline,
  flipLabBpmDifference,
  flipLabKeyShiftSemitones,
  formatFlipLabTime,
} from './flipLabTimeline';

describe('Flip Lab shared timeline', () => {
  it('keeps the instrumental at its own tempo and stretches the vocal to it', () => {
    const timeline = computeFlipLabTimeline({
      vocalDurationSec: 200,
      instrumentalDurationSec: 180,
      vocalFirstDownbeatSec: 0,
      instrumentalFirstDownbeatSec: 0,
      vocalBpm: 125,
      instrumentalBpm: 128,
    });
    expect(timeline.tempoRatio).toBeCloseTo(128 / 125);
    expect(timeline.instrumentalSpanSec).toBe(180);
    expect(timeline.vocalSpanSec).toBeCloseTo(200 * 125 / 128);
  });

  it('lines up both first downbeats on the same instant', () => {
    const timeline = computeFlipLabTimeline({
      vocalDurationSec: 180,
      instrumentalDurationSec: 180,
      vocalFirstDownbeatSec: 2,
      instrumentalFirstDownbeatSec: 0.5,
      vocalBpm: 128,
      instrumentalBpm: 128,
    });
    expect(timeline.downbeatSec).toBe(2);
    expect(timeline.vocalStartSec + 2).toBeCloseTo(timeline.downbeatSec);
    expect(timeline.instrumentalStartSec + 0.5).toBeCloseTo(timeline.downbeatSec);
  });

  it('runs until the longer track ends', () => {
    const timeline = computeFlipLabTimeline({
      vocalDurationSec: 60,
      instrumentalDurationSec: 240,
      vocalFirstDownbeatSec: 0,
      instrumentalFirstDownbeatSec: 0,
      vocalBpm: 128,
      instrumentalBpm: 128,
    });
    expect(timeline.totalSec).toBe(240);
  });

  it('refuses tracks without BPM or length', () => {
    expect(() => computeFlipLabTimeline({
      vocalDurationSec: 60, instrumentalDurationSec: 60,
      vocalFirstDownbeatSec: 0, instrumentalFirstDownbeatSec: 0,
      vocalBpm: 0, instrumentalBpm: 128,
    })).toThrow();
  });

  it('measures BPM distance for the 5 BPM limit', () => {
    expect(flipLabBpmDifference(125, 130)).toBe(5);
    expect(flipLabBpmDifference(null, 130)).toBeNull();
  });
});

describe('Flip Lab key shift', () => {
  it('moves the vocal onto the instrumental Camelot number by the smallest shift', () => {
    expect(flipLabKeyShiftSemitones('8A', '8A')).toBe(0);
    expect(flipLabKeyShiftSemitones('8A', '3A')).toBe(1);
    expect(flipLabKeyShiftSemitones('8A', '9A')).toBe(-5);
    expect(flipLabKeyShiftSemitones('8A', '8B')).toBe(0);
  });

  it('is unavailable when either key is unknown', () => {
    expect(flipLabKeyShiftSemitones(null, '8A')).toBeNull();
    expect(flipLabKeyShiftSemitones('8A', 'N/A')).toBeNull();
  });

  it('formats transport time', () => {
    expect(formatFlipLabTime(65.9)).toBe('1:05');
    expect(formatFlipLabTime(Number.NaN)).toBe('0:00');
  });
});
