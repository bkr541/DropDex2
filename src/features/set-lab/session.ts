export const SET_LAB_SCHEMA_VERSION = 1;
export const SET_LAB_POSITIONS = [1, 2, 3, 4, 5] as const;
export const DEFAULT_SET_LAB_BAR_COUNT = 8;

export type SetLabPosition = typeof SET_LAB_POSITIONS[number];
export type SetLabBarCount = 4 | 8 | 16;

export interface SetLabScope {
  readonly userId: string;
  readonly sourceImportId: string;
}

export interface SetLabSection {
  readonly startMs: number;
  readonly endMs: number;
  /** One-based Rekordbox beat sequence, with an exclusive end. */
  readonly startBeat: number;
  readonly endBeatExclusive: number;
  readonly phraseType: string | null;
  readonly phraseOccurrence: number | null;
}

export interface SetLabRecordingEvidence {
  readonly title: string;
  readonly artist: string;
  readonly durationMs: number;
}

export interface SetLabSlot<P extends SetLabPosition = SetLabPosition> {
  readonly position: P;
  readonly trackId: string;
  readonly trackIdentityKey: string;
  readonly section: SetLabSection;
  readonly barCount: SetLabBarCount;
  readonly manuallyPositioned: boolean;
  readonly locked: boolean;
  readonly recording?: SetLabRecordingEvidence;
  readonly selection?: { readonly title: string; readonly reason: string };
}

export interface SetLabTransition {
  readonly from: 1 | 2 | 3 | 4;
  readonly score: number;
  readonly caution: boolean;
  readonly explanation: string;
}

export type SetLabFiveSlots = readonly [
  SetLabSlot<1>, SetLabSlot<2>, SetLabSlot<3>, SetLabSlot<4>, SetLabSlot<5>,
];

export interface SetLabFilters {
  readonly search: string;
  readonly genres: readonly string[];
  readonly minBpm: number | null;
  readonly maxBpm: number | null;
}

export interface SetLabSettings {
  readonly similarOnly: boolean;
}

interface SetLabDocument extends SetLabScope {
  readonly schemaVersion: typeof SET_LAB_SCHEMA_VERSION;
  readonly filters: SetLabFilters;
  readonly settings: SetLabSettings;
}

interface SetLabArrangement {
  readonly slots: SetLabFiveSlots;
  readonly generationSeed: string;
  readonly selectedSlot: SetLabPosition;
  readonly transitions?: readonly SetLabTransition[];
}

export type SetLabDraft = SetLabDocument & { readonly status: 'draft'; readonly loadedFrom?: { readonly id: string; readonly name: string } } & (
  SetLabArrangement | { readonly slots: readonly []; readonly generationSeed: null; readonly selectedSlot: null; readonly transitions?: never }
);
export type SetLabSavedSet = SetLabDocument & SetLabArrangement & {
  readonly status: 'saved';
  readonly name: string;
};
export type SetLabSession = SetLabDraft | SetLabSavedSet;

export function createSetLabDraft(scope: SetLabScope): SetLabDraft {
  return {
    userId: scope.userId,
    sourceImportId: scope.sourceImportId,
    schemaVersion: SET_LAB_SCHEMA_VERSION,
    status: 'draft',
    slots: [],
    selectedSlot: null,
    generationSeed: null,
    filters: { search: '', genres: [], minBpm: null, maxBpm: null },
    settings: { similarOnly: false },
  };
}

const record = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);
const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const validBpm = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0);

function isSection(value: unknown): value is SetLabSection {
  return record(value)
    && typeof value.startMs === 'number' && Number.isFinite(value.startMs) && value.startMs >= 0
    && typeof value.endMs === 'number' && Number.isFinite(value.endMs) && value.endMs > value.startMs
    && positiveInteger(value.startBeat) && positiveInteger(value.endBeatExclusive)
    && value.endBeatExclusive > value.startBeat
    && (value.phraseType === null || nonblank(value.phraseType))
    && (value.phraseOccurrence === null || (nonblank(value.phraseType) && positiveInteger(value.phraseOccurrence)));
}

function isFiveSlots(slots: readonly unknown[]): slots is SetLabFiveSlots {
  if (slots.length !== SET_LAB_POSITIONS.length) return false;
  const trackIds = new Set<string>();
  const identities = new Set<string>();
  for (const position of SET_LAB_POSITIONS) {
    const slot = slots[position - 1];
    if (!record(slot) || slot.position !== position
      || !nonblank(slot.trackId) || trackIds.has(slot.trackId)
      || !nonblank(slot.trackIdentityKey) || identities.has(slot.trackIdentityKey)
      || !isSection(slot.section) || ![4, 8, 16].includes(slot.barCount as number)
      || typeof slot.locked !== 'boolean' || typeof slot.manuallyPositioned !== 'boolean'
      || (slot.recording !== undefined && (!record(slot.recording) || !nonblank(slot.recording.title)
        || typeof slot.recording.artist !== 'string' || !validBpm(slot.recording.durationMs) || slot.recording.durationMs === null))
      || (slot.selection !== undefined && (!record(slot.selection)
        || !nonblank(slot.selection.title) || !nonblank(slot.selection.reason)))) return false;
    trackIds.add(slot.trackId);
    identities.add(slot.trackIdentityKey);
  }
  return true;
}

