import { sameSetLabWindow } from './sectionResolver';
import {
  createSetLabDraft, parseSetLabSession, SET_LAB_POSITIONS,
  type SetLabBarCount, type SetLabDraft, type SetLabFilters, type SetLabFiveSlots,
  type SetLabPosition, type SetLabSection, type SetLabSettings, type SetLabSlot, type SetLabTransition,
} from './session';

export interface SetLabState {
  readonly draft: SetLabDraft;
  /** Undo is transient and is cleared when a draft is restored. */
  readonly previous: SetLabDraft | null;
  readonly canUndoSwap?: boolean;
  readonly canUndoReposition?: boolean;
}

export type SetLabAction =
  | {
      type: 'generate-commit';
      slots: SetLabFiveSlots;
      seed: string;
      base?: SetLabDraft;
      filters?: SetLabFilters;
      transitions?: readonly SetLabTransition[];
      reroll?: SetLabPosition;
    }
  | { type: 'select'; position: SetLabPosition }
  | { type: 'set-locked'; position: SetLabPosition; locked: boolean }
  | {
      type: 'replace';
      position: SetLabPosition;
      track: Omit<SetLabSlot, 'position' | 'locked' | 'barCount'>;
      base?: SetLabDraft;
      transitions?: readonly SetLabTransition[];
    }
  | { type: 'reposition'; position: SetLabPosition; section: SetLabSection; base?: SetLabDraft; selection?: SetLabSlot['selection'] }
  | { type: 'set-bar-count'; position: SetLabPosition; barCount: SetLabBarCount; section: SetLabSection; base?: SetLabDraft }
  | { type: 'set-options'; filters: SetLabFilters; settings: SetLabSettings }
  | { type: 'restore'; draft: unknown }
  | { type: 'load-saved'; base: SetLabDraft; draft: SetLabDraft }
  | { type: 'reset' }
  | { type: 'undo'; swapOnly?: boolean; repositionOnly?: boolean };

function validateDraft(value: unknown, current: SetLabDraft): SetLabDraft {
  const draft = parseSetLabSession(value, { userId: current.userId, sourceImportId: current.sourceImportId });
  if (draft.status !== 'draft') throw new Error('A saved set must be copied into a draft before editing.');
  return draft;
}

