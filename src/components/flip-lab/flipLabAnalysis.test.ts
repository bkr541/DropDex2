import { describe, expect, it } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { BeatGridRow, PhraseRow } from '../../lib/queries/analysisData';
import type { RoulettePreviewWindow } from '../../features/roulette/roulettePreview';
import {
  deriveFlipLabAlignment,
  deriveFlipLabBarRuler,
  formatSignedBpmDelta,
  mapPhrasesToTimelineSegments,
  resolveFlipLabArtist,
  resolveFlipLabCamelotKey,
  signedVocalBpmDelta,
} from './flipLabAnalysis';

function track(overrides: Partial<RekordboxTrack> = {}): RekordboxTrack {
  return {
    id: 'track-1',
    import_id: 'import-1',
    rekordbox_content_id: '1',
    title: 'Track',
    artist: 'Artist',
    album: null,
    remixer: null,
    genre: null,
    label: null,
    musical_key: null,
    camelot_key: '9A',
    normalized_key_name: null,
    key_tonic: 'E',
    key_mode: 'minor',
    bpm: 142,
    duration_seconds: 120,
    duration_ms: 120000,
    rating: null,
    comments: null,
    file_path: null,
    file_format: null,
    date_added: null,
    created_at: '2026-01-01T00:00:00Z',
    master_db_id: null,
    master_content_id: null,
    analysis_data_file_path: null,
    analysed_bits: null,
    cue_update_count: null,
    analysis_data_update_count: null,
    information_update_count: null,
    analysis_reused_from_track_id: null,
    analysis_parse_status: null,
    analysis_parse_warnings: [],
    ...overrides,
  };
}

function phrase(overrides: Partial<PhraseRow> = {}): PhraseRow {
  return {
    id: 'phrase-1',
    import_id: 'import-1',
    track_id: 'track-1',
    phrase_index: 0,
    source_mood: null,
    source_kind: null,
    source_bank: null,
    normalized_label: 'verse',
    start_beat: 1,
    end_beat: 17,
    start_ms: 0,
    end_ms: 8000,
    fill_start_beat: null,
    fill_start_ms: null,
    source_flags: {},
    source_payload: {},
    parser_version: 'test',
    ...overrides,
  };
}

function grid(trackId: string, startMs = 1000, bars = 16): BeatGridRow {
  const beats = Array.from({ length: bars * 4 + 1 }, (_, index) => {
    const zeroBasedBar = Math.floor(index / 4);
    const beatInBar = (index % 4) + 1;
    return {
      seq: index + 1,
      srcIdx: index + 1,
      beatInBar,
      bar: zeroBasedBar + 1,
      ms: startMs + index * 500,
      bpm: 120,
      isDownbeat: beatInBar === 1,
    };
  });
  return {
    id: `grid-${trackId}`,
    import_id: 'import-1',
    track_id: trackId,
    source_tag: 'PQTZ',
    beats,
    beat_count: beats.length,
    downbeat_count: bars + 1,
    bar_count: bars + 1,
    first_beat_ms: startMs,
    first_downbeat_ms: startMs,
    minimum_bpm: 120,
    maximum_bpm: 120,
    is_variable_tempo: false,
    parser_version: 'test',
  };
}

function window(startMs = 1000, startSeq = 1, bars = 16): RoulettePreviewWindow {
  return {
    sourceTimeMs: startMs,
    windowEndMs: startMs + bars * 4 * 500,
    durationMs: bars * 4 * 500,
    sourceBar: 1,
    sourceBeatSequence: startSeq,
    requestedBars: bars,
    provenance: 'downbeat',
  };
}

