import { describe, expect, it, vi } from 'vitest';
import type { SetLabCandidate, SetLabCandidatePool, SetLabRecommendation } from './candidateProvider';
import { generateSetLab } from './generateSet';
import { scoreSetLabTrackPair, scoreSetLabWindowPair } from './generationCompatibility';
import { listSetLabSections } from './sectionResolver';
import { grid, phrase } from './sectionResolver.testFixtures';
import { createSetLabDraft, type SetLabBarCount } from './session';
import { populatedDraft, scope } from './session.testFixtures';
import { reduceSetLabSession } from './sessionReducer';

function track(n: number, patch?: Partial<SetLabCandidate>): SetLabCandidate {
  return {
    id: `track-${n}`, import_id: scope.sourceImportId, identity: `c:${n}`, rekordbox_content_id: String(n),
    title: `Track ${n}`, artist: null, genre: null, label: null, camelot_key: '8A', bpm: 120,
    duration_seconds: 55, file_path: null, master_db_id: null, master_content_id: null, ...patch,
  };
}

function sections(bars: SetLabBarCount, type = 'drop') {
  const windows = listSetLabSections({ durationMs: 55_000, beats: grid(), phrases: [phrase(0, type, 1, 129)] }, bars);
  if (windows.ok === false) throw new Error(windows.explanation);
  return windows.windows;
}

function provider(tracks: SetLabCandidate[], { unavailable = [], pairs = [] }: {
  unavailable?: string[];
  pairs?: Array<[number, number]>;
} = {}) {
  const byId = new Map(tracks.map((candidate) => [candidate.id, candidate]));
  const recommendations = vi.fn(async (id: string) => {
    const edges = new Map<string, SetLabRecommendation>();
    for (const [a, b] of pairs) {
      if (id === `track-${a}`) edges.set(`track-${b}`, { direction: 'outgoing', rating: 5, createdAt: null });
      if (id === `track-${b}`) edges.set(`track-${a}`, { direction: 'incoming', rating: 5, createdAt: null });
    }
    return edges;
  });
  const preflight = vi.fn<SetLabCandidatePool['preflight']>(async (candidate, bars) =>
    unavailable.includes(candidate.id)
      ? { ok: false, explanation: 'No playable audio.' }
      : { ok: true, windows: sections(bars) });
  return { candidates: tracks, tracksById: byId, recommendations, preflight };
}

const blank = () => createSetLabDraft(scope);
const library = (count: number) => Array.from({ length: count }, (_, index) => track(index + 1));

