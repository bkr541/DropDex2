import { describe, expect, it } from 'vitest';
import { createSetLabDraft, parseSetLabSession } from './session';
import { fiveSlots, populatedDraft, scope, section } from './session.testFixtures';

describe('Set Lab document validation', () => {
  it('round trips empty drafts, populated drafts and named sets', () => {
    const empty = createSetLabDraft(scope);
    const draft = populatedDraft();
    expect(parseSetLabSession(JSON.parse(JSON.stringify(empty)), scope)).toEqual(empty);
    expect(parseSetLabSession(JSON.parse(JSON.stringify(draft)), scope)).toEqual(draft);
    expect(parseSetLabSession({ ...draft, status: 'saved', name: '   Studio Mix  ' }, scope))
      .toEqual({ ...draft, status: 'saved', name: 'Studio Mix' });
    expect(() => parseSetLabSession({ ...empty, status: 'saved', name: 'Empty' }, scope)).toThrow();
  });

  it.each([
    { schemaVersion: 2 },
    { userId: 'someone-else' },
    { sourceImportId: 'different-import' },
    { slots: fiveSlots.slice(1) },
    { slots: [fiveSlots[1], fiveSlots[0], ...fiveSlots.slice(2)] },
    { slots: [{ ...fiveSlots[0], trackId: fiveSlots[1].trackId }, ...fiveSlots.slice(1)] },
    { slots: [{ ...fiveSlots[0], trackIdentityKey: fiveSlots[1].trackIdentityKey }, ...fiveSlots.slice(1)] },
    { slots: [{ ...fiveSlots[0], barCount: 12 }, ...fiveSlots.slice(1)] },
    { slots: [{ ...fiveSlots[0], locked: 'false' }, ...fiveSlots.slice(1)] },
    { slots: [{ ...fiveSlots[0], section: { ...section, startBeat: 0 } }, ...fiveSlots.slice(1)] },
    { slots: [{ ...fiveSlots[0], section: { ...section, endBeatExclusive: 1 } }, ...fiveSlots.slice(1)] },
    { slots: [{ ...fiveSlots[0], section: { ...section, endMs: Infinity } }, ...fiveSlots.slice(1)] },
    { slots: [{ ...fiveSlots[0], section: { ...section, phraseType: null } }, ...fiveSlots.slice(1)] },
    { slots: [] },
    { selectedSlot: 0 },
    { generationSeed: '' },
    { filters: { search: '', genres: [], minBpm: 130, maxBpm: 100 } },
    { settings: {} },
  ])('rejects an invalid document patch %j', (patch) => {
    expect(() => parseSetLabSession({ ...populatedDraft(), ...patch }, scope)).toThrow();
  });

  it('copies the validated slot and section instead of retaining mutable action data', () => {
    const source = { ...fiveSlots[0], section: { ...section } };
    const parsed = parseSetLabSession({ ...populatedDraft(), slots: [source, ...fiveSlots.slice(1)] }, scope);
    source.section.startMs = 400;
    expect(parsed.slots[0]?.section.startMs).toBe(section.startMs);
  });
});
