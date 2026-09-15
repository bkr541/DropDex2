import { describe, expect, it } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type {
  BeatGridRow,
  PhraseRow,
  VocalAnalysisRow,
  VocalRegionRow,
} from '../../lib/queries/analysisData';
import { resolveRouletteMusicalAnchor } from './rouletteAnchors';

function track(id = 'track-a', bpm = 120): Pick<RekordboxTrack, 'id' | 'bpm'> {
  return { id, bpm };
}

function grid(trackId = 'track-a', bars = 40, beatMs = 500): BeatGridRow {
  const beats = Array.from({ length: bars * 4 }, (_, index) => {
    const bar = Math.floor(index / 4) + 1;
    const beatInBar = (index % 4) + 1;
    return {
      seq: index + 1,
      srcIdx: index + 1,
      beatInBar,
      bar,
      ms: index * beatMs,
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
    downbeat_count: bars,
    bar_count: bars,
    first_beat_ms: 0,
    first_downbeat_ms: 0,
    minimum_bpm: 120,
    maximum_bpm: 120,
    is_variable_tempo: false,
    parser_version: 'test',
  };
}

function phrase(phraseIndex: number, bar: number, overrides: Partial<PhraseRow> = {}): PhraseRow {
  const startBeat = (bar - 1) * 4 + 1;
  return {
    id: `phrase-${phraseIndex}`,
    import_id: 'import-1',
    track_id: 'track-a',
    phrase_index: phraseIndex,
    source_mood: '2',
    source_kind: '2',
    source_bank: null,
    normalized_label: 'verse',
    start_beat: startBeat,
    end_beat: startBeat + 31,
    start_ms: (startBeat - 1) * 500,
    end_ms: (startBeat + 30) * 500,
    fill_start_beat: null,
    fill_start_ms: null,
    source_flags: {},
    source_payload: {},
    parser_version: 'test',
    ...overrides,
  };
}

function region(startMs: number, durationMs: number, confidence = 4): VocalRegionRow {
  return {
    start_frame: Math.floor(startMs / 100),
    end_frame_exclusive: Math.floor((startMs + durationMs) / 100),
    start_ms: startMs,
    end_ms: startMs + durationMs,
    duration_ms: durationMs,
    peak_confidence: confidence,
  };
}


function stemMetrics(
  durationMs: number,
  scoreForMs: (startMs: number) => number,
) {
  const bins = Array.from({ length: Math.ceil(durationMs / 1000) }, (_, index) => {
    const startMs = index * 1000;
    const level = scoreForMs(startMs);
    return {
      startMs,
      endMs: Math.min(durationMs, startMs + 1000),
      rms: level * 0.08,
      signalRatio: level,
      nonSilentRatio: level,
    };
  });
  return {
    version: 'roulette-stem-metrics-v1',
    durationMs,
    rms: 0.04,
    signalRatio: 0.5,
    usableNonSilentDurationMs: durationMs / 2,
    activityEvidence: 0.5,
    energyStability: 0.5,
    suitabilityScore: 0.5,
    bins,
  };
}

function pvdi(regions: VocalRegionRow[]): VocalAnalysisRow {
  return {
    id: 'pvdi-1',
    import_id: 'import-1',
    track_id: 'track-a',
    source_tag: 'PVDI',
    source_header_length: null,
    source_u1: null,
    source_u2: null,
    frame_duration_ms: 100,
    frame_count: 1000,
    regions,
    integrity_status: 'valid',
    complete: true,
    parse_warnings: [],
    parser_version: 'test',
  };
}

describe('Roulette musical anchor resolver', () => {
  it('prefers meaningful PVDI activity snapped to a nearby phrase/downbeat instead of the first track downbeat', () => {
    const beatGrid = grid();
    const result = resolveRouletteMusicalAnchor({
      role: 'vocal',
      track: track(),
      beatGrid,
      phrases: [phrase(0, 9)],
      vocalAnalysis: pvdi([region(16_500, 5_000)]),
      durationMs: 80_000,
      requestedBars: 8,
    });

    expect(result?.provenance).toBe('pvdi-phrase');
    expect(result?.sourceBar).toBe(9);
    expect(result?.sourceTimeMs).toBe(16_000);
    expect(result?.windowEndMs).toBe(32_000);
  });

  it('chooses the PVDI window with more sustained vocal evidence and remains deterministic', () => {
    const input = {
      role: 'vocal' as const,
      track: track(),
      beatGrid: grid(),
      phrases: [phrase(0, 5), phrase(1, 17)],
      vocalAnalysis: pvdi([
        region(8_500, 2_100, 4),
        region(32_500, 6_000, 4),
      ]),
      durationMs: 100_000,
      requestedBars: 4,
    };

    const first = resolveRouletteMusicalAnchor(input);
    const second = resolveRouletteMusicalAnchor(input);
    expect(first?.sourceBar).toBe(17);
    expect(first).toEqual(second);
  });

  it('normalizes a phrase boundary on beat two back to its exact source downbeat', () => {
    const beatGrid = grid();
    const shifted = phrase(0, 9, { start_beat: 34, start_ms: 16_500 });
    const result = resolveRouletteMusicalAnchor({
      role: 'vocal',
      track: track(),
      beatGrid,
      phrases: [shifted],
      vocalAnalysis: pvdi([region(16_750, 4_000)]),
      durationMs: 80_000,
      requestedBars: 4,
    });

    expect(result?.sourceBar).toBe(9);
    expect(result?.sourceBeatSequence).toBe(33);
    expect(result?.sourceTimeMs).toBe(16_000);
  });

  it('keeps Rekordbox PVDI as the primary vocal signal even when stem metrics favor a later phrase', () => {
    const result = resolveRouletteMusicalAnchor({
      role: 'vocal',
      track: track(),
      beatGrid: grid(),
      phrases: [phrase(0, 5), phrase(1, 17)],
      vocalAnalysis: pvdi([region(8_500, 4_000)]),
      durationMs: 80_000,
      requestedBars: 4,
      stemMetrics: stemMetrics(80_000, (startMs) => (startMs >= 32_000 && startMs < 40_000 ? 1 : 0.05)),
    });

    expect(result?.provenance).toBe('pvdi-phrase');
    expect(result?.sourceBar).toBe(5);
  });

  it('uses stem metrics only to rank otherwise valid phrase windows when PVDI is unavailable', () => {
    const result = resolveRouletteMusicalAnchor({
      role: 'vocal',
      track: track(),
      beatGrid: grid(),
      phrases: [phrase(0, 5), phrase(1, 17)],
      vocalAnalysis: null,
      durationMs: 80_000,
      requestedBars: 4,
      stemMetrics: stemMetrics(80_000, (startMs) => (startMs >= 32_000 && startMs < 40_000 ? 0.95 : 0.1)),
    });

    expect(result?.provenance).toBe('phrase');
    expect(result?.sourceBar).toBe(17);
  });

  it('does not hard-exclude an otherwise valid anchor when stem quality metrics are low', () => {
    const result = resolveRouletteMusicalAnchor({
      role: 'vocal',
      track: track(),
      beatGrid: grid(),
      phrases: [phrase(0, 9)],
      vocalAnalysis: null,
      durationMs: 80_000,
      requestedBars: 4,
      stemMetrics: stemMetrics(80_000, () => 0),
    });

    expect(result).not.toBeNull();
    expect(result?.provenance).toBe('phrase');
    expect(result?.sourceBar).toBe(9);
  });

  it('falls back from missing PVDI to a viable non-outro phrase', () => {
    const result = resolveRouletteMusicalAnchor({
      role: 'vocal',
      track: track(),
      beatGrid: grid(),
      phrases: [phrase(0, 9)],
      vocalAnalysis: null,
      durationMs: 80_000,
      requestedBars: 4,
    });

    expect(result?.provenance).toBe('phrase');
    expect(result?.sourceBar).toBe(9);
  });

  it('falls back from missing phrases to the first exact downbeat with the requested span', () => {
    const result = resolveRouletteMusicalAnchor({
      role: 'instrumental',
      track: track(),
      beatGrid: grid(),
      phrases: [],
      durationMs: 80_000,
      requestedBars: 4,
    });

    expect(result?.provenance).toBe('downbeat');
    expect(result?.sourceBar).toBe(1);
    expect(result?.usableWindowMs).toBe(8_000);
  });

  it('skips an outro/short tail phrase that cannot provide the requested analyzed bars', () => {
    const result = resolveRouletteMusicalAnchor({
      role: 'instrumental',
      track: track(),
      beatGrid: grid('track-a', 24),
      phrases: [
        phrase(0, 9),
        phrase(1, 23, { source_mood: '1', source_kind: '6', normalized_label: 'outro' }),
      ],
      durationMs: 48_000,
      requestedBars: 8,
    });

    expect(result?.provenance).toBe('phrase');
    expect(result?.sourceBar).toBe(9);
  });

  it('uses the deterministic BPM window only when the parent beat grid is unavailable', () => {
    const result = resolveRouletteMusicalAnchor({
      role: 'instrumental',
      track: track('track-a', 120),
      beatGrid: null,
      phrases: [],
      durationMs: 40_000,
      requestedBars: 4,
    });

    expect(result).toMatchObject({
      provenance: 'bpm-fallback',
      sourceTimeMs: 0,
      sourceBar: null,
      windowEndMs: 8_000,
    });
  });

  it('fails closed when a valid analyzed grid has no source window long enough for the requested bars', () => {
    const result = resolveRouletteMusicalAnchor({
      role: 'instrumental',
      track: track(),
      beatGrid: grid('track-a', 4),
      phrases: [phrase(0, 1)],
      durationMs: 8_000,
      requestedBars: 8,
    });

    expect(result).toBeNull();
  });
});
