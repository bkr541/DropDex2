import { describe, expect, it } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import {
  chooseWeightedRouletteCandidate,
  getRouletteHardFilterReason,
  isRouletteDirectTempoCompatible,
  rankRouletteCandidates,
  rankRoulettePairs,
  rankRoulettePairsBounded,
  rankRoulettePairsBoundedWithMetadata,
  ROULETTE_DIRECT_BPM_TOLERANCE,
  type RouletteCandidateAnalysis,
} from './rouletteMatching';
import { STEM_ASSET_CONTRACT_VERSION, type StemAssetRecord } from './stemAssets';

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
    key_tonic: 'E',
    key_mode: 'minor',
    bpm,
    duration_seconds: 180,
    rating: null,
    comments: null,
    file_path: `/music/${id}.wav`,
    file_format: 'WAV',
    date_added: null,
  } as RekordboxTrack;
}

function grid(trackId: string): BeatGridRow {
  return {
    id: `grid-${trackId}`,
    import_id: 'import-1',
    track_id: trackId,
    source_tag: 'PQTZ',
    beats: [
      { seq: 1, srcIdx: 1, beatInBar: 1, bar: 1, ms: 0, bpm: 142, isDownbeat: true },
      { seq: 2, srcIdx: 2, beatInBar: 2, bar: 1, ms: 422, bpm: 142, isDownbeat: false },
      { seq: 3, srcIdx: 3, beatInBar: 3, bar: 1, ms: 845, bpm: 142, isDownbeat: false },
      { seq: 4, srcIdx: 4, beatInBar: 4, bar: 1, ms: 1267, bpm: 142, isDownbeat: false },
    ],
    beat_count: 4,
    downbeat_count: 1,
    bar_count: 1,
    first_beat_ms: 0,
    first_downbeat_ms: 0,
    minimum_bpm: 142,
    maximum_bpm: 142,
    is_variable_tempo: false,
    parser_version: 'test',
  };
}

function asset(trackId: string, stemType: 'vocals' | 'instrumental', status: StemAssetRecord['status'] = 'ready'): StemAssetRecord {
  return {
    id: `${trackId}-${stemType}`,
    track_id: trackId,
    stem_type: stemType,
    installation_id: 'installation-1',
    status,
    storage_locator: status === 'ready' ? `${trackId}/${stemType}.wav` : null,
    source_fingerprint: `fingerprint-${trackId}`,
    separator_version: status === 'ready' ? 'separator-v1' : null,
    contract_version: STEM_ASSET_CONTRACT_VERSION,
    duration_ms: 180000,
    sample_rate_hz: 48000,
    channel_count: 2,
    file_size_bytes: 1000,
    file_mtime_ms: 100,
    analysis_metrics: null,
    failure_code: null,
    failure_message: null,
    created_at: '2026-09-08T00:00:00Z',
    updated_at: '2026-09-08T00:00:00Z',
  };
}

function candidate(
  id: string,
  role: 'vocal' | 'instrumental',
  overrides: Partial<RouletteCandidateAnalysis> = {},
): RouletteCandidateAnalysis {
  return {
    track: track(id),
    stemAsset: asset(id, role === 'vocal' ? 'vocals' : 'instrumental'),
    beatGrid: grid(id),
    phraseCount: 2,
    vocalAnalysisAvailable: role === 'vocal',
    ...overrides,
  };
}