/** A rejected action throws before committing anything. Callers can surface the error and keep the current state. */
export function reduceSetLabSession(state: SetLabState, action: SetLabAction): SetLabState {
  const { draft, previous } = state;
  const commit = (candidate: unknown, undoable = true): SetLabState => ({
    draft: validateDraft(candidate, draft),
    previous: undoable ? draft : previous,
    ...(!undoable && state.canUndoSwap ? { canUndoSwap: true } : {}),
    ...(!undoable && state.canUndoReposition ? { canUndoReposition: true } : {}),
  });

  switch (action.type) {
    case 'load-saved':
      if (draft !== action.base) throw new Error('The working draft changed during load. Open the saved set again.');
      if (!action.draft.loadedFrom || action.draft.slots.length !== 5) throw new Error('Expected a complete saved working copy.');
      return { draft: validateDraft(action.draft, draft), previous: null };
    case 'restore':
      return { draft: validateDraft(action.draft, draft), previous: null };
    case 'undo':
      if (!previous || (action.swapOnly && !state.canUndoSwap) || (action.repositionOnly && !state.canUndoReposition)) return state;
      return {
        draft: state.canUndoSwap || state.canUndoReposition ? validateDraft({ ...previous, selectedSlot: draft.selectedSlot, filters: draft.filters, settings: draft.settings }, draft) : previous,
        previous: null,
      };
    case 'reset':
      return commit(createSetLabDraft({ userId: draft.userId, sourceImportId: draft.sourceImportId }));
    case 'set-options':
      return commit({ ...draft, filters: action.filters, settings: action.settings }, false);
    case 'generate-commit': {
      if (action.base && draft !== action.base) throw new Error('The Set Lab draft changed during generation. Try again.');
      if (action.reroll !== undefined && (!SET_LAB_POSITIONS.includes(action.reroll) || draft.slots.length === 0)) {
        throw new Error('The reroll slot is unavailable.');
      }
      const next = validateDraft({
        ...draft,
        slots: action.slots,
        generationSeed: action.seed,
        filters: action.filters ?? draft.filters,
        transitions: action.transitions,
        selectedSlot: action.reroll ?? draft.selectedSlot ?? 3,
      }, draft);
      for (const slot of draft.slots) {
        const replacement = next.slots[slot.position - 1];
        if (action.reroll === slot.position) {
          if (!replacement || replacement.trackIdentityKey === slot.trackIdentityKey
            || replacement.locked !== slot.locked || replacement.barCount !== slot.barCount) {
            throw new Error('Reroll must change only the selected track and preserve its bar count and lock.');
          }
        } else if ((action.reroll !== undefined || slot.locked) && JSON.stringify(slot) !== JSON.stringify(replacement)) {
          throw new Error(`Generation changed ${slot.locked ? 'locked' : 'fixed'} slot ${slot.position}.`);
        }
      }
      return { draft: next, previous: draft };
    }
    default: {
      if (!SET_LAB_POSITIONS.includes(action.position) || draft.slots.length === 0) {
        throw new Error('The Set Lab slot is unavailable.');
      }
      const index = action.position - 1;
      const slot = draft.slots[index];
      if (action.type === 'select') {
        return draft.selectedSlot === action.position ? state : commit({ ...draft, selectedSlot: action.position }, false);
      }
      const slots = [...draft.slots];
      switch (action.type) {
        case 'set-locked':
          if (slot.locked === action.locked) return state;
          slots[index] = { ...slot, locked: action.locked };
          break;
        case 'replace': {
          if (action.base && (draft.userId !== action.base.userId || draft.sourceImportId !== action.base.sourceImportId
            || draft.selectedSlot !== action.position || draft.generationSeed !== action.base.generationSeed
            || JSON.stringify(draft.slots) !== JSON.stringify(action.base.slots))) {
            throw new Error('The target slot changed during swap preparation. Try again.');
          }
          if (draft.slots.some((item) => item.trackId === action.track.trackId || item.trackIdentityKey === action.track.trackIdentityKey)) {
            throw new Error('This track already occupies a Set Lab slot.');
          }
          slots[index] = { ...action.track, position: slot.position, locked: slot.locked, barCount: slot.barCount };
          return { ...commit({ ...draft, slots, transitions: action.transitions }), canUndoSwap: true };
        }
        case 'reposition':
          if (action.base && (draft.userId !== action.base.userId || draft.sourceImportId !== action.base.sourceImportId
            || draft.generationSeed !== action.base.generationSeed
            || JSON.stringify(draft.slots) !== JSON.stringify(action.base.slots))) {
            throw new Error('The set changed during repositioning. Reopen the editor and try again.');
          }
          if (sameSetLabWindow(slot.section, action.section)) return state;
          slots[index] = {
            ...slot, section: action.section, manuallyPositioned: true,
            selection: action.selection ?? slot.selection,
          };
          return { ...commit({ ...draft, slots, transitions: undefined }), canUndoReposition: true };
        case 'set-bar-count':
          if (action.base && (draft.userId !== action.base.userId || draft.sourceImportId !== action.base.sourceImportId
            || draft.generationSeed !== action.base.generationSeed
            || JSON.stringify(slot) !== JSON.stringify(action.base.slots[index]))) {
            throw new Error('The Set Lab draft changed during section validation. Try again.');
          }
          slots[index] = {
            ...slot, section: action.section, barCount: action.barCount,
            selection: slot.selection ? {
              ...slot.selection,
              reason: action.section.startMs === slot.section.startMs
                ? 'Section length updated on the Rekordbox beat grid.'
                : 'Section length updated and snapped to the nearest playable downbeat.',
            } : undefined,
          };
          break;
      }
      return commit({
        ...draft, slots, transitions: action.type === 'set-locked' ? draft.transitions : undefined,
      });
    }
  }
}
