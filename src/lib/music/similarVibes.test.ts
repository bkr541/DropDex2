import { describe, expect, it } from 'vitest';
import {
  BPM_TOLERANCE_DEFAULT,
  hasSimilarVibesSignal,
  rankSimilarTracks,
  shouldUseBpm,
  scoreCandidate,
  mergeCandidates,
  rankScoredCandidates,
  SCORE_RECIPROCAL_BONUS,
  SCORE_OUTGOING_BONUS,
  SCORE_INCOMING_BONUS,
  SCORE_CAMELOT_EXACT,
  SCORE_CAMELOT_RELATIVE,
  SCORE_CAMELOT_ADJACENT,
  SCORE_CAMELOT_ENERGY_BOOST,
  SCORE_BPM_MAX,
  SCORE_SAME_GENRE,
  SCORE_SAME_LABEL,
  SCORE_RATING_MULTIPLIER,
} from './similarVibes';
import type { RekordboxTrack, SimilarTrackResult } from '../../types';

// ── Helpers ────────────────────────────────────────────────────────────────────

interface T { id: string; title: string; bpm: number | null; }
const track = (id: string, title: string, bpm: number | null): T => ({ id, title, bpm });
const SELECTED_ID = 'selected';

function makeTrack(overrides: Partial<RekordboxTrack> & { id: string; title: string }): RekordboxTrack {
  return {
    import_id: 'import-1',
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

// ── shouldUseBpm ──────────────────────────────────────────────────────────────

describe('shouldUseBpm', () => {
  it('returns true for positive numbers', () => {
    expect(shouldUseBpm(128)).toBe(true);
    expect(shouldUseBpm(0.1)).toBe(true);
  });
  it('returns false for null', () => expect(shouldUseBpm(null)).toBe(false));
  it('returns false for undefined', () => expect(shouldUseBpm(undefined)).toBe(false));
  it('returns false for 0 (unanalyzed)', () => expect(shouldUseBpm(0)).toBe(false));
  it('returns false for negative', () => expect(shouldUseBpm(-1)).toBe(false));
});

// ── hasSimilarVibesSignal ─────────────────────────────────────────────────────

describe('hasSimilarVibesSignal', () => {
  it('returns true when key and BPM are both present', () =>
    expect(hasSimilarVibesSignal('Am', 128)).toBe(true));
  it('returns true when key only', () =>
    expect(hasSimilarVibesSignal('Am', null)).toBe(true));
  it('returns true when BPM only', () =>
    expect(hasSimilarVibesSignal(null, 128)).toBe(true));
  it('returns false when neither present', () =>
    expect(hasSimilarVibesSignal(null, null)).toBe(false));
  it('returns false when BPM is 0 (unanalyzed) and key is absent', () =>
    expect(hasSimilarVibesSignal(null, 0)).toBe(false));
  it('returns false when key is empty string and BPM is absent', () =>
    expect(hasSimilarVibesSignal('', null)).toBe(false));
});

// ── rankSimilarTracks (legacy) ────────────────────────────────────────────────

describe('rankSimilarTracks', () => {
  it('returns empty array for empty candidates', () => {
    expect(rankSimilarTracks([], SELECTED_ID, 128)).toEqual([]);
  });

  it('excludes the selected track regardless of BPM match', () => {
    const candidates = [track(SELECTED_ID, 'Self', 128), track('other', 'Other', 128)];
    const result = rankSimilarTracks(candidates, SELECTED_ID, 128);
    expect(result.map((c) => c.id)).toEqual(['other']);
  });

  // ── key-only case (selectedBpm = null) ───────────────────────────────────

  it('includes null-BPM candidates when selectedBpm is null', () => {
    const candidates = [track('1', 'Alpha', null), track('2', 'Beta', 128)];
    expect(rankSimilarTracks(candidates, SELECTED_ID, null)).toHaveLength(2);
  });

  it('sorts by title only when selectedBpm is null', () => {
    const candidates = [
      track('3', 'Zebra', 130),
      track('1', 'Alpha', null),
      track('2', 'Mango', 128),
    ];
    const result = rankSimilarTracks(candidates, SELECTED_ID, null);
    expect(result.map((c) => c.title)).toEqual(['Alpha', 'Mango', 'Zebra']);
  });

  // ── BPM filtering ────────────────────────────────────────────────────────

  it('excludes candidates with null BPM when selectedBpm is set', () => {
    const candidates = [track('1', 'Good', 128), track('2', 'NoBpm', null)];
    expect(rankSimilarTracks(candidates, SELECTED_ID, 128).map((c) => c.id)).toEqual(['1']);
  });

  it('includes candidates at exact lower tolerance boundary', () => {
    const candidates = [track('1', 'LowerBound', 128 - BPM_TOLERANCE_DEFAULT)];
    expect(rankSimilarTracks(candidates, SELECTED_ID, 128)).toHaveLength(1);
  });

  it('includes candidates at exact upper tolerance boundary', () => {
    const candidates = [track('1', 'UpperBound', 128 + BPM_TOLERANCE_DEFAULT)];
    expect(rankSimilarTracks(candidates, SELECTED_ID, 128)).toHaveLength(1);
  });

  it('excludes candidates just below lower boundary', () => {
    const candidates = [track('1', 'TooSlow', 128 - BPM_TOLERANCE_DEFAULT - 0.01)];
    expect(rankSimilarTracks(candidates, SELECTED_ID, 128)).toHaveLength(0);
  });

  it('excludes candidates just above upper boundary', () => {
    const candidates = [track('1', 'TooFast', 128 + BPM_TOLERANCE_DEFAULT + 0.01)];
    expect(rankSimilarTracks(candidates, SELECTED_ID, 128)).toHaveLength(0);
  });

  // ── sorting ──────────────────────────────────────────────────────────────

  it('sorts by absolute BPM difference ascending', () => {
    const candidates = [
      track('far',   'Far',   130),  // diff = 2
      track('mid',   'Mid',   129),  // diff = 1
      track('exact', 'Exact', 128),  // diff = 0
    ];
    const result = rankSimilarTracks(candidates, SELECTED_ID, 128);
    expect(result.map((c) => c.id)).toEqual(['exact', 'mid', 'far']);
  });

  it('breaks BPM ties with alphabetical title sort', () => {
    const candidates = [
      track('3', 'Zebra', 129),
      track('1', 'Alpha', 129),
      track('2', 'Mango', 129),
    ];
    const result = rankSimilarTracks(candidates, SELECTED_ID, 128);
    expect(result.map((c) => c.title)).toEqual(['Alpha', 'Mango', 'Zebra']);
  });

  // ── limit ────────────────────────────────────────────────────────────────

  it('limits output to the limit param', () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      track(String(i), `Track ${i}`, 128),
    );
    expect(
      rankSimilarTracks(candidates, SELECTED_ID, 128, BPM_TOLERANCE_DEFAULT, 3),
    ).toHaveLength(3);
  });

  it('returns fewer than limit when not enough candidates pass the filter', () => {
    const candidates = [track('1', 'A', 128), track('2', 'B', 128)];
    expect(
      rankSimilarTracks(candidates, SELECTED_ID, 128, BPM_TOLERANCE_DEFAULT, 5),
    ).toHaveLength(2);
  });
});