describe('Roulette hard compatibility', () => {
  it('accepts the Stage-2 ±5 BPM window and rejects half/double time', () => {
    expect(ROULETTE_DIRECT_BPM_TOLERANCE).toBe(5);
    expect(isRouletteDirectTempoCompatible(137, 142)).toBe(true);
    expect(isRouletteDirectTempoCompatible(147, 142)).toBe(true);
    expect(isRouletteDirectTempoCompatible(142, 147.01)).toBe(false);
    expect(isRouletteDirectTempoCompatible(142, 71)).toBe(false);
    expect(isRouletteDirectTempoCompatible(142, 284)).toBe(false);
  });

  it.each([
    ['11A', '11A', null],
    ['11A', '10A', null],
    ['11A', '12A', null],
    ['11A', '11B', null],
    ['1A', '12A', null],
    ['12B', '1B', null],
    ['11A', '1A', 'key-mismatch'],
    ['11A', '5B', 'key-mismatch'],
  ] as const)('applies fixed Camelot MVP compatibility %s -> %s', (referenceKey, candidateKey, expected) => {
    const reference = { track: track('reference', 142, referenceKey), beatGrid: grid('reference') };
    expect(getRouletteHardFilterReason(
      candidate(`candidate-${candidateKey}`, 'vocal', { track: track(`candidate-${candidateKey}`, 142, candidateKey) }),
      reference,
      'vocal',
    )).toBe(expected);
  });

  it('requires a valid Camelot key instead of silently falling back to another key system', () => {
    const referenceTrack = track('reference', 142, '9A');
    referenceTrack.camelot_key = null;
    referenceTrack.normalized_key_name = 'E Minor';
    const candidateTrack = track('candidate', 142, '9A');
    candidateTrack.camelot_key = null;
    candidateTrack.normalized_key_name = 'e minor';
    const reference = { track: referenceTrack, beatGrid: grid('reference') };

    expect(getRouletteHardFilterReason(
      candidate('candidate', 'vocal', { track: candidateTrack }),
      reference,
      'vocal',
    )).toBe('missing-key');
  });

  it('does not require pre-existing stems for candidate eligibility', () => {
    const reference = { track: track('reference'), beatGrid: grid('reference') };
    const noStem = candidate('no-stem', 'vocal', {
      stemAsset: null,
      phraseCount: 2,
      vocalAnalysisAvailable: true,
    });
    expect(rankRouletteCandidates([noStem], reference, 'vocal')).toHaveLength(1);
  });

  it('requires qualified Vocal analysis as a hard Vocal-role eligibility gate', () => {
    const reference = { track: track('reference'), beatGrid: grid('reference') };
    const noVocalMaterial = candidate('no-vocal-material', 'vocal', {
      vocalAnalysisAvailable: false,
    });

    expect(getRouletteHardFilterReason(noVocalMaterial, reference, 'vocal')).toBe('missing-vocal-material');
    expect(rankRouletteCandidates([noVocalMaterial], reference, 'vocal')).toEqual([]);
  });

  it('does not remove a track from Instrumental eligibility when Vocal material is absent', () => {
    const reference = { track: track('reference'), beatGrid: grid('reference') };
    const instrumental = candidate('instrumental-only', 'instrumental', {
      vocalAnalysisAvailable: false,
    });

    expect(getRouletteHardFilterReason(instrumental, reference, 'instrumental')).toBeNull();
    expect(rankRouletteCandidates([instrumental], reference, 'instrumental')).toHaveLength(1);
  });

  it('requires a usable beat grid on both sides', () => {
    const reference = { track: track('reference'), beatGrid: grid('reference') };
    expect(getRouletteHardFilterReason(
      candidate('no-grid', 'vocal', { beatGrid: null }),
      reference,
      'vocal',
    )).toBe('missing-beat-grid');
  });

  it('rejects variable-tempo grids before pitch-locked matching', () => {
    const referenceGrid = grid('reference');
    referenceGrid.is_variable_tempo = true;
    const reference = { track: track('reference'), beatGrid: referenceGrid };
    expect(getRouletteHardFilterReason(
      candidate('candidate', 'vocal'),
      reference,
      'vocal',
    )).toBe('variable-tempo');

    const candidateGrid = grid('candidate');
    candidateGrid.is_variable_tempo = true;
    expect(getRouletteHardFilterReason(
      candidate('candidate', 'vocal', { beatGrid: candidateGrid }),
      { track: track('reference'), beatGrid: grid('reference') },
      'vocal',
    )).toBe('variable-tempo');
  });

  it('never forms a vocal/instrumental pair from the same parent track', () => {
    const vocal = candidate('same-parent', 'vocal');
    const instrumental = candidate('same-parent', 'instrumental');
    expect(rankRoulettePairs([vocal], [instrumental])).toEqual([]);
  });

  it('ranks deterministically after hard filtering', () => {
    const reference = { track: track('reference'), beatGrid: grid('reference') };
    const z = candidate('z-id', 'vocal', { track: track('z-id', 142, '9A', 'Zeta') });
    const a = candidate('a-id', 'vocal', { track: track('a-id', 142, '9A', 'Alpha') });
    expect(rankRouletteCandidates([z, a], reference, 'vocal').map((row) => row.candidate.track.id))
      .toEqual(['a-id', 'z-id']);
  });

  it('keeps weighted variety deterministic when randomness is injected', () => {
    const reference = { track: track('reference', 142, '9A'), beatGrid: grid('reference') };
    const ranked = rankRouletteCandidates([
      candidate('best', 'vocal', { track: track('best', 142, '9A', 'Best') }),
      candidate('alternate', 'vocal', { track: track('alternate', 146.5, '9A', 'Alternate') }),
    ], reference, 'vocal');

    const topA = chooseWeightedRouletteCandidate(ranked, () => 0);
    const topB = chooseWeightedRouletteCandidate(ranked, () => 0);
    const alternate = chooseWeightedRouletteCandidate(ranked, () => 0.999999);

    expect(topA?.candidate.track.id).toBe(ranked[0].candidate.track.id);
    expect(topB?.candidate.track.id).toBe(topA?.candidate.track.id);
    expect(alternate?.candidate.track.id).toBe(ranked.at(-1)?.candidate.track.id);
  });

  it('reports an exact pair count when the bounded matcher proves the evaluated space is complete', () => {
    const result = rankRoulettePairsBoundedWithMetadata(
      [candidate('vocal-exact', 'vocal')],
      [candidate('inst-exact', 'instrumental')],
      { maxPairs: 8, maxPartnersPerVocal: 8 },
    );

    expect(result.pairs).toHaveLength(1);
    expect(result.isTruncated).toBe(false);
  });

  it('reports truncation when the pair safety bound prevents an exact total', () => {
    const vocals = Array.from({ length: 8 }, (_, index) => candidate(`vocal-limit-${index}`, 'vocal'));
    const instrumentals = Array.from({ length: 8 }, (_, index) => candidate(`inst-limit-${index}`, 'instrumental'));
    const result = rankRoulettePairsBoundedWithMetadata(vocals, instrumentals, {
      maxPairs: 3,
      maxPartnersPerVocal: 2,
    });

    expect(result.pairs).toHaveLength(3);
    expect(result.isTruncated).toBe(true);
  });

  it('builds a bounded compatible pair pool instead of expanding the full Cartesian product', () => {
    const vocals = Array.from({ length: 120 }, (_, index) => candidate(
      `vocal-${index}`,
      'vocal',
      { track: track(`vocal-${index}`, 141.5 + (index % 4) * 0.2, '9A', `Vocal ${index}`) },
    ));
    const instrumentals = Array.from({ length: 160 }, (_, index) => candidate(
      `inst-${index}`,
      'instrumental',
      { track: track(`inst-${index}`, 141.4 + (index % 5) * 0.2, '9A', `Inst ${index}`) },
    ));

    const pairs = rankRoulettePairsBounded(vocals, instrumentals, {
      maxPairs: 40,
      maxPartnersPerVocal: 2,
    });

    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.length).toBeLessThanOrEqual(40);
    expect(pairs.every((pair) => pair.vocal.track.id !== pair.instrumental.track.id)).toBe(true);
    expect(pairs.every((pair) => Math.abs((pair.vocal.track.bpm ?? 0) - (pair.instrumental.track.bpm ?? 0)) <= 5)).toBe(true);
  });
});
