import { describe, expect, it } from 'vitest';
import {
  BPM_TOLERANCE_DEFAULT,
  hasSimilarVibesSignal,
  rankSimilarTracks,
  shouldUseBpm,
} from './similarVibes';

interface T { id: string; title: string; bpm: number | null; }
const track = (id: string, title: string, bpm: number | null): T => ({ id, title, bpm });
const SELECTED_ID = 'selected';

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

// ── rankSimilarTracks ─────────────────────────────────────────────────────────

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