// ── scoreCandidate ────────────────────────────────────────────────────────────

describe('scoreCandidate', () => {
  const selected = makeTrack({ id: 'sel', title: 'Selected', camelot_key: '8A', bpm: 128 });

  it('gives SCORE_CAMELOT_EXACT for same camelot key', () => {
    const candidate = makeTrack({ id: 'c1', title: 'Candidate', camelot_key: '8A', bpm: 128 });
    const result = scoreCandidate({ selected, candidate, bpmTolerance: 2 });
    expect(result.reasons.some((r) => r.kind === 'same_camelot')).toBe(true);
    expect(result.recommendationScore).toBeGreaterThanOrEqual(SCORE_CAMELOT_EXACT);
  });

  it('gives SCORE_CAMELOT_RELATIVE for relative key (same number, opposite mode)', () => {
    const candidate = makeTrack({ id: 'c2', title: 'Candidate', camelot_key: '8B', bpm: 128 });
    const result = scoreCandidate({ selected, candidate, bpmTolerance: 2 });
    expect(result.reasons.some((r) => r.kind === 'relative_key')).toBe(true);
    const camelotReason = result.reasons.find((r) => r.kind === 'relative_key');
    expect(camelotReason?.score).toBe(SCORE_CAMELOT_RELATIVE);
  });

  it('gives SCORE_CAMELOT_ADJACENT for adjacent key', () => {
    const candidate = makeTrack({ id: 'c3', title: 'Candidate', camelot_key: '9A', bpm: 128 });
    const result = scoreCandidate({ selected, candidate, bpmTolerance: 2 });
    expect(result.reasons.some((r) => r.kind === 'adjacent_camelot')).toBe(true);
    const camelotReason = result.reasons.find((r) => r.kind === 'adjacent_camelot');
    expect(camelotReason?.score).toBe(SCORE_CAMELOT_ADJACENT);
  });

  it('gives SCORE_CAMELOT_ENERGY_BOOST for +2 same mode', () => {
    const candidate = makeTrack({ id: 'c4', title: 'Candidate', camelot_key: '10A', bpm: 128 });
    const result = scoreCandidate({ selected, candidate, bpmTolerance: 2 });
    expect(result.reasons.some((r) => r.kind === 'energy_boost')).toBe(true);
    const camelotReason = result.reasons.find((r) => r.kind === 'energy_boost');
    expect(camelotReason?.score).toBe(SCORE_CAMELOT_ENERGY_BOOST);
  });

  it('gives 0 camelot bonus for incompatible key', () => {
    const candidate = makeTrack({ id: 'c5', title: 'Candidate', camelot_key: '3B', bpm: 128 });
    const result = scoreCandidate({ selected, candidate, bpmTolerance: 2 });
    expect(result.reasons.some((r) => r.kind === 'same_camelot')).toBe(false);
    expect(result.reasons.some((r) => r.kind === 'relative_key')).toBe(false);
    expect(result.reasons.some((r) => r.kind === 'adjacent_camelot')).toBe(false);
    expect(result.reasons.some((r) => r.kind === 'energy_boost')).toBe(false);
  });

  it('gives SCORE_BPM_MAX for exact BPM match', () => {
    const candidate = makeTrack({ id: 'c6', title: 'Candidate', camelot_key: '1A', bpm: 128 });
    const result = scoreCandidate({ selected, candidate, bpmTolerance: 2 });
    const bpmReason = result.reasons.find((r) => r.kind === 'bpm_proximity');
    expect(bpmReason).toBeDefined();
    expect(bpmReason?.score).toBeCloseTo(SCORE_BPM_MAX);
    expect(bpmReason?.label).toBe('Same BPM');
  });

  it('gives half SCORE_BPM_MAX at half tolerance BPM diff', () => {
    const candidate = makeTrack({ id: 'c7', title: 'Candidate', camelot_key: '1A', bpm: 129 });
    const result = scoreCandidate({ selected, candidate, bpmTolerance: 2 });
    const bpmReason = result.reasons.find((r) => r.kind === 'bpm_proximity');
    expect(bpmReason?.score).toBeCloseTo(SCORE_BPM_MAX * 0.5);
  });

  it('gives no BPM bonus when outside tolerance', () => {
    const candidate = makeTrack({ id: 'c8', title: 'Candidate', camelot_key: '8A', bpm: 131 });
    const result = scoreCandidate({ selected, candidate, bpmTolerance: 2 });
    expect(result.reasons.some((r) => r.kind === 'bpm_proximity')).toBe(false);
  });

  it('gives SCORE_SAME_GENRE for matching genre', () => {
    const selGenre = makeTrack({ id: 'sel2', title: 'Selected', genre: 'Techno', bpm: 128 });
    const candidate = makeTrack({ id: 'cg', title: 'Candidate', genre: 'Techno', bpm: 128 });
    const result = scoreCandidate({ selected: selGenre, candidate, bpmTolerance: 2 });
    expect(result.reasons.some((r) => r.kind === 'same_genre')).toBe(true);
    const genreReason = result.reasons.find((r) => r.kind === 'same_genre');
    expect(genreReason?.score).toBe(SCORE_SAME_GENRE);
  });

  it('genre match is case-insensitive', () => {
    const selGenre = makeTrack({ id: 'sel3', title: 'Selected', genre: 'TECHNO', bpm: 128 });
    const candidate = makeTrack({ id: 'cg2', title: 'Candidate', genre: '  techno  ', bpm: 128 });
    const result = scoreCandidate({ selected: selGenre, candidate, bpmTolerance: 2 });
    expect(result.reasons.some((r) => r.kind === 'same_genre')).toBe(true);
  });

  it('gives SCORE_SAME_LABEL for matching label', () => {
    const selLabel = makeTrack({ id: 'sel4', title: 'Selected', label: 'Warp', bpm: 128 });
    const candidate = makeTrack({ id: 'cl', title: 'Candidate', label: 'Warp', bpm: 128 });
    const result = scoreCandidate({ selected: selLabel, candidate, bpmTolerance: 2 });
    expect(result.reasons.some((r) => r.kind === 'same_label')).toBe(true);
    const labelReason = result.reasons.find((r) => r.kind === 'same_label');
    expect(labelReason?.score).toBe(SCORE_SAME_LABEL);
  });

  it('gives SCORE_RECIPROCAL_BONUS for reciprocal edge', () => {
    const candidate = makeTrack({ id: 'ce', title: 'EdgeTrack', bpm: 128 });
    const result = scoreCandidate({
      selected,
      candidate,
      bpmTolerance: 2,
      edge: { direction: 'reciprocal', rating: null, createdAt: null },
    });
    expect(result.recommendationScore).toBeGreaterThanOrEqual(SCORE_RECIPROCAL_BONUS);
    expect(result.rekordboxEvidence?.direction).toBe('reciprocal');
  });

  it('gives SCORE_OUTGOING_BONUS for outgoing edge', () => {
    const candidate = makeTrack({ id: 'ce2', title: 'EdgeTrack2', bpm: 128 });
    const result = scoreCandidate({
      selected,
      candidate,
      bpmTolerance: 2,
      edge: { direction: 'outgoing', rating: null, createdAt: null },
    });
    const edgeReason = result.reasons.find((r) => r.kind === 'rekordbox_match');
    expect(edgeReason?.score).toBe(SCORE_OUTGOING_BONUS);
  });

  it('gives SCORE_INCOMING_BONUS for incoming edge', () => {
    const candidate = makeTrack({ id: 'ce3', title: 'EdgeTrack3', bpm: 128 });
    const result = scoreCandidate({
      selected,
      candidate,
      bpmTolerance: 2,
      edge: { direction: 'incoming', rating: null, createdAt: null },
    });
    const edgeReason = result.reasons.find((r) => r.kind === 'rekordbox_match');
    expect(edgeReason?.score).toBe(SCORE_INCOMING_BONUS);
  });

  it('adds rating * SCORE_RATING_MULTIPLIER when rating is set', () => {
    const candidate = makeTrack({ id: 'ce4', title: 'Rated', bpm: 128 });
    const result = scoreCandidate({
      selected,
      candidate,
      bpmTolerance: 2,
      edge: { direction: 'outgoing', rating: 5, createdAt: null },
    });
    expect(result.recommendationScore).toBeGreaterThanOrEqual(
      SCORE_OUTGOING_BONUS + 5 * SCORE_RATING_MULTIPLIER
    );
  });

  it('sets rekordboxEvidence with correct fields', () => {
    const candidate = makeTrack({ id: 'ce5', title: 'Evidence', bpm: 128 });
    const result = scoreCandidate({
      selected,
      candidate,
      bpmTolerance: 2,
      edge: { direction: 'reciprocal', rating: 4, createdAt: '2024-01-01T00:00:00Z' },
    });
    expect(result.rekordboxEvidence).toEqual({
      rating: 4,
      direction: 'reciprocal',
      createdAt: '2024-01-01T00:00:00Z',
      relationshipSource: 'recommended_like',
    });
  });

  it('returns undefined rekordboxEvidence when no edge', () => {
    const candidate = makeTrack({ id: 'ce6', title: 'NoEdge', camelot_key: '8A', bpm: 128 });
    const result = scoreCandidate({ selected, candidate, bpmTolerance: 2 });
    expect(result.rekordboxEvidence).toBeUndefined();
  });
});