describe('Flip Lab truthful metadata helpers', () => {
  it('distinguishes unknown artist from no selection', () => {
    expect(resolveFlipLabArtist(null, 'No vocal selected')).toBe('No vocal selected');
    expect(resolveFlipLabArtist({ artist: null }, 'No vocal selected')).toBe('Unknown artist');
    expect(resolveFlipLabArtist({ artist: '   ' }, 'No vocal selected')).toBe('Unknown artist');
  });

  it('uses the compatibility key resolver and never exposes N/A as a key', () => {
    expect(resolveFlipLabCamelotKey(track({ camelot_key: '9A' }))).toBe('9A');
    expect(resolveFlipLabCamelotKey(track({ camelot_key: 'N/A', key_tonic: 'E', key_mode: 'minor' }))).toBe('9A');
    expect(resolveFlipLabCamelotKey(track({ camelot_key: 'N/A', key_tonic: null, key_mode: null }))).toBeNull();
  });

  it('formats the Vocal-to-Instrumental BPM delta with direction', () => {
    expect(signedVocalBpmDelta(140, 142)).toBe(2);
    expect(formatSignedBpmDelta(signedVocalBpmDelta(140, 142))).toBe('+2.0 BPM');
    expect(formatSignedBpmDelta(signedVocalBpmDelta(144, 142))).toBe('-2.0 BPM');
    expect(formatSignedBpmDelta(signedVocalBpmDelta(142, 142))).toBe('0.0 BPM');
  });
});

describe('Flip Lab phrase and bar timeline helpers', () => {
  it('maps phrases relative to the prepared audition window', () => {
    const segments = mapPhrasesToTimelineSegments([
      phrase({ normalized_label: 'verse', start_ms: 0, end_ms: 8000 }),
      phrase({ phrase_index: 1, normalized_label: 'build', start_ms: 8000, end_ms: 16000 }),
    ], 20000, {
      ...window(4000, 9, 4),
      windowEndMs: 12000,
      durationMs: 8000,
    });

    expect(segments).toEqual([
      { label: 'verse', tone: 'verse', startPercent: 0, endPercent: 50 },
      { label: 'build', tone: 'build', startPercent: 50, endPercent: 100 },
    ]);
  });

  it('returns no invented sections when phrase data is missing', () => {
    expect(mapPhrasesToTimelineSegments([], 120000, null)).toEqual([]);
  });

  it('preserves custom labels with a neutral tone instead of inventing a known section', () => {
    const segments = mapPhrasesToTimelineSegments([
      phrase({ normalized_label: 'breakdown', start_ms: 0, end_ms: 8000 }),
    ], 8000, null);
    expect(segments).toEqual([
      { label: 'breakdown', tone: 'neutral', startPercent: 0, endPercent: 100 },
    ]);
  });

  it('derives a shared 16-bar ruler from real downbeat positions', () => {
    const ruler = deriveFlipLabBarRuler(
      grid('vocal'),
      grid('instrumental', 2500),
      window(1000),
      window(2500),
    );
    expect(ruler.status).toBe('available');
    if (ruler.status !== 'available') throw new Error('expected available ruler');
    expect(ruler.shared).toBe(true);
    expect(ruler.markers.map((marker) => marker.label)).toEqual(['1', '5', '9', '13']);
    expect(ruler.markers.map((marker) => marker.percent)).toEqual([0, 25, 50, 75]);
  });
});

describe('Flip Lab phrase alignment', () => {
  it('reports actual aligned prepared downbeats instead of a placeholder', () => {
    const vocalTrack = track({ id: 'vocal', bpm: 120 });
    const instrumentalTrack = track({ id: 'instrumental', bpm: 120 });
    const result = deriveFlipLabAlignment(
      vocalTrack,
      instrumentalTrack,
      grid('vocal'),
      grid('instrumental', 2500),
      [phrase({ track_id: 'vocal', normalized_label: 'verse', start_ms: 0, end_ms: 40000 })],
      [phrase({ track_id: 'instrumental', normalized_label: 'drop', start_ms: 0, end_ms: 40000 })],
      window(1000),
      window(2500),
    );
    expect(result.status).toBe('aligned');
    expect(result.label).toBe('Aligned');
    expect(result.subtitle).toContain('Vocal verse');
  });

  it('reports analysis unavailable when a prepared window or beat grid is missing', () => {
    const result = deriveFlipLabAlignment(
      track({ id: 'vocal', bpm: 120 }),
      track({ id: 'instrumental', bpm: 120 }),
      grid('vocal'),
      null,
      [],
      [],
      window(1000),
      null,
    );
    expect(result.status).toBe('unavailable');
    expect(result.label).toBe('Analysis unavailable');
  });
});
