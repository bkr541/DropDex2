import type { RekordboxTrack } from '../../types';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import type { RouletteCandidateAnalysis } from '../../features/roulette/rouletteMatching';

export function fixtureTrack(id: string, bpm = 142, camelot = '9A'): RekordboxTrack {
  return {
    id,
    import_id: 'import-1',
    rekordbox_content_id: id,
    title: id,
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

export function fixtureGrid(trackId: string, firstDownbeatMs = 0, bpm = 142): BeatGridRow {
  const beatMs = 60000 / bpm;
  const beats = Array.from({ length: 16 }, (_, index) => ({
    seq: index + 1,
    srcIdx: index + 1,
    beatInBar: (index % 4) + 1,
    bar: Math.floor(index / 4) + 1,
    ms: Math.round(firstDownbeatMs + index * beatMs),
    bpm,
    isDownbeat: index % 4 === 0,
  }));
  return {
    id: `grid-${trackId}`,
    import_id: 'import-1',
    track_id: trackId,
    source_tag: 'PQTZ',
    beats,
    beat_count: beats.length,
    downbeat_count: 4,
    bar_count: 4,
    first_beat_ms: firstDownbeatMs,
    first_downbeat_ms: firstDownbeatMs,
    minimum_bpm: bpm,
    maximum_bpm: bpm,
    is_variable_tempo: false,
    parser_version: 'test',
  };
}

export function fixtureCandidate(id: string, options: { bpm?: number; camelot?: string } = {}): RouletteCandidateAnalysis {
  const bpm = options.bpm ?? 142;
  return {
    track: fixtureTrack(id, bpm, options.camelot ?? '9A'),
    beatGrid: fixtureGrid(id, 0, bpm),
    phraseCount: 2,
  };
}
