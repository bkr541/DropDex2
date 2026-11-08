import { describe, expect, it } from 'vitest';
import { createSetLabDraft } from './session';
import { fiveSlots, populatedDraft, scope, section } from './session.testFixtures';
import { reduceSetLabSession as reduce, type SetLabState } from './sessionReducer';

const emptyState = (): SetLabState => ({ draft: createSetLabDraft(scope), previous: null });
const populatedState = (): SetLabState => ({ draft: populatedDraft(), previous: null });
const movedSection = { ...section, startMs: 1000, endMs: 17000, startBeat: 5, endBeatExclusive: 37 };

describe('Set Lab session reducer', () => {
  it('commits generation atomically, defaults to slot three and supports Undo', () => {
    const state = emptyState();
    const generated = reduce(state, { type: 'generate-commit', slots: fiveSlots, seed: 'new-seed' });
    expect(generated.draft).toMatchObject({ selectedSlot: 3, generationSeed: 'new-seed', slots: fiveSlots });
    expect(reduce(generated, { type: 'undo' })).toEqual(state);
    expect(() => reduce(state, { type: 'generate-commit', slots: fiveSlots, seed: '' })).toThrow();
    expect(state.draft.slots).toEqual([]);
  });

  it('commits the seed, filter snapshot, selection and four transitions together and rejects a stale result', () => {
    const state = emptyState();
    const filters = { ...state.draft.filters, genres: ['House'], minBpm: 120 };
    const slots = [
      { ...fiveSlots[0], selection: { title: 'First', reason: 'Verified cue.' } },
      fiveSlots[1], fiveSlots[2], fiveSlots[3], fiveSlots[4],
    ] as const;
    const transitions = ([1, 2, 3, 4] as const).map((from) => ({ from, score: 32, caution: false, explanation: 'Compatible BPM' }));
    const action = { type: 'generate-commit', seed: 'snapshot', base: state.draft, slots, filters, transitions } as const;
    const result = reduce(state, action);
    expect(result.draft).toMatchObject({ generationSeed: 'snapshot', filters, slots, transitions });
    expect(reduce(result, { type: 'undo' })).toEqual(state);
    expect(() => reduce(state, { ...action, transitions: transitions.slice(1) })).toThrow('four ordered transitions');
    expect(() => reduce(result, action)).toThrow('draft changed');
    expect(state.draft.slots).toEqual([]);
  });

  it('enforces an atomic reroll and retains its lock and bar count', () => {
    const state = reduce(populatedState(), { type: 'set-locked', position: 1, locked: true });
    const slots = [
      { ...fiveSlots[0], locked: true, trackId: 'replacement', trackIdentityKey: 'c:new' },
      fiveSlots[1], fiveSlots[2], fiveSlots[3], fiveSlots[4],
    ] as const;
    const action = { type: 'generate-commit', base: state.draft, seed: 'reroll', slots, reroll: 1 } as const;
    expect(reduce(state, action).draft).toMatchObject({ selectedSlot: 1, slots });
    expect(() => reduce(state, { ...action, slots: [slots[0], { ...slots[1], locked: true }, slots[2], slots[3], slots[4]] }))
      .toThrow('fixed slot 2');
    expect(() => reduce(state, { ...action, slots: [{ ...slots[0], barCount: 4 }, slots[1], slots[2], slots[3], slots[4]] }))
      .toThrow('preserve its bar count');
  });

  it('preserves the full locked selection during regeneration', () => {
    const locked = reduce(populatedState(), { type: 'set-locked', position: 1, locked: true });
    const slots = [
      { ...fiveSlots[0], locked: true }, { ...fiveSlots[1], trackId: 'new', trackIdentityKey: 'c:new' },
      fiveSlots[2], fiveSlots[3], fiveSlots[4],
    ] as const;
    expect(reduce(locked, { type: 'generate-commit', slots, seed: 'seed-2' }).draft.slots).toEqual(slots);
    for (const changed of [{ locked: false }, { trackId: 'other' }, { section: movedSection }, { barCount: 4 } ] as const) {
      expect(() => reduce(locked, {
        type: 'generate-commit', slots: [{ ...slots[0], ...changed }, slots[1], slots[2], slots[3], slots[4]], seed: 'seed-3',
      })).toThrow('locked slot 1');
    }
    expect(locked.draft.slots[0]).toEqual({ ...fiveSlots[0], locked: true });
    expect(reduce(locked, { type: 'set-locked', position: 1, locked: false }).draft.slots[0]?.locked).toBe(false);
  });

  it('lets a manual replacement keep its slot, bars and lock, and rejects a duplicate', () => {
    const locked = reduce(populatedState(), { type: 'set-locked', position: 1, locked: true });
    const track = { trackId: 'replacement', trackIdentityKey: 'c:new', section: movedSection, manuallyPositioned: false };
    const next = reduce(locked, { type: 'replace', position: 1, track });
    expect(next.draft.slots[0]).toEqual({ ...fiveSlots[0], ...track, locked: true });
    expect(reduce(next, { type: 'undo' }).draft).toEqual(locked.draft);
    expect(() => reduce(locked, { type: 'replace', position: 1, track: fiveSlots[1] })).toThrow();
  });

  it('repositions and changes bars atomically using the supplied resolved window', () => {
    const moved = reduce(populatedState(), { type: 'reposition', position: 4, section: movedSection });
    expect(moved.draft.slots[3]).toEqual({ ...fiveSlots[3], section: movedSection, manuallyPositioned: true });
    const shortened = { ...movedSection, endMs: 9000, endBeatExclusive: 21 };
    expect(reduce(moved, { type: 'set-bar-count', position: 4, barCount: 4, section: shortened }).draft.slots[3])
      .toEqual({ ...fiveSlots[3], barCount: 4, section: shortened, manuallyPositioned: true });
    expect(() => reduce(moved, {
      type: 'set-bar-count', position: 4, barCount: 4, section: { ...shortened, endMs: 0 },
    })).toThrow();
  });

  it('guards bar changes against stale drafts and updates their selection evidence', () => {
    const original = populatedState();
    const slots = [
      { ...fiveSlots[0], selection: { title: 'First', reason: 'Generated section.' } },
      fiveSlots[1], fiveSlots[2], fiveSlots[3], fiveSlots[4],
    ] as const;
    const transitions = ([1, 2, 3, 4] as const).map((from) => ({ from, score: 1, caution: false, explanation: 'Test fit' }));
    const state = reduce(original, { type: 'generate-commit', slots, seed: 'new', transitions });
    const action = { type: 'set-bar-count', position: 1, barCount: 4, section: movedSection, base: state.draft } as const;
    expect(() => reduce(original, action)).toThrow('draft changed');
    const result = reduce(state, action);
    expect(result.draft.slots[0]?.selection?.reason).toContain('nearest playable downbeat');
    expect(result.draft.transitions).toBeUndefined();
    expect(result.draft.slots.slice(1)).toEqual(state.draft.slots.slice(1));
  });

  it('selects slots and updates options without creating an Undo entry', () => {
    const state = populatedState();
    const selected = reduce(state, { type: 'select', position: 5 });
    const settings = { similarOnly: true };
    const filters = { ...state.draft.filters, search: 'night' };
    const next = reduce(selected, { type: 'set-options', settings, filters });
    expect(next.draft).toMatchObject({ selectedSlot: 5, settings, filters });
    expect(reduce(next, { type: 'undo' })).toBe(next);
    expect(() => reduce(emptyState(), { type: 'select', position: 1 })).toThrow();
  });

  it('resets, undoes a reset, and restores within the same scope with fresh history', () => {
    const state = populatedState();
    const reset = reduce(state, { type: 'reset' });
    expect(reset.draft).toEqual(createSetLabDraft(scope));
    expect(reduce(reset, { type: 'undo' })).toEqual(state);
    expect(reduce(reset, { type: 'restore', draft: state.draft })).toEqual(state);
    expect(() => reduce(reset, { type: 'restore', draft: { ...state.draft, userId: 'wrong-user' } })).toThrow();
    expect(() => reduce(reset, { type: 'restore', draft: { ...state.draft, status: 'saved', name: 'Other' } })).toThrow();
  });
});