// ── mergeCandidates ───────────────────────────────────────────────────────────

describe('mergeCandidates', () => {
  function makeResult(id: string, score: number): SimilarTrackResult {
    return {
      track: makeTrack({ id, title: `Track ${id}` }),
      recommendationScore: score,
      reasons: [],
    };
  }

  it('merges unique tracks from both sources', () => {
    const edge = [makeResult('a', 50), makeResult('b', 30)];
    const db = [makeResult('c', 20)];
    const merged = mergeCandidates(edge, db);
    expect(merged.map((r) => r.track.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('deduplicates by keeping higher-scoring result', () => {
    const edge = [makeResult('a', 50)];
    const db = [makeResult('a', 20)];
    const merged = mergeCandidates(edge, db);
    expect(merged).toHaveLength(1);
    expect(merged[0].recommendationScore).toBe(50);
  });

  it('keeps db result when it scores higher than edge result', () => {
    const edge = [makeResult('a', 10)];
    const db = [makeResult('a', 60)];
    const merged = mergeCandidates(edge, db);
    expect(merged[0].recommendationScore).toBe(60);
  });

  it('returns empty array when both sources are empty', () => {
    expect(mergeCandidates([], [])).toEqual([]);
  });
});

// ── rankScoredCandidates ──────────────────────────────────────────────────────

describe('rankScoredCandidates', () => {
  function makeResult(id: string, score: number, title: string): SimilarTrackResult {
    return {
      track: makeTrack({ id, title }),
      recommendationScore: score,
      reasons: [],
    };
  }

  it('sorts by score descending', () => {
    const candidates = [
      makeResult('low', 10, 'Low'),
      makeResult('high', 80, 'High'),
      makeResult('mid', 40, 'Mid'),
    ];
    const ranked = rankScoredCandidates(candidates);
    expect(ranked.map((r) => r.track.id)).toEqual(['high', 'mid', 'low']);
  });

  it('breaks score ties with title ascending', () => {
    const candidates = [
      makeResult('z', 50, 'Zebra'),
      makeResult('a', 50, 'Alpha'),
      makeResult('m', 50, 'Mango'),
    ];
    const ranked = rankScoredCandidates(candidates);
    expect(ranked.map((r) => r.track.title)).toEqual(['Alpha', 'Mango', 'Zebra']);
  });

  it('respects limit param', () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeResult(String(i), 100 - i, `Track ${i}`)
    );
    expect(rankScoredCandidates(candidates, 3)).toHaveLength(3);
  });

  it('returns all when fewer than limit', () => {
    const candidates = [makeResult('a', 10, 'A'), makeResult('b', 20, 'B')];
    expect(rankScoredCandidates(candidates, 5)).toHaveLength(2);
  });
});


describe('half-time and double-time tempo relationships', () => {
  it('includes a 70 BPM candidate for a 140 BPM selection', () => {
    const result = rankSimilarTracks([track('half', 'Half Time', 70)], SELECTED_ID, 140);
    expect(result.map((candidate) => candidate.id)).toEqual(['half']);
  });

  it('labels and slightly discounts half-time matches', () => {
    const selected = makeTrack({ id: 'selected-140', title: 'Selected', bpm: 140 });
    const candidate = makeTrack({ id: 'candidate-70', title: 'Candidate', bpm: 70 });
    const result = scoreCandidate({ selected, candidate, bpmTolerance: 2 });
    const reason = result.reasons.find((entry) => entry.kind === 'bpm_proximity');

    expect(reason?.label).toContain('Half-time');
    expect(reason?.score).toBeGreaterThan(0);
    expect(reason?.score).toBeLessThan(SCORE_BPM_MAX);
  });

  it('labels a 140 BPM candidate as double-time for a 70 BPM selection', () => {
    const selected = makeTrack({ id: 'selected-70', title: 'Selected', bpm: 70 });
    const candidate = makeTrack({ id: 'candidate-140', title: 'Candidate', bpm: 140 });
    const result = scoreCandidate({ selected, candidate, bpmTolerance: 2 });

    expect(result.reasons.find((entry) => entry.kind === 'bpm_proximity')?.label)
      .toContain('Double-time');
  });
});
