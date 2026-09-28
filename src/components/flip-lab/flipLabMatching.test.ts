import { describe, expect, it } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import {
  getRoulettePairHardFilterReason,
  type RouletteCandidateAnalysis,
} from '../../features/roulette/rouletteMatching';
import {
  applyFlipLabSelection,
  chooseInitialFlipLabPair,
  getFlipLabPairRejectionReason,
  rankFlipLabSuggestions,
} from './flipLabMatching';

function track(id: string, bpm = 142, camelot = '9A', title = id): RekordboxTrack {
  return {
    id,
    import_id: 'import-1',
    rekordbox_content_id: id,
    title,
    artist: 'Artist',
    album: null,
    remixer: null,
    genre: 'Trap',
    label: 'Label',
    musical_key: 'Em',
    camelot_key: camelot,
    normalized_key_name: 'E minor',
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
      { seq: 1, srcIdx: 1, beatInBar: 1, bar: 1, ms: 0, bpm: 142, isDownbeat: true },
      { seq: 2, srcIdx: 2, beatInBar: 2, bar: 1, ms: 422, bpm: 142, isDownbeat: false },
    ],
    beat_count: 2,
    downbeat_count: 1,
    bar_count: 1,
    first_beat_ms: 0,
    first_downbeat_ms: 0,
    minimum_bpm: 142,
    maximum_bpm: 142,
    is_variable_tempo: variable,
    parser_version: 'test',
  };
}

function candidate(
  id: string,
  role: 'vocal' | 'instrumental',
  options: { bpm?: number; camelot?: string; title?: string; beatGrid?: BeatGridRow | null; source?: string | null } = {},
): RouletteCandidateAnalysis {
  const resultTrack = track(id, options.bpm ?? 142, options.camelot ?? '9A', options.title ?? id);
  resultTrack.file_path = options.source === undefined ? `/music/${id}.wav` : options.source;
  return {
    track: resultTrack,
    stemAsset: null,
    beatGrid: options.beatGrid === undefined ? grid(id) : options.beatGrid,
    phraseCount: role === 'vocal' ? 2 : 1,
  };
}

describe('Flip Lab canonical matching adapter', () => {
  it('chooses a deterministic canonical pair instead of raw database order', () => {
    const vocals = [
      candidate('vocal-db-first', 'vocal', { camelot: '2A', title: 'DB First' }),
      candidate('vocal-compatible', 'vocal', { camelot: '9A', title: 'Compatible' }),
    ];
    const instrumentals = [candidate('instrumental', 'instrumental', { camelot: '9A' })];

    const selected = chooseInitialFlipLabPair(vocals, instrumentals);

    expect(selected?.vocal.track.id).toBe('vocal-compatible');
    expect(selected?.instrumental.track.id).toBe('instrumental');
    expect(getRoulettePairHardFilterReason(selected!.vocal, selected!.instrumental)).toBeNull();
  });

  it('returns no initial selection when no canonical pair exists', () => {
    const selected = chooseInitialFlipLabPair(
      [candidate('vocal', 'vocal', { camelot: '2A' })],
      [candidate('instrumental', 'instrumental', { camelot: '9A' })],
    );
    expect(selected).toBeNull();
  });

  it('uses canonical ranking and filters invalid Suggested choices', () => {
    const opposite = candidate('instrumental', 'instrumental', { bpm: 142, camelot: '9A' });
    const compatible = candidate('compatible', 'vocal', { bpm: 142, camelot: '9A', title: 'Zulu' });
    const adjacent = candidate('adjacent', 'vocal', { bpm: 143, camelot: '10A', title: 'Alpha' });
    const outsideBpm = candidate('outside-bpm', 'vocal', { bpm: 148, camelot: '9A' });
    const noGrid = candidate('no-grid', 'vocal', { beatGrid: null });
    const energyBoost = candidate('energy-boost', 'vocal', { camelot: '11A' });

    expect(rankFlipLabSuggestions(
      [adjacent, outsideBpm, noGrid, energyBoost, compatible],
      opposite,
      'vocal',
    ).map((row) => row.track.id)).toEqual(['compatible', 'adjacent']);
  });

  it('never keeps the same parent track selected on both sides', () => {
    expect(applyFlipLabSelection('vocal', 'same', null, 'same')).toEqual({
      vocalId: 'same',
      instrumentalId: null,
    });
    expect(applyFlipLabSelection('instrumental', 'same', 'same', null)).toEqual({
      vocalId: null,
      instrumentalId: 'same',
    });
    expect(getFlipLabPairRejectionReason(
      candidate('same', 'vocal'),
      candidate('same', 'instrumental'),
    )).toBe('same-parent-track');
  });

  it.each([
    ['outside BPM tolerance', candidate('vocal-bpm', 'vocal', { bpm: 148 }), candidate('inst-bpm', 'instrumental', { bpm: 142 }), 'tempo-mismatch'],
    ['missing beat grid', candidate('vocal-grid', 'vocal', { beatGrid: null }), candidate('inst-grid', 'instrumental'), 'missing-beat-grid'],
    ['variable tempo', candidate('vocal-variable', 'vocal', { beatGrid: grid('vocal-variable', true) }), candidate('inst-variable', 'instrumental'), 'variable-tempo'],
    ['unavailable source', candidate('vocal-source', 'vocal', { source: null }), candidate('inst-source', 'instrumental'), 'source-unavailable'],
  ] as const)('marks %s as not Pair Ready using the canonical hard filter', (_label, vocal, instrumental, expected) => {
    expect(getFlipLabPairRejectionReason(vocal, instrumental)).toBe(expected);
    expect(getFlipLabPairRejectionReason(vocal, instrumental)).toBe(
      getRoulettePairHardFilterReason(vocal, instrumental),
    );
  });

  it('agrees with Roulette that the current energy-boost relationship is not eligible', () => {
    const vocal = candidate('vocal-energy', 'vocal', { camelot: '9A' });
    const instrumental = candidate('inst-energy', 'instrumental', { camelot: '11A' });
    expect(getFlipLabPairRejectionReason(vocal, instrumental)).toBe(
      getRoulettePairHardFilterReason(vocal, instrumental),
    );
    expect(getFlipLabPairRejectionReason(vocal, instrumental)).toBe('key-mismatch');
  });
});