/** Validate untrusted documents before restoring or storing them. Grid and media checks belong to the resolver. */
export function parseSetLabSession(value: unknown, scope: SetLabScope): SetLabSession {
  if (!record(value) || value.schemaVersion !== SET_LAB_SCHEMA_VERSION) {
    throw new Error('Unsupported Set Lab session schema.');
  }
  if (!nonblank(value.userId) || !nonblank(value.sourceImportId)
    || value.userId !== scope.userId || value.sourceImportId !== scope.sourceImportId) {
    throw new Error('Set Lab session belongs to a different account or library.');
  }
  const { filters, settings, slots, status, selectedSlot, generationSeed, transitions } = value;
  if (!record(filters) || typeof filters.search !== 'string' || !Array.isArray(filters.genres)
    || !Array.from(filters.genres).every(nonblank) || !validBpm(filters.minBpm) || !validBpm(filters.maxBpm)
    || (filters.minBpm != null && filters.maxBpm != null && filters.minBpm > filters.maxBpm)
    || !record(settings) || typeof settings.similarOnly !== 'boolean' || !Array.isArray(slots)
    || (status !== 'draft' && (status !== 'saved' || !nonblank(value.name)))) {
    throw new Error('Invalid Set Lab session settings.');
  }

  const { loadedFrom } = value;
  if (status === 'draft' && loadedFrom !== undefined
    && (!record(loadedFrom) || !nonblank(loadedFrom.id) || !nonblank(loadedFrom.name) || slots.length !== 5)) {
    throw new Error('Invalid Set Lab working copy reference.');
  }

  const document: SetLabDocument = {
    userId: scope.userId,
    sourceImportId: scope.sourceImportId,
    schemaVersion: SET_LAB_SCHEMA_VERSION,
    filters: {
      search: filters.search,
      genres: [...filters.genres],
      minBpm: filters.minBpm,
      maxBpm: filters.maxBpm,
    },
    settings: { similarOnly: settings.similarOnly },
  };
  if (slots.length === 0 && status === 'draft' && selectedSlot === null && generationSeed === null && transitions === undefined) {
    return { ...document, status, slots: [], selectedSlot: null, generationSeed: null };
  }
  if (!isFiveSlots(slots) || !SET_LAB_POSITIONS.includes(selectedSlot as SetLabPosition) || !nonblank(generationSeed)) {
    throw new Error('A populated Set Lab session requires five ordered, unique tracks with valid sections.');
  }
  const copySlot = <P extends SetLabPosition>(slot: SetLabSlot<P>): SetLabSlot<P> => ({
    position: slot.position,
    trackId: slot.trackId,
    trackIdentityKey: slot.trackIdentityKey,
    barCount: slot.barCount,
    manuallyPositioned: slot.manuallyPositioned,
    locked: slot.locked,
    ...(slot.recording && { recording: {
      title: slot.recording.title, artist: slot.recording.artist, durationMs: slot.recording.durationMs,
    } }),
    ...(slot.selection && { selection: { title: slot.selection.title, reason: slot.selection.reason } }),
    section: {
      startMs: slot.section.startMs,
      endMs: slot.section.endMs,
      startBeat: slot.section.startBeat,
      endBeatExclusive: slot.section.endBeatExclusive,
      phraseType: slot.section.phraseType,
      phraseOccurrence: slot.section.phraseOccurrence,
    },
  });
  let checkedTransitions: SetLabTransition[] | undefined;
  if (transitions !== undefined) {
    if (!Array.isArray(transitions) || transitions.length !== 4) {
      throw new Error('Set Lab generation requires four ordered transitions.');
    }
    checkedTransitions = Array.from(transitions, (entry, index) => {
      if (!record(entry) || entry.from !== index + 1 || typeof entry.score !== 'number'
        || !Number.isFinite(entry.score) || typeof entry.caution !== 'boolean' || !nonblank(entry.explanation)) {
        throw new Error('Invalid Set Lab transition.');
      }
      return { from: entry.from as SetLabTransition['from'], score: entry.score, caution: entry.caution, explanation: entry.explanation };
    });
  }
  const [first, second, third, fourth, fifth] = slots;
  const arrangement: SetLabArrangement = {
    slots: [copySlot(first), copySlot(second), copySlot(third), copySlot(fourth), copySlot(fifth)],
    selectedSlot: selectedSlot as SetLabPosition,
    generationSeed,
    ...(checkedTransitions && { transitions: checkedTransitions }),
  };
  return status === 'draft'
    ? { ...document, ...arrangement, status,
      ...(record(loadedFrom) && { loadedFrom: { id: loadedFrom.id as string, name: loadedFrom.name as string } }) }
    : { ...document, ...arrangement, status, name: (value.name as string).trim() };
}
