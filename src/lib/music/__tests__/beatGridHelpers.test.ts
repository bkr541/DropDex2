import { describe, expect, it } from 'vitest';
import {
  barAt,
  beatAtOrBefore,
  beatsInRange,
  bpmAt,
  downbeatsOnly,
  nearestBeat,
} from '../beatGridHelpers';
import type { BeatEntry } from '../beatGridHelpers';

function makeBeats(count: number, bpm = 128, startMs = 0): BeatEntry[] {
  const msPerBeat = 60000 / bpm;
  return Array.from({ length: count }, (_, i) => ({
    seq: i + 1,
    srcIdx: i,
    beatInBar: ((i % 4) + 1),
    bar: Math.floor(i / 4) + 1,
    ms: startMs + i * msPerBeat,
    bpm,
    isDownbeat: i % 4 === 0,
  }));
}

describe('nearestBeat', () => {
  it('returns null for empty array', () => {
    expect(nearestBeat([], 0)).toBeNull();
  });

  it('returns single beat when only one exists', () => {
    const beats = makeBeats(1);
    expect(nearestBeat(beats, 999)).toBe(beats[0]);
  });

  it('returns beat with smallest absolute distance', () => {
    const beats = makeBeats(4, 120);
    // ms at beat[1] = 500; query at 300 is closer to beat[0] (0) vs beat[1] (500)? 300 vs 200
    // Actually 300 from beat[0]=0 is 300; from beat[1]=500 is 200 → beat[1]
    const result = nearestBeat(beats, 300);
    expect(result?.seq).toBe(2); // beat at 500ms wins (200ms away vs 300ms)
  });

  it('returns first beat when equidistant (tie goes to first found)', () => {
    const beats: BeatEntry[] = [
      { seq: 1, srcIdx: 0, beatInBar: 1, bar: 1, ms: 0, bpm: 128, isDownbeat: true },
      { seq: 2, srcIdx: 1, beatInBar: 2, bar: 1, ms: 200, bpm: 128, isDownbeat: false },
    ];
    // Equidistant from 100ms → first one wins (bestDist starts at 100 and never improves)
    const result = nearestBeat(beats, 100);
    expect(result?.seq).toBe(1);
  });
});

describe('downbeatsOnly', () => {
  it('returns empty array when no downbeats', () => {
    const beats: BeatEntry[] = [
      { seq: 1, srcIdx: 0, beatInBar: 2, bar: 1, ms: 469, bpm: 128, isDownbeat: false },
    ];
    expect(downbeatsOnly(beats)).toHaveLength(0);
  });

  it('filters only isDownbeat=true entries', () => {
    const beats = makeBeats(8);
    const result = downbeatsOnly(beats);
    expect(result).toHaveLength(2);
    expect(result.every(b => b.isDownbeat)).toBe(true);
  });

  it('preserves order', () => {
    const beats = makeBeats(8);
    const result = downbeatsOnly(beats);
    expect(result[0].seq).toBeLessThan(result[1].seq);
  });

  it('returns empty for empty input', () => {
    expect(downbeatsOnly([])).toHaveLength(0);
  });
});

describe('beatsInRange', () => {
  it('includes startMs, excludes endMs', () => {
    const beats: BeatEntry[] = [
      { seq: 1, srcIdx: 0, beatInBar: 1, bar: 1, ms: 0, bpm: 128, isDownbeat: true },
      { seq: 2, srcIdx: 1, beatInBar: 2, bar: 1, ms: 469, bpm: 128, isDownbeat: false },
      { seq: 3, srcIdx: 2, beatInBar: 3, bar: 1, ms: 938, bpm: 128, isDownbeat: false },
    ];
    const result = beatsInRange(beats, 0, 938);
    expect(result).toHaveLength(2);
    expect(result[0].seq).toBe(1);
    expect(result[1].seq).toBe(2);
  });

  it('returns empty when no beats in range', () => {
    const beats = makeBeats(4, 128, 1000);
    expect(beatsInRange(beats, 0, 500)).toHaveLength(0);
  });

  it('returns all beats when range covers all', () => {
    const beats = makeBeats(4, 128, 0);
    const last = beats[beats.length - 1].ms;
    expect(beatsInRange(beats, 0, last + 1)).toHaveLength(4);
  });
});

describe('bpmAt', () => {
  it('returns null for empty beats', () => {
    expect(bpmAt([], 0)).toBeNull();
  });

  it('returns bpm of nearest beat', () => {
    const beats: BeatEntry[] = [
      { seq: 1, srcIdx: 0, beatInBar: 1, bar: 1, ms: 0, bpm: 120, isDownbeat: true },
      { seq: 2, srcIdx: 1, beatInBar: 2, bar: 1, ms: 1000, bpm: 130, isDownbeat: false },
    ];
    // 400ms is closer to beat 1 (400ms away) than beat 2 (600ms away)
    expect(bpmAt(beats, 400)).toBe(120);
  });
});

describe('beatAtOrBefore', () => {
  it('returns null when ms is before first beat', () => {
    const beats = makeBeats(4, 128, 100);
    expect(beatAtOrBefore(beats, 50)).toBeNull();
  });

  it('returns beat at exact ms', () => {
    const beats = makeBeats(4, 120, 0);
    const result = beatAtOrBefore(beats, beats[1].ms);
    expect(result?.seq).toBe(2);
  });

  it('returns last beat at or before the given ms', () => {
    const beats = makeBeats(4, 120, 0);
    // Query halfway between beat 1 and beat 2
    const midMs = (beats[0].ms + beats[1].ms) / 2;
    const result = beatAtOrBefore(beats, midMs);
    expect(result?.seq).toBe(1);
  });

  it('returns null for empty array', () => {
    expect(beatAtOrBefore([], 0)).toBeNull();
  });
});

describe('barAt', () => {
  it('returns bar of nearest beat', () => {
    const beats = makeBeats(8);  // beats 1-4 are bar 1, 5-8 are bar 2
    // First beat of bar 2 has seq=5; query at its ms
    const bar2StartMs = beats[4].ms;
    expect(barAt(beats, bar2StartMs)).toBe(2);
  });

  it('returns null for empty array', () => {
    expect(barAt([], 0)).toBeNull();
  });
});
