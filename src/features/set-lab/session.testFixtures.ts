import {
  createSetLabDraft, DEFAULT_SET_LAB_BAR_COUNT, parseSetLabSession,
  type SetLabDraft, type SetLabFiveSlots, type SetLabPosition, type SetLabSlot,
} from './session';

export const scope = { userId: 'user-1', sourceImportId: 'import-1' };
export const section = {
  startMs: 0, endMs: 16_000, startBeat: 1, endBeatExclusive: 33, phraseType: 'Drop', phraseOccurrence: 2,
};
export function slot<P extends SetLabPosition>(position: P): SetLabSlot<P> {
  return {
    position, trackId: `track-${position}`, trackIdentityKey: `c:${position}`,
    section, barCount: DEFAULT_SET_LAB_BAR_COUNT, manuallyPositioned: false, locked: false,
  };
}
export const fiveSlots: SetLabFiveSlots = [slot(1), slot(2), slot(3), slot(4), slot(5)];

export function populatedDraft(): SetLabDraft {
  const draft = parseSetLabSession({
    ...createSetLabDraft(scope), generationSeed: 'seed-1', selectedSlot: 3, slots: fiveSlots,
  }, scope);
  if (draft.status !== 'draft') throw new Error('Invalid fixture.');
  return draft;
}
