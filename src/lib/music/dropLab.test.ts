import { describe, expect, it } from 'vitest';
import { resolveDropPoints } from './dropPointResolver';
import {
  buildDropLabSegments,
  resolveTrackDurationMs,
} from './dropLabSegments';
import {
  bucketRenderableColumns,
  hasNoCenterTaper,
  sliceWaveformSegment,
  toRenderableColumns,
} from './waveformSegments';
import type { BeatEntry } from './beatGridHelpers';
import type { CueRow } from './cueHelpers';
import type { PhraseRow } from './phraseHelpers';
import type { TrackPreviewWaveform } from '../queries/waveformValidation';
import type { RekordboxTrack } from '../../types';

function beats(bars: number, bpm = 120): BeatEntry[] {
  const beatMs = 60_000 / bpm;
  return Array.from({ length: bars * 4 }, (_, i) => ({
    seq: i + 1,
    srcIdx: i,
    beatInBar: (i % 4) + 1,
    bar: Math.floor(i / 4) + 1,
    ms: i * beatMs,
    bpm,
    isDownbeat: i % 4 === 0,
  }));
}

function cue(overrides: Partial<CueRow>): CueRow {
  return {
    id: 'cue-1',
    cue_family: 'hot',
    hot_cue_slot: 1,
    point_type: 'cue',
    start_ms: 32_000,
    end_ms: null,
    color_hex: null,
    color_name: null,
    comment: null,
    is_active_loop: null,
    beat_loop_numerator: null,
    beat_loop_denominator: null,
    source_db_present: true,
    source_anlz_present: true,
    ...overrides,
  };
}

function phrase(
  id: string,
  label: string,
  startMs: number,
  endMs: number,
): PhraseRow {
  return {
    id,
    phrase_index: Number(id.replace(/\D/g, '')) || 0,
    source_mood: null,
    normalized_label: label,
    start_beat: null,
    end_beat: null,
    start_ms: startMs,
    end_ms: endMs,
    fill_start_beat: null,
    fill_start_ms: null,
    source_flags: {},
    source_payload: {},
    parser_version: null,
  };
}

function track(id: string, bpm = 120): RekordboxTrack {
  return {
    id,
    import_id: 'import-1',
    rekordbox_content_id: id,
    title: id,
    artist: null,
    album: null,
    remixer: null,
    genre: null,
    label: null,
    musical_key: null,
    camelot_key: null,
    normalized_key_name: null,
    key_tonic: null,
    key_mode: null,
    bpm,
    duration_seconds: 180,
    rating: null,
    comments: null,
    file_path: '/Contents/a.mp3',
    file_format: 'mp3',
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
  };
}

function waveform(count = 100): TrackPreviewWaveform {
  return {
    trackId: 'track-1',
    previewFormat: 'PWV4',
    previewColumnCount: count,
    previewColumns: Array.from({ length: count }, (_, i) => ({
      h: 64 + (i % 8),
      r: 200,
      g: 100,
      b: 100,
    })),
    previewColumnsValid: true,
    inferredFormat: 'color',
    validationError: null,
    invalidReason: null,
    detailFormat: null,
    detailColumnCount: null,
    detailStorageBucket: null,
    detailStoragePath: null,
  };
}

