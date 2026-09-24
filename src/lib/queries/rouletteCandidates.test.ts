import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { BeatGridRow } from './analysisData';

const trackRows: RekordboxTrack[] = [];

vi.mock('../desktop/installationIdentity', () => ({
  getCurrentInstallationId: vi.fn(async () => 'installation-1'),
}));

vi.mock('../../features/roulette/stemAssetService', () => ({
  rouletteStemAssetService: {
    getReadiness: vi.fn(),
  },
}));

vi.mock('./rekordbox', () => ({
  fetchActiveImport: vi.fn(async () => ({ id: 'import-1' })),
  fetchTracksByIds: vi.fn(async (ids: string[]) => trackRows.filter((track) => ids.includes(track.id))),
}));

function grid(trackId: string): BeatGridRow {
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
    is_variable_tempo: false,
    parser_version: 'test',
  };
}

vi.mock('./analysisData', () => ({
  fetchTrackBeatGrids: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, grid(id)]))),
  fetchTracksPhrases: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, [{ phrase_index: 0 }]]))),
  fetchTracksVocalAnalysis: vi.fn(async (ids: string[]) => new Map(ids.flatMap((id) => {
    if (id.startsWith('missing-vocal')) return [];
    const regions = id.startsWith('vocal')
      ? [{
          start_frame: 10,
          end_frame_exclusive: 910,
          start_ms: 1_000,
          end_ms: 91_000,
          duration_ms: 90_000,
          peak_confidence: 4,
        }]
      : id.startsWith('tiny-vocal')
        ? [{
            start_frame: 10,
            end_frame_exclusive: 20,
            start_ms: 1_000,
            end_ms: 2_000,
            duration_ms: 1_000,
            peak_confidence: 4,
          }]
        : [];
    return [[id, {
      id: `pvdi-${id}`,
      import_id: 'import-1',
      track_id: id,
      source_tag: 'PVDI',
      source_header_length: null,
      source_u1: null,
      source_u2: null,
      frame_duration_ms: 100,
      frame_count: 1800,
      integrity_status: 'valid',
      complete: true,
      regions,
      parse_warnings: [],
      parser_version: 'test',
    }]];
  }))),
}));

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null })),
    },
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'or', 'order']) {
        chain[method] = vi.fn(() => chain);
      }
      chain.range = vi.fn(async () => ({
        data: table === 'rekordbox_tracks' ? trackRows : [],
        error: null,
      }));
      return chain;
    }),
  },
}));

import { fetchRouletteAvailabilitySnapshot, fetchRouletteCandidateAnalysis, fetchRouletteCandidateReadiness } from './rouletteCandidates';

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
    duration_ms: 180_000,
    rating: null,
    comments: null,
    file_path: `/USB/Music/${id}.wav`,
    file_format: 'WAV',
    date_added: null,
  } as RekordboxTrack;
}

describe('Roulette candidate query boundary', () => {
  beforeEach(() => {
    trackRows.length = 0;
  });

  it('derives readiness from imported Rekordbox metadata even when no stem rows exist', async () => {
    trackRows.push(
      track('vocal-1', 140, '11A'),
      track('instrumental-1', 145, '11B'),
    );

    const readiness = await fetchRouletteCandidateReadiness('import-1');

    expect(readiness.available).toBe(true);
    expect(readiness.compatiblePairCount).toBeGreaterThan(0);
    expect(readiness.reason).toBeNull();
  });

  it('returns only tracks with strong valid PVDI material for the Vocal role', async () => {
    trackRows.push(
      track('vocal-1', 140, '11A'),
      track('instrumental-1', 140, '11A'),
      track('empty-vocal-1', 140, '11A'),
      track('tiny-vocal-1', 140, '11A'),
      track('missing-vocal-1', 140, '11A'),
    );

    const vocals = await fetchRouletteCandidateAnalysis('vocal', 'import-1');
    const instrumentals = await fetchRouletteCandidateAnalysis('instrumental', 'import-1');

    expect(vocals.map((candidate) => candidate.track.id)).toEqual(['vocal-1']);
    expect(instrumentals.map((candidate) => candidate.track.id)).toEqual([
      'vocal-1',
      'instrumental-1',
      'empty-vocal-1',
      'tiny-vocal-1',
      'missing-vocal-1',
    ]);
  });
});

describe('Roulette action availability', () => {
  beforeEach(() => {
    trackRows.length = 0;
  });

  it('does not count the selected pair itself as a replacement or Roulette Both option', async () => {
    trackRows.push(
      track('vocal-1', 140, '11A'),
      track('instrumental-1', 145, '11B'),
    );

    const snapshot = await fetchRouletteAvailabilitySnapshot('vocal-1', 'instrumental-1', 'import-1');

    expect(snapshot.available).toBe(true);
    expect(snapshot.actions).toEqual({
      canChangeVocal: false,
      canChangeInstrumental: false,
      canRouletteBoth: false,
    });
  });

  it('enables partner-specific actions only when a different compatible source exists', async () => {
    trackRows.push(
      track('vocal-1', 140, '11A'),
      track('instrumental-1', 142, '11B'),
      track('vocal-2', 141, '11A'),
    );

    const snapshot = await fetchRouletteAvailabilitySnapshot('vocal-1', 'instrumental-1', 'import-1');

    expect(snapshot.actions.canChangeVocal).toBe(true);
    expect(snapshot.actions.canChangeInstrumental).toBe(true);
    expect(snapshot.actions.canRouletteBoth).toBe(true);
  });

  it('reports no actions available when pool has no compatible pairs', async () => {
    // Single track cannot pair with itself
    trackRows.push(track('solo-1', 140, '11A'));

    const snapshot = await fetchRouletteAvailabilitySnapshot(null, null, 'import-1');

    expect(snapshot.available).toBe(false);
    expect(snapshot.actions).toEqual({
      canChangeVocal: false,
      canChangeInstrumental: false,
      canRouletteBoth: false,
    });
  });
});
