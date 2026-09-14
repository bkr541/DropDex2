import { describe, expect, it } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import { createRouletteCandidateIndex } from './rouletteCandidateIndex';
import type { RouletteCandidateAnalysis } from './rouletteMatching';

function track(id: string, bpm: number, camelot: string): RekordboxTrack {
  return {
    id,
    import_id: 'import-1',
    rekordbox_content_id: id,
    title: id,
    artist: 'Artist',
    album: null,
    remixer: null,
    genre: null,
    label: null,
    musical_key: null,
    camelot_key: camelot,
    normalized_key_name: null,
    key_tonic: null,
    key_mode: null,
    bpm,
    duration_seconds: 180,
    rating: null,
    comments: null,
    file_path: `/music/${id}.wav`,
    file_format: 'WAV',
    date_added: null,
  } as RekordboxTrack;
}

function grid(trackId: string, variable = false): BeatGridRow {
  return {
    id: `grid-${trackId}`,
    import_id: 'import-1',
    track_id: trackId,
    source_tag: 'PQTZ',
    beats: [
      { seq: 1, srcIdx: 1, beatInBar: 1, bar: 1, ms: 0, bpm: 140, isDownbeat: true },
      { seq: 2, srcIdx: 2, beatInBar: 2, bar: 1, ms: 429, bpm: 140, isDownbeat: false },
    ],
    beat_count: 2,
    downbeat_count: 1,
    bar_count: 1,
    first_beat_ms: 0,
    first_downbeat_ms: 0,
    minimum_bpm: 140,
    maximum_bpm: 140,
    is_variable_tempo: variable,
    parser_version: 'test',
  };
}

function candidate(id: string, bpm: number, camelot: string): RouletteCandidateAnalysis {
  return {
    track: track(id, bpm, camelot),
    stemAsset: null,
    beatGrid: grid(id),
    phraseCount: 1,
    vocalAnalysisAvailable: true,
  };
}

describe('Roulette candidate index service', () => {
  it('selects an initial compatible pair without requiring stem rows', async () => {
    const vocal = candidate('vocal-1', 140, '11A');
    const instrumental = candidate('instrumental-1', 145, '11B');
    const index = createRouletteCandidateIndex({
      loadCandidates: async (role) => role === 'vocal' ? [vocal] : [instrumental],
      rng: () => 0,
    });

    const result = await index.selectInitialPair('import-1');
    expect(result.status).toBe('selected');
    if (result.status === 'selected') {
      expect(result.pair.vocal.track.id).toBe('vocal-1');
      expect(result.pair.instrumental.track.id).toBe('instrumental-1');
      expect(result.pair.vocal.stemAsset).toBeNull();
      expect(result.pair.instrumental.stemAsset).toBeNull();
    }
  });

  it('returns structured diagnostics when no pair is eligible', async () => {
    const vocal = candidate('vocal-1', 140, '11A');
    const instrumental = candidate('instrumental-1', 146, '5B');
    const index = createRouletteCandidateIndex({
      loadCandidates: async (role) => role === 'vocal' ? [vocal] : [instrumental],
      rng: () => 0,
    });

    const result = await index.selectInitialPair();
    expect(result.status).toBe('no-pair');
    expect(result.diagnostics['incompatible-key']).toBe(1);
    expect(result.diagnostics.eligible).toBe(0);
  });

  it('keeps stable ordered candidates while seeded selection remains deterministic', async () => {
    const vocals = [candidate('vocal-a', 140, '11A'), candidate('vocal-b', 141, '11A')];
    const instrumentals = [candidate('inst-a', 140, '11A'), candidate('inst-b', 142, '12A')];
    const index = createRouletteCandidateIndex({
      loadCandidates: async (role) => role === 'vocal' ? vocals : instrumentals,
      rng: () => 0.25,
    });

    const first = await index.build();
    const second = await index.build();
    expect(first.orderedPairs.map((pair) => `${pair.vocal.track.id}:${pair.instrumental.track.id}`))
      .toEqual(second.orderedPairs.map((pair) => `${pair.vocal.track.id}:${pair.instrumental.track.id}`));

    const selectedA = await index.selectInitialPair();
    const selectedB = await index.selectInitialPair();
    expect(selectedA).toEqual(selectedB);
  });
});
