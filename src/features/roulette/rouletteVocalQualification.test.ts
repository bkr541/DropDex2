import { describe, expect, it } from 'vitest';
import type { VocalAnalysisRow, VocalRegionRow } from '../../lib/queries/analysisData';
import {
  hasQualifyingRouletteVocalMaterial,
  qualifyingRouletteVocalRegions,
} from './rouletteVocalQualification';

function region(durationMs = 4_000, confidence = 4): VocalRegionRow {
  return {
    start_frame: 10,
    end_frame_exclusive: 10 + Math.max(1, Math.floor(durationMs / 100)),
    start_ms: 1_000,
    end_ms: 1_000 + durationMs,
    duration_ms: durationMs,
    peak_confidence: confidence,
  };
}

function analysis(regions: VocalRegionRow[], overrides: Partial<VocalAnalysisRow> = {}): VocalAnalysisRow {
  return {
    id: 'pvdi-track-a',
    import_id: 'import-1',
    track_id: 'track-a',
    source_tag: 'PVDI',
    source_header_length: null,
    source_u1: null,
    source_u2: null,
    frame_duration_ms: 100,
    frame_count: 1800,
    regions,
    integrity_status: 'valid',
    complete: true,
    parse_warnings: [],
    parser_version: 'test',
    ...overrides,
  };
}

describe('Roulette Vocal source qualification', () => {
  it('qualifies strong valid PVDI vocal material', () => {
    const row = analysis([region(4_000, 4)]);
    expect(hasQualifyingRouletteVocalMaterial(row)).toBe(true);
    expect(qualifyingRouletteVocalRegions(row)).toHaveLength(1);
  });

  it('fails closed when Vocal analysis is missing', () => {
    expect(hasQualifyingRouletteVocalMaterial(null)).toBe(false);
  });

  it('rejects valid analysis that explicitly contains no meaningful Vocal regions', () => {
    expect(hasQualifyingRouletteVocalMaterial(analysis([]))).toBe(false);
  });

  it('rejects a tiny Vocal fragment even when its confidence is strong', () => {
    expect(hasQualifyingRouletteVocalMaterial(analysis([region(1_500, 4)]))).toBe(false);
  });

  it('rejects a long region whose PVDI confidence is below the existing strong threshold', () => {
    expect(hasQualifyingRouletteVocalMaterial(analysis([region(5_000, 2)]))).toBe(false);
  });

  it('rejects incomplete or invalid PVDI analysis instead of guessing', () => {
    expect(hasQualifyingRouletteVocalMaterial(analysis([region()], { complete: false }))).toBe(false);
    expect(hasQualifyingRouletteVocalMaterial(analysis([region()], { integrity_status: 'invalid' }))).toBe(false);
  });
});