describe('Set Lab generation', () => {
  it('preflights 3 → 2 → 4 → 1 → 5, returns five unique tracks and scores four transitions', async () => {
    const pool = provider([...library(7), track(8, { identity: 'c:1' })]);
    const result = await generateSetLab({ draft: blank(), seed: 'chain', pool });
    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.slots.map((slot) => slot.position)).toEqual([1, 2, 3, 4, 5]);
    expect(pool.preflight.mock.calls.map(([candidate]) => candidate.id)).toEqual(
      [3, 2, 4, 1, 5].map((position) => result.slots[position - 1].trackId),
    );
    expect(new Set(result.slots.map((slot) => slot.trackIdentityKey)).size).toBe(5);
    expect(result.slots.every((slot) => slot.barCount === 8 && slot.section.endMs > slot.section.startMs)).toBe(true);
    expect(result.slots[0].selection?.reason).toContain('Track 2');
    expect(result.slots[2].selection?.reason).toContain('anchor');
    expect(result.transitions.map(({ from }) => from)).toEqual([1, 2, 3, 4]);
  });

  it('is deterministic for a seed even when the roster arrives in another order', async () => {
    const draft = blank();
    const tracks = library(10);
    const first = await generateSetLab({ draft, seed: 'stable', pool: provider(tracks) });
    expect(first.ok).toBe(true);
    expect(await generateSetLab({ draft, seed: 'stable', pool: provider([...tracks].reverse()) })).toEqual(first);
  });

  it('retains a locked anchor and an outside-filter edge slot exactly, including their original sections', async () => {
    const original = populatedDraft();
    const state = [1, 3].reduce(
      (current, position) => reduceSetLabSession(current, { type: 'set-locked', position: position as 1 | 3, locked: true }),
      { draft: original, previous: null },
    );
    const pool = provider(library(9));
    pool.candidates = pool.candidates.filter(({ id }) => !['track-1', 'track-3'].includes(id));
    const result = await generateSetLab({ draft: state.draft, seed: 'locked', pool });
    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.slots[0]).toEqual(state.draft.slots[0]);
    expect(result.slots[2]).toEqual(state.draft.slots[2]);
    expect(pool.preflight.mock.calls.slice(0, 2).map(([item]) => item.id)).toEqual(['track-1', 'track-3']);
  });

  it('requires compatibility with both known neighbors of an interior slot', async () => {
    let state = { draft: populatedDraft(), previous: null };
    for (const position of [1, 3, 4, 5] as const) {
      state = reduceSetLabSession(state, { type: 'set-locked', position, locked: true });
    }
    const tracks = library(7).map((item) => ({ ...item, camelot_key: null, bpm: null }));
    const pool = provider(tracks, { pairs: [[3, 6], [3, 7], [7, 1], [3, 4], [4, 5]] });
    const result = await generateSetLab({ draft: state.draft, seed: 'both-neighbors', pool });
    expect(result).toMatchObject({ ok: true, slots: [expect.anything(), { trackId: 'track-7' }, expect.anything(), expect.anything(), expect.anything()] });
    expect(pool.preflight.mock.calls.some(([item]) => item.id === 'track-6')).toBe(false);
  });

  it('backtracks through sparse recommendations and recovers after failed source checks', async () => {
    const tracks = library(7).map((item) => ({ ...item, camelot_key: null, bpm: null }));
    const pool = provider(tracks, { pairs: [[3, 2], [3, 4], [2, 1], [4, 5], [3, 6], [3, 7]], unavailable: ['track-6', 'track-7'] });
    const result = await generateSetLab({ draft: blank(), seed: 'retry', pool });
    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.slots[2].trackId).toBe('track-3');
    expect(result.slots.every(({ trackId }) => trackId !== 'track-6' && trackId !== 'track-7')).toBe(true);
    expect(pool.preflight.mock.calls.length).toBeGreaterThan(5);
    expect(new Set(pool.preflight.mock.calls.map(([item]) => item.id)).size).toBe(pool.preflight.mock.calls.length);
  });

  it('tries beyond the five UI Similar Vibes entries when the strongest matches are unavailable', async () => {
    const tracks = library(12);
    const pool = provider(tracks, { unavailable: tracks.slice(0, 7).map(({ id }) => id) });
    const result = await generateSetLab({ draft: blank(), seed: 'larger-shortlist', pool });
    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.slots.map(({ trackId }) => trackId).sort()).toEqual(tracks.slice(7).map(({ id }) => id).sort());
    expect(pool.preflight.mock.calls.length).toBe(12);
  });

  it('reports caution when only a large tempo contrast can complete the chain', async () => {
    const tracks = [...library(4), track(5, { bpm: 170 })];
    const result = await generateSetLab({ draft: blank(), seed: 'relax', pool: provider(tracks) });
    expect(result).toMatchObject({ ok: true, transitions: expect.arrayContaining([{ from: expect.any(Number),
      score: expect.any(Number), caution: true, explanation: expect.stringContaining('large tempo change'),
    }]) });
  });

  it('rerolls a selected slot against its neighbors, keeps the other slots exact, and preserves its lock', async () => {
    const draft = reduceSetLabSession({ draft: populatedDraft(), previous: null }, { type: 'set-locked', position: 2, locked: true }).draft;
    const pool = provider(library(6));
    const result = await generateSetLab({ draft, reroll: 2, seed: 'reroll', pool });
    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.slots[1]).toMatchObject({ trackId: 'track-6', barCount: 8, locked: true });
    for (const index of [0, 2, 3, 4]) expect(result.slots[index]).toEqual(draft.slots[index]);
  });

  it('fails tiny, disconnected, exhausted and unavailable sets without exposing partial slots', async () => {
    const draft = populatedDraft();
    const tiny = provider(library(4));
    expect(await generateSetLab({ draft, pool: tiny, seed: 'tiny' })).toMatchObject({
      ok: false, explanation: expect.stringContaining('Fewer than five'),
    });
    expect(tiny.preflight).not.toHaveBeenCalled();

    const sparse = provider(library(5).map((item) => ({ ...item, bpm: null, camelot_key: null })));
    const disconnected = await generateSetLab({ draft, pool: sparse, seed: 'sparse' });
    expect(disconnected).toEqual({ ok: false, explanation: expect.stringContaining('compatible adjacent') });
    const unavailable = await generateSetLab({
      draft, pool: provider(library(5), { unavailable: ['track-1'] }), seed: 'unavailable',
    });
    expect(unavailable).toEqual({ ok: false, explanation: expect.stringContaining('failed the audio or section checks') });
    expect(draft).toEqual(populatedDraft());

    const capped = provider(library(10));
    expect(await generateSetLab({ draft, pool: capped, seed: 'capped', options: { maxChecks: 2 } }))
      .toMatchObject({ ok: false, explanation: expect.stringContaining('retry limit') });
    expect(capped.preflight).toHaveBeenCalledTimes(2);
  });

  it('aborts before any additional work when a media check completes after cancellation', async () => {
    const controller = new AbortController();
    const pool = provider(library(5));
    pool.preflight.mockImplementationOnce(async () => {
      controller.abort();
      return { ok: true, windows: sections(8) };
    });
    await expect(generateSetLab({ draft: blank(), seed: 'cancel', pool, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(pool.preflight).toHaveBeenCalledOnce();
    expect(pool.recommendations).not.toHaveBeenCalled();
  });

  it('scores phrase contrast separately from metadata compatibility', () => {
    const left = sections(8, 'intro')[0];
    const same = sections(8, 'intro')[0];
    const different = sections(8, 'drop')[0];
    expect(scoreSetLabTrackPair(track(1), track(2), 6)).toMatchObject({ eligible: true, severe: false });
    const matching = scoreSetLabWindowPair(left, same, false);
    const contrasting = scoreSetLabWindowPair(left, different, false);
    expect(contrasting.contrast).toBe(true);
    expect(contrasting.score).toBeLessThan(matching.score);
  });
});