describe('resolveDropPoints', () => {
  it('prefers a cue whose comment contains drop over phrase inference', () => {
    const points = resolveDropPoints({
      cues: [cue({ id: 'explicit', comment: 'DROP', start_ms: 48_000 })],
      phrases: [
        phrase('p1', 'up', 20_000, 32_000),
        phrase('p2', 'down', 32_000, 48_000),
      ],
      beats: beats(64),
      durationMs: 180_000,
    });
    expect(points[0].source).toBe('cue');
    expect(points[0].id).toBe('cue-explicit');
  });

  it('matches drop cue comments case-insensitively', () => {
    const points = resolveDropPoints({
      cues: [cue({ comment: 'big Drop here' })],
      phrases: [],
      beats: beats(64),
      durationMs: 180_000,
    });
    expect(points[0].confidence).toBe('high');
  });

  it('resolves an up phrase followed by down as a high confidence drop', () => {
    const points = resolveDropPoints({
      cues: [],
      phrases: [
        phrase('p1', 'up', 20_000, 32_000),
        phrase('p2', 'down', 32_000, 48_000),
      ],
      beats: beats(64),
      durationMs: 180_000,
    });
    expect(points[0]).toMatchObject({ source: 'phrase', confidence: 'high' });
  });

  it('resolves an up phrase followed by chorus', () => {
    const points = resolveDropPoints({
      cues: [],
      phrases: [
        phrase('p1', 'up', 20_000, 32_000),
        phrase('p2', 'chorus', 32_000, 48_000),
      ],
      beats: beats(64),
      durationMs: 180_000,
    });
    expect(points[0].label).toBe('Build into chorus');
  });

  it('considers a chorus following a verse when stronger signals are absent', () => {
    const points = resolveDropPoints({
      cues: [],
      phrases: [
        phrase('p1', 'verse', 8_000, 24_000),
        phrase('p2', 'chorus', 24_000, 40_000),
      ],
      beats: beats(64),
      durationMs: 180_000,
    });
    expect(points[0].label).toBe('Chorus entrance');
  });

  it('snaps inferred phrase drops to the nearest valid downbeat', () => {
    const points = resolveDropPoints({
      cues: [],
      phrases: [
        phrase('p1', 'up', 10_000, 31_900),
        phrase('p2', 'down', 31_900, 45_000),
      ],
      beats: beats(64),
      durationMs: 180_000,
    });
    expect(points[0].dropMs).toBe(32_000);
  });

  it('does not snap a user-defined drop cue an unreasonable distance', () => {
    const points = resolveDropPoints({
      cues: [cue({ comment: 'drop', start_ms: 33_200 })],
      phrases: [],
      beats: beats(64),
      durationMs: 180_000,
    });
    expect(points[0].dropMs).toBe(33_200);
  });
});

describe('buildDropLabSegments', () => {
  it('uses the correct 4-bar selected segment before the source drop', () => {
    const grid = beats(64);
    const result = buildDropLabSegments({
      sourceTrack: track('source'),
      candidateTrack: track('candidate'),
      sourceDrop: {
        id: 's',
        dropMs: 64_000,
        dropBeat: null,
        buildStartMs: 0,
        confidence: 'high',
        source: 'cue',
        label: 'Drop',
      },
      candidateDrop: {
        id: 'c',
        dropMs: 64_000,
        dropBeat: null,
        buildStartMs: 0,
        confidence: 'high',
        source: 'cue',
        label: 'Drop',
      },
      sourceBeats: grid,
      candidateBeats: grid,
      barCount: 4,
      beatOffset: 0,
    });
    expect(result.source?.startMs).toBe(56_000);
    expect(result.source?.endMs).toBe(64_000);
  });

  it('uses the correct 8-bar selected segment before the source drop', () => {
    const grid = beats(64);
    const result = buildDropLabSegments({
      sourceTrack: track('source'),
      candidateTrack: track('candidate'),
      sourceDrop: {
        id: 's',
        dropMs: 64_000,
        dropBeat: null,
        buildStartMs: 0,
        confidence: 'high',
        source: 'cue',
        label: 'Drop',
      },
      candidateDrop: {
        id: 'c',
        dropMs: 64_000,
        dropBeat: null,
        buildStartMs: 0,
        confidence: 'high',
        source: 'cue',
        label: 'Drop',
      },
      sourceBeats: grid,
      candidateBeats: grid,
      barCount: 8,
      beatOffset: 0,
    });
    expect(result.source?.startMs).toBe(48_000);
  });

  it('uses the correct 16-bar candidate segment after the drop', () => {
    const grid = beats(96);
    const result = buildDropLabSegments({
      sourceTrack: track('source'),
      candidateTrack: track('candidate'),
      sourceDrop: {
        id: 's',
        dropMs: 32_000,
        dropBeat: null,
        buildStartMs: 0,
        confidence: 'high',
        source: 'cue',
        label: 'Drop',
      },
      candidateDrop: {
        id: 'c',
        dropMs: 32_000,
        dropBeat: null,
        buildStartMs: 0,
        confidence: 'high',
        source: 'cue',
        label: 'Drop',
      },
      sourceBeats: grid,
      candidateBeats: grid,
      barCount: 16,
      beatOffset: 0,
    });
    expect(result.candidate?.startMs).toBe(32_000);
    expect(result.candidate?.endMs).toBe(64_000);
  });

  it('uses BPM timing only when beat-grid timing is unavailable', () => {
    const result = buildDropLabSegments({
      sourceTrack: track('source', 120),
      candidateTrack: track('candidate', 120),
      sourceDrop: {
        id: 's',
        dropMs: 32_000,
        dropBeat: null,
        buildStartMs: 0,
        confidence: 'high',
        source: 'cue',
        label: 'Drop',
      },
      candidateDrop: {
        id: 'c',
        dropMs: 32_000,
        dropBeat: null,
        buildStartMs: 0,
        confidence: 'high',
        source: 'cue',
        label: 'Drop',
      },
      sourceBeats: [],
      candidateBeats: [],
      barCount: 4,
      beatOffset: 0,
    });
    expect(result.source?.timingSource).toBe('bpm');
    expect(result.source?.startMs).toBe(24_000);
  });

  it('prefers exact millisecond duration over rounded seconds', () => {
    const t = {
      ...track('source'),
      duration_seconds: 183,
      duration_ms: 183_456,
    };
    expect(resolveTrackDurationMs(t, []).durationMs).toBe(183_456);
  });

  it('resolves duration from the final beat grid timestamp when stored duration is absent', () => {
    const t = { ...track('source'), duration_seconds: 0 };
    expect(resolveTrackDurationMs(t, beats(4)).durationMs).toBe(7500);
  });
});

