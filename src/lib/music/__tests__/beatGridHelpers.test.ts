import { describe, expect, it } from 'vitest';
import {
  barAt,
  beatAtOrBefore,
  beatByBarOffset,
  beatBySequence,
  beatsInRange,
  bpmAt,
  downbeatsOnly,
  exactBeatForBoundary,
  firstValidBeat,
  isUsableBeatGrid,
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

  it('clamps requests before the first and after the last stored beat', () => {
    const beats = makeBeats(4, 120, 250);
    expect(nearestBeat(beats, -100)?.seq).toBe(1);
    expect(nearestBeat(beats, 99_999)?.seq).toBe(4);
  });

  it('returns beat with smallest absolute distance', () => {
    const beats = makeBeats(4, 120);
    // ms at beat[1] = 500; query at 300 is closer to beat[0] (0) vs beat[1] (500)? 300 vs 200
    // Actually 300 from beat[0]=0 is 300; from beat[1]=500 is 200 → beat[1]
    const result = nearestBeat(beats, 300);
    expect(result?.seq).toBe(2); // beat at 500ms wins (200ms away vs 300ms)
  });

  it('uses source-stored variable-tempo positions instead of reconstructing from BPM', () => {
    const beats: BeatEntry[] = [
      { seq: 1, srcIdx: 0, beatInBar: 1, bar: 1, ms: 0, bpm: 120, isDownbeat: true },
      { seq: 2, srcIdx: 1, beatInBar: 2, bar: 1, ms: 500, bpm: 120, isDownbeat: false },
      { seq: 3, srcIdx: 2, beatInBar: 3, bar: 1, ms: 965, bpm: 129, isDownbeat: false },
      { seq: 4, srcIdx: 3, beatInBar: 4, bar: 1, ms: 1410, bpm: 135, isDownbeat: false },
    ];
    expect(nearestBeat(beats, 1180)?.ms).toBe(965);
  });

  it('fails closed for non-finite requests and malformed/non-monotonic grids', () => {
    const malformed = [
      { seq: 1, srcIdx: 0, beatInBar: 1, bar: 1, ms: 500, bpm: 128, isDownbeat: true },
      { seq: 2, srcIdx: 1, beatInBar: 2, bar: 1, ms: 400, bpm: 128, isDownbeat: false },
    ];
    expect(isUsableBeatGrid(malformed)).toBe(false);
    expect(nearestBeat(malformed, 450)).toBeNull();
    expect(nearestBeat(makeBeats(4), Number.NaN)).toBeNull();
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


describe('exact Stage 3 beat navigation', () => {
  it('returns exact sequence/boundary identities before falling back to nearest ms', () => {
    const beats = makeBeats(12, 120);
    expect(firstValidBeat(beats)).toBe(beats[0]);
    expect(beatBySequence(beats, 5)).toBe(beats[4]);
    expect(exactBeatForBoundary(beats, { beatSequence: 5, ms: beats[9].ms })).toBe(beats[4]);
    expect(exactBeatForBoundary(beats, { ms: beats[7].ms + 20 })).toBe(beats[7]);
  });

  it('moves by exact bar identity on variable-tempo source milliseconds', () => {
    const beats = makeBeats(24, 120);
    beats.forEach((beat, index) => {
      beat.ms = index === 0 ? 0 : beats[index - 1].ms + 350 + (index % 3) * 47;
      beat.bpm = 60000 / (350 + (index % 3) * 47);
    });
    const anchor = beats[1]; // bar 1, beat 2
    expect(beatByBarOffset(beats, anchor, 4)).toBe(beats[17]);
    expect(beatByBarOffset(beats, beats[20], -4)).toBe(beats[4]);
    expect(beatByBarOffset(beats, anchor, -1)).toBeNull();
  });

  it('fails closed when an incomplete grid is missing the exact target beat-in-bar', () => {
    const beats = makeBeats(20, 120).filter((beat) => !(beat.bar === 5 && beat.beatInBar === 1));
    // Re-sequencing is deliberately not done: stored identity remains source truth.
    expect(beatByBarOffset(beats, beats[0], 4)).toBeNull();
  });
});
