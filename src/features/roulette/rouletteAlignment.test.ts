import { describe, expect, it } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import {
  buildRouletteBarFractions,
  firstRouletteDownbeat,
  resolveRouletteAlignment,
} from './rouletteAlignment';

function track(id: string, bpm = 142): Pick<RekordboxTrack, 'id' | 'bpm'> {
  return { id, bpm };
}

function grid(trackId: string, firstDownbeatMs: number): BeatGridRow {
  return {
    id: `grid-${trackId}`,
    import_id: 'import-1',
    track_id: trackId,
    source_tag: 'PQTZ',
    beats: [
      { seq: 1, srcIdx: 1, beatInBar: 4, bar: 0, ms: firstDownbeatMs - 400, bpm: 142, isDownbeat: false },
      { seq: 2, srcIdx: 2, beatInBar: 1, bar: 1, ms: firstDownbeatMs, bpm: 142, isDownbeat: true },
      { seq: 3, srcIdx: 3, beatInBar: 2, bar: 1, ms: firstDownbeatMs + 422, bpm: 142, isDownbeat: false },
      { seq: 4, srcIdx: 4, beatInBar: 3, bar: 1, ms: firstDownbeatMs + 845, bpm: 142, isDownbeat: false },
      { seq: 5, srcIdx: 5, beatInBar: 4, bar: 1, ms: firstDownbeatMs + 1267, bpm: 142, isDownbeat: false },
      { seq: 6, srcIdx: 6, beatInBar: 1, bar: 2, ms: firstDownbeatMs + 1690, bpm: 142, isDownbeat: true },
    ],
    beat_count: 6,
    downbeat_count: 2,
    bar_count: 2,
    first_beat_ms: firstDownbeatMs - 400,
    first_downbeat_ms: firstDownbeatMs,
    minimum_bpm: 142,
    maximum_bpm: 142,
    is_variable_tempo: false,
    parser_version: 'test',
  };
}

describe('Roulette musical alignment', () => {
  it('maps independent parent downbeats onto one virtual bar origin', () => {
    const result = resolveRouletteAlignment(
      { track: track('vocal', 142.05), beatGrid: grid('vocal', 1200) },
      { track: track('instrumental', 142), beatGrid: grid('instrumental', 2650) },
    );

    expect(result.vocal.sourceOffsetSeconds).toBe(1.2);
    expect(result.instrumental.sourceOffsetSeconds).toBe(2.65);
    expect(result.masterBpm).toBe(142);
    expect(result.barDurationSeconds).toBeCloseTo(240 / 142, 8);
  });

  it('keeps the instrumental as deterministic master and plans pitch-locked vocal sync', () => {
    const result = resolveRouletteAlignment(
      { track: track('vocal', 140), beatGrid: grid('vocal', 1200) },
      { track: track('instrumental', 142), beatGrid: grid('instrumental', 2650) },
    );

    expect(result.tempo.masterRole).toBe('instrumental');
    expect(result.masterBpm).toBe(142);
    expect(result.tempo.vocal.tempoRatio).toBeCloseTo(142 / 140, 10);
    expect(result.tempo.vocal.requiresPitchLockedProcessing).toBe(true);
    expect(result.tempo.instrumental.requiresPitchLockedProcessing).toBe(false);
  });

  it('fails closed when the pair is half-time related instead of direct-tempo compatible', () => {
    expect(() => resolveRouletteAlignment(
      { track: track('vocal', 71), beatGrid: grid('vocal', 1000) },
      { track: track('instrumental', 142), beatGrid: grid('instrumental', 1000) },
    )).toThrow(/direct-tempo pair/);
  });

  it('requires an exact stored downbeat instead of inventing an average-BPM anchor', () => {
    const malformed = grid('bad', 1000);
    malformed.beats = malformed.beats.map((beat) => ({ ...beat, isDownbeat: false }));
    expect(firstRouletteDownbeat(malformed)).toBeNull();
  });

  it('builds deterministic shared virtual bar markers', () => {
    expect(buildRouletteBarFractions(8, 2)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(buildRouletteBarFractions(8, 2, 3)).toEqual([0, 0.25, 0.5]);
  });
});