describe('waveformSegments', () => {
  it('safely handles zero duration', () => {
    const result = sliceWaveformSegment(waveform(), 0, 1000, 0);
    expect(result?.unavailableReason).toBe('Missing duration');
  });

  it('clamps negative and out-of-range times', () => {
    const result = sliceWaveformSegment(waveform(100), -1000, 12_000, 10_000);
    expect(result?.startMs).toBe(0);
    expect(result?.endMs).toBe(10_000);
    expect(result?.columns).toHaveLength(100);
  });

  it('returns a graceful unavailable state for empty slices', () => {
    const result = sliceWaveformSegment(waveform(100), 5000, 5000, 10_000);
    expect(result?.unavailableReason).toBe('Empty waveform segment');
  });

  it('applies no center taper or seam amplitude multiplier', () => {
    const left = toRenderableColumns(
      sliceWaveformSegment(waveform(100), 4000, 5000, 10_000),
    );
    const right = toRenderableColumns(
      sliceWaveformSegment(waveform(100), 5000, 6000, 10_000),
    );
    expect(hasNoCenterTaper(left, right)).toBe(true);
    expect(left.at(-1)?.height).toBeGreaterThan(0);
    expect(right[0].height).toBeGreaterThan(0);
  });

  it('uses the explicit PWV3 height scale for mono detail segments', () => {
    const mono: TrackPreviewWaveform = {
      ...waveform(1),
      previewFormat: 'PWV3',
      previewColumns: [{ h: 31, i: 7 }],
      inferredFormat: 'mono',
      heightScale: 31,
      dataVersion: 2,
    };
    const segment = sliceWaveformSegment(mono, 0, 1_000, 1_000);
    expect(toRenderableColumns(segment)[0].height).toBe(1);
  });

  it('downsamples detail columns with peak and Rekordbox color preservation', () => {
    const buckets = bucketRenderableColumns(
      [
        { height: 0.2, r: 10, g: 20, b: 30 },
        { height: 0.9, r: 200, g: 100, b: 50 },
        { height: 0.3, r: 1, g: 2, b: 3 },
        { height: 0.7, r: 70, g: 80, b: 90 },
      ],
      2,
    );
    expect(buckets).toEqual([
      { height: 0.9, r: 200, g: 100, b: 50 },
      { height: 0.7, r: 70, g: 80, b: 90 },
    ]);
  });

  it('detects an artificial center taper instead of always returning true', () => {
    const left = [
      { height: 0.8 },
      { height: 0.8 },
      { height: 0.8 },
      { height: 0.8 },
      { height: 0.01 },
      { height: 0.01 },
      { height: 0.01 },
      { height: 0.01 },
    ];
    const right = [
      { height: 0.01 },
      { height: 0.01 },
      { height: 0.01 },
      { height: 0.01 },
      { height: 0.8 },
      { height: 0.8 },
      { height: 0.8 },
      { height: 0.8 },
    ];
    expect(hasNoCenterTaper(left, right)).toBe(false);
  });

  it('does not re-normalize legacy PWV5 height values', () => {
    const color: TrackPreviewWaveform = {
      ...waveform(1),
      previewFormat: 'PWV5',
      previewColumns: [{ h: 1, r: 255, g: 128, b: 0 }],
      inferredFormat: 'color',
      heightScale: 1,
      dataVersion: 1,
    };
    const segment = sliceWaveformSegment(color, 0, 1_000, 1_000);
    expect(toRenderableColumns(segment)[0].height).toBe(1);
  });
});
