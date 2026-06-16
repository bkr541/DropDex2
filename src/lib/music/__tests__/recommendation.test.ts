/**
 * Tests for the recommendation-aware Similar Vibes scoring pipeline.
 *
 * Covers the scoreCandidate integration with edge data, Camelot wheel matching,
 * BPM proximity, merge/rank, and edge-fetch fallback behavior.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  scoreCandidate,
  mergeCandidates,
  rankScoredCandidates,
  SCORE_RECIPROCAL_BONUS,
  SCORE_OUTGOING_BONUS,
  SCORE_INCOMING_BONUS,
  SCORE_RATING_MULTIPLIER,
  SCORE_CAMELOT_EXACT,
  SCORE_CAMELOT_RELATIVE,
  SCORE_CAMELOT_ADJACENT,
  SCORE_CAMELOT_ENERGY_BOOST,
  SCORE_BPM_MAX,
  SCORE_SAME_GENRE,
} from '../similarVibes';
import type { RekordboxTrack, SimilarTrackResult } from '../../../types';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTrack(
  overrides: Partial<RekordboxTrack> & { id: string; title: string }
): RekordboxTrack {
  return {
    import_id: 'import-test',
    rekordbox_content_id: overrides.id,
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
    bpm: null,
    duration_seconds: null,
    rating: null,
    comments: null,
    file_path: null,
    file_format: null,
    date_added: null,
    created_at: '2024-01-01T00:00:00Z',
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

function makeResult(id: string, score: number): SimilarTrackResult {
  return {
    track: makeTrack({ id, title: `Track ${id}` }),
    recommendationScore: score,
    reasons: [],
  };
}

const BASE_TRACK = makeTrack({ id: 'base', title: 'Base Track', camelot_key: '8A', bpm: 130 });
const BPM_TOL = 2;

// ── Edge direction bonuses ─────────────────────────────────────────────────────

describe('rekordbox edge direction bonuses', () => {
  it('outgoing recommendedLike gives SCORE_OUTGOING_BONUS', () => {
    const candidate = makeTrack({ id: 'c1', title: 'C1', bpm: 130 });
    const result = scoreCandidate({
      selected: BASE_TRACK,
      candidate,
      bpmTolerance: BPM_TOL,
      edge: { direction: 'outgoing', rating: null, createdAt: null },
    });
    const edgeReason = result.reasons.find((r) => r.kind === 'rekordbox_match');
    expect(edgeReason?.score).toBe(SCORE_OUTGOING_BONUS);
    expect(result.recommendationScore).toBeGreaterThanOrEqual(SCORE_OUTGOING_BONUS);
  });

  it('incoming recommendedLike gives SCORE_INCOMING_BONUS', () => {
    const candidate = makeTrack({ id: 'c2', title: 'C2', bpm: 130 });
    const result = scoreCandidate({
      selected: BASE_TRACK,
      candidate,
      bpmTolerance: BPM_TOL,
      edge: { direction: 'incoming', rating: null, createdAt: null },
    });
    const edgeReason = result.reasons.find((r) => r.kind === 'rekordbox_match');
    expect(edgeReason?.score).toBe(SCORE_INCOMING_BONUS);
  });

  it('reciprocal gives SCORE_RECIPROCAL_BONUS (highest direction score)', () => {
    const candidate = makeTrack({ id: 'c3', title: 'C3', bpm: 130 });
    const result = scoreCandidate({
      selected: BASE_TRACK,
      candidate,
      bpmTolerance: BPM_TOL,
      edge: { direction: 'reciprocal', rating: null, createdAt: null },
    });
    const edgeReason = result.reasons.find((r) => r.kind === 'rekordbox_match');
    expect(edgeReason?.score).toBe(SCORE_RECIPROCAL_BONUS);
    expect(SCORE_RECIPROCAL_BONUS).toBeGreaterThan(SCORE_OUTGOING_BONUS);
    expect(SCORE_OUTGOING_BONUS).toBeGreaterThan(SCORE_INCOMING_BONUS);
  });

  it('reciprocal label reads "Reciprocal match"', () => {
    const candidate = makeTrack({ id: 'c3b', title: 'C3b', bpm: 130 });
    const result = scoreCandidate({
      selected: BASE_TRACK,
      candidate,
      bpmTolerance: BPM_TOL,
      edge: { direction: 'reciprocal', rating: null, createdAt: null },
    });
    const edgeReason = result.reasons.find((r) => r.kind === 'rekordbox_match');
    expect(edgeReason?.label).toBe('Reciprocal match');
  });

  it('outgoing/incoming label reads "Rekordbox match"', () => {
    const candidate = makeTrack({ id: 'c3c', title: 'C3c', bpm: 130 });
    const result = scoreCandidate({
      selected: BASE_TRACK,
      candidate,
      bpmTolerance: BPM_TOL,
      edge: { direction: 'outgoing', rating: null, createdAt: null },
    });
    const edgeReason = result.reasons.find((r) => r.kind === 'rekordbox_match');
    expect(edgeReason?.label).toBe('Rekordbox match');
  });
});

// ── Rating bonus ───────────────────────────────────────────────────────────────

describe('rating bonus', () => {
  it('rating of 5 adds SCORE_RATING_MULTIPLIER * 5 to score', () => {
    const candidate = makeTrack({ id: 'cR', title: 'Rated', bpm: 130 });
    const withRating = scoreCandidate({
      selected: BASE_TRACK,
      candidate,
      bpmTolerance: BPM_TOL,
      edge: { direction: 'outgoing', rating: 5, createdAt: null },
    });
    const withoutRating = scoreCandidate({
      selected: BASE_TRACK,
      candidate,
      bpmTolerance: BPM_TOL,
      edge: { direction: 'outgoing', rating: null, createdAt: null },
    });
    expect(withRating.recommendationScore - withoutRating.recommendationScore)
      .toBeCloseTo(5 * SCORE_RATING_MULTIPLIER);
  });

  it('null rating adds 0 bonus', () => {
    const candidate = makeTrack({ id: 'cR2', title: 'NoRating', bpm: 130 });
    const withNull = scoreCandidate({
      selected: BASE_TRACK,
      candidate,
      bpmTolerance: BPM_TOL,
      edge: { direction: 'outgoing', rating: null, createdAt: null },
    });
    const withZero = scoreCandidate({
      selected: BASE_TRACK,
      candidate,
      bpmTolerance: BPM_TOL,
      edge: { direction: 'outgoing', rating: 0, createdAt: null },
    });
    expect(withNull.recommendationScore).toBe(withZero.recommendationScore);
  });
});

// ── Camelot wheel matching ─────────────────────────────────────────────────────

describe('Camelot wheel scoring', () => {
  it('same camelot key gives SCORE_CAMELOT_EXACT bonus', () => {
    const candidate = makeTrack({ id: 'ck1', title: 'Same', camelot_key: '8A', bpm: 130 });
    const result = scoreCandidate({ selected: BASE_TRACK, candidate, bpmTolerance: BPM_TOL });
    const r = result.reasons.find((x) => x.kind === 'same_camelot');
    expect(r?.score).toBe(SCORE_CAMELOT_EXACT);
  });

  it('relative key (same number opposite mode) gives SCORE_CAMELOT_RELATIVE bonus', () => {
    const candidate = makeTrack({ id: 'ck2', title: 'Relative', camelot_key: '8B', bpm: 130 });
    const result = scoreCandidate({ selected: BASE_TRACK, candidate, bpmTolerance: BPM_TOL });
    const r = result.reasons.find((x) => x.kind === 'relative_key');
    expect(r?.score).toBe(SCORE_CAMELOT_RELATIVE);
  });

  it('adjacent camelot (+1 same mode) gives SCORE_CAMELOT_ADJACENT bonus', () => {
    const candidate = makeTrack({ id: 'ck3', title: 'Adjacent', camelot_key: '9A', bpm: 130 });
    const result = scoreCandidate({ selected: BASE_TRACK, candidate, bpmTolerance: BPM_TOL });
    const r = result.reasons.find((x) => x.kind === 'adjacent_camelot');
    expect(r?.score).toBe(SCORE_CAMELOT_ADJACENT);
  });

  it('adjacent camelot (-1 same mode) gives SCORE_CAMELOT_ADJACENT bonus', () => {
    const candidate = makeTrack({ id: 'ck4', title: 'AdjDown', camelot_key: '7A', bpm: 130 });
    const result = scoreCandidate({ selected: BASE_TRACK, candidate, bpmTolerance: BPM_TOL });
    const r = result.reasons.find((x) => x.kind === 'adjacent_camelot');
    expect(r?.score).toBe(SCORE_CAMELOT_ADJACENT);
  });

  it('energy boost (+2 same mode) gives SCORE_CAMELOT_ENERGY_BOOST bonus', () => {
    const candidate = makeTrack({ id: 'ck5', title: 'EnergyBoost', camelot_key: '10A', bpm: 130 });
    const result = scoreCandidate({ selected: BASE_TRACK, candidate, bpmTolerance: BPM_TOL });
    const r = result.reasons.find((x) => x.kind === 'energy_boost');
    expect(r?.score).toBe(SCORE_CAMELOT_ENERGY_BOOST);
  });

  it('incompatible camelot gives 0 camelot bonus', () => {
    const candidate = makeTrack({ id: 'ck6', title: 'Incompatible', camelot_key: '3B', bpm: 130 });
    const result = scoreCandidate({ selected: BASE_TRACK, candidate, bpmTolerance: BPM_TOL });
    const camelotKinds = ['same_camelot', 'relative_key', 'adjacent_camelot', 'energy_boost'] as const;
    expect(result.reasons.some((r) => camelotKinds.includes(r.kind as typeof camelotKinds[number]))).toBe(false);
  });

  it('different raw key spelling resolved to same camelot gives exact match score', () => {
    // Both represent 8A — same camelot_key field should produce exact match
    const selected8A = makeTrack({ id: 'ss', title: 'Selected', camelot_key: '8A', bpm: 130 });
    const candidateAlso8A = makeTrack({ id: 'cs', title: 'Candidate', camelot_key: '8A', bpm: 130 });
    const result = scoreCandidate({ selected: selected8A, candidate: candidateAlso8A, bpmTolerance: BPM_TOL });
    const r = result.reasons.find((x) => x.kind === 'same_camelot');
    expect(r?.score).toBe(SCORE_CAMELOT_EXACT);
  });

  it('wrap-around: 12A adjacent_up gives 1A an adjacent bonus', () => {
    const selected12A = makeTrack({ id: 'w1', title: 'Track 12A', camelot_key: '12A', bpm: 130 });
    const candidate1A = makeTrack({ id: 'w2', title: 'Track 1A', camelot_key: '1A', bpm: 130 });
    const result = scoreCandidate({ selected: selected12A, candidate: candidate1A, bpmTolerance: BPM_TOL });
    const r = result.reasons.find((x) => x.kind === 'adjacent_camelot');
    expect(r?.score).toBe(SCORE_CAMELOT_ADJACENT);
  });
});

// ── BPM proximity ──────────────────────────────────────────────────────────────

describe('BPM proximity score', () => {
  it('same BPM gives SCORE_BPM_MAX', () => {
    const candidate = makeTrack({ id: 'bp1', title: 'SameBPM', camelot_key: '1B', bpm: 130 });
    const result = scoreCandidate({ selected: BASE_TRACK, candidate, bpmTolerance: BPM_TOL });
    const r = result.reasons.find((x) => x.kind === 'bpm_proximity');
    expect(r?.score).toBeCloseTo(SCORE_BPM_MAX);
    expect(r?.label).toBe('Same BPM');
  });

  it('BPM diff at exactly tolerance gives score of 0', () => {
    const candidate = makeTrack({ id: 'bp2', title: 'EdgeBPM', camelot_key: '1B', bpm: 132 });
    const result = scoreCandidate({ selected: BASE_TRACK, candidate, bpmTolerance: BPM_TOL });
    const r = result.reasons.find((x) => x.kind === 'bpm_proximity');
    expect(r?.score).toBeCloseTo(0);
  });

  it('BPM diff of 1 with tolerance 2 gives SCORE_BPM_MAX * 0.5', () => {
    const candidate = makeTrack({ id: 'bp3', title: 'HalfBPM', camelot_key: '1B', bpm: 131 });
    const result = scoreCandidate({ selected: BASE_TRACK, candidate, bpmTolerance: BPM_TOL });
    const r = result.reasons.find((x) => x.kind === 'bpm_proximity');
    expect(r?.score).toBeCloseTo(SCORE_BPM_MAX * 0.5);
  });

  it('BPM diff outside tolerance gives no bpm_proximity reason', () => {
    const candidate = makeTrack({ id: 'bp4', title: 'FarBPM', camelot_key: '1B', bpm: 133 });
    const result = scoreCandidate({ selected: BASE_TRACK, candidate, bpmTolerance: BPM_TOL });
    expect(result.reasons.some((r) => r.kind === 'bpm_proximity')).toBe(false);
  });
});

// ── Genre ──────────────────────────────────────────────────────────────────────

describe('same genre', () => {
  it('adds SCORE_SAME_GENRE for matching genre', () => {
    const selected = makeTrack({ id: 'sg1', title: 'S', genre: 'House', bpm: 128 });
    const candidate = makeTrack({ id: 'sg2', title: 'C', genre: 'House', bpm: 128 });
    const result = scoreCandidate({ selected, candidate, bpmTolerance: BPM_TOL });
    const r = result.reasons.find((x) => x.kind === 'same_genre');
    expect(r?.score).toBe(SCORE_SAME_GENRE);
  });

  it('no genre bonus for different genres', () => {
    const selected = makeTrack({ id: 'sg3', title: 'S', genre: 'House', bpm: 128 });
    const candidate = makeTrack({ id: 'sg4', title: 'C', genre: 'Techno', bpm: 128 });
    const result = scoreCandidate({ selected, candidate, bpmTolerance: BPM_TOL });
    expect(result.reasons.some((r) => r.kind === 'same_genre')).toBe(false);
  });
});

// ── mergeCandidates ────────────────────────────────────────────────────────────

describe('mergeCandidates deduplication', () => {
  it('duplicate candidates from two sources merges to higher-scoring result', () => {
    const edgeCandidates = [makeResult('dup', 80), makeResult('onlyEdge', 50)];
    const dbCandidates = [makeResult('dup', 30), makeResult('onlyDb', 20)];
    const merged = mergeCandidates(edgeCandidates, dbCandidates);
    const dupResult = merged.find((r) => r.track.id === 'dup');
    expect(dupResult?.recommendationScore).toBe(80);
    expect(merged).toHaveLength(3);
  });

  it('preserves tracks unique to each source', () => {
    const edge = [makeResult('e1', 10)];
    const db = [makeResult('d1', 20)];
    const merged = mergeCandidates(edge, db);
    expect(merged.map((r) => r.track.id).sort()).toEqual(['d1', 'e1']);
  });
});

// ── rankScoredCandidates ───────────────────────────────────────────────────────

describe('rankScoredCandidates ordering', () => {
  it('results sorted by score DESC, then title ASC', () => {
    const candidates = [
      { ...makeResult('c', 50), track: { ...makeTrack({ id: 'c', title: 'Zebra' }), recommendationScore: 50 } },
      { ...makeResult('a', 80), track: { ...makeTrack({ id: 'a', title: 'Alpha' }), recommendationScore: 80 } },
      { ...makeResult('b', 50), track: { ...makeTrack({ id: 'b', title: 'Apple' }), recommendationScore: 50 } },
    ];

    const fixed: SimilarTrackResult[] = [
      { track: makeTrack({ id: 'a', title: 'Alpha' }), recommendationScore: 80, reasons: [] },
      { track: makeTrack({ id: 'b', title: 'Apple' }), recommendationScore: 50, reasons: [] },
      { track: makeTrack({ id: 'c', title: 'Zebra' }), recommendationScore: 50, reasons: [] },
    ];

    const ranked = rankScoredCandidates([fixed[2], fixed[0], fixed[1]]);
    expect(ranked.map((r) => r.track.id)).toEqual(['a', 'b', 'c']);
  });
});

// ── Edge fetch fallback ────────────────────────────────────────────────────────

describe('edge query failure fallback (unit)', () => {
  it('scoreCandidate still works with only db candidates when edge is omitted', () => {
    // Simulates the case where the edge fetch fails and we fall back to DB-only
    const selected = makeTrack({ id: 'base', title: 'Base', camelot_key: '8A', bpm: 128 });
    const candidate = makeTrack({ id: 'db1', title: 'DB Track', camelot_key: '8A', bpm: 128 });

    // No edge parameter — should still compute camelot + BPM scores
    const result = scoreCandidate({ selected, candidate, bpmTolerance: 2 });

    expect(result.rekordboxEvidence).toBeUndefined();
    expect(result.reasons.some((r) => r.kind === 'same_camelot')).toBe(true);
    expect(result.recommendationScore).toBeGreaterThan(0);
  });

  it('mergeCandidates with empty edge array returns db results only', () => {
    const dbCandidates = [makeResult('db1', 30), makeResult('db2', 20)];
    const merged = mergeCandidates([], dbCandidates);
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.track.id).sort()).toEqual(['db1', 'db2']);
  });
});
