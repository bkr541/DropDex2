import {
  HOT_CUE_MAX_SLOT,
  HOT_CUE_MIN_SLOT,
  type WorkingCue,
  type WorkingCueSource,
} from '../music/cueEditorState';
import { isSupportedMemoryDjmdCueColor } from './rekordboxCueColorCodec';

export const CUE_DRAFT_SCHEMA_VERSION = 1 as const;

export interface CueDraftCue {
  importedCueId: string | null;
  rekordboxCueId: string | null;
  dedupeKey: string | null;
  family: 'hot' | 'memory';
  hotCueSlot: number | null;
  pointType: 'cue' | 'loop';
  startMs: number;
  endMs: number | null;
  colorTableIndex: number | null;
  colorHex: string | null;
  colorName: string | null;
  rekordboxColor: number | null;
  comment: string | null;
  isActiveLoop: boolean | null;
  beatLoopNumerator: number | null;
  beatLoopDenominator: number | null;
  sourceDbPresent: boolean;
  sourceAnlzPresent: boolean;
  sourceConflict: boolean;
  sourceKind: string | null;
  cueFamilyAuthority?: 'provisional' | 'anlz' | null;
  sourcePayload?: Record<string, unknown> | null;
  rekordboxKind: number | null;
  semantic: string | null;
  pairedHotCueSlot: number | null;
  strategyVersion: string | null;
  strategySettings: Record<string, unknown> | null;
  source: WorkingCueSource;
}

export interface CueDraftDocument {
  schemaVersion: typeof CUE_DRAFT_SCHEMA_VERSION;
  importId: string;
  trackId: string;
  rekordboxContentId: string;
  cues: CueDraftCue[];
}

export interface CueDraftStrategySummary {
  version: string | null;
  settings: Record<string, unknown> | null;
}

export type CueDraftValidationStatus = 'valid' | 'unresolved' | 'invalid';

export interface CueDraftValidationResult {
  status: CueDraftValidationStatus;
  error: string | null;
}

function normalizedNumber(value: number | null, field: string, required = false): number | null {
  if (value == null) {
    if (required) throw new Error(`${field} is required.`);
    return null;
  }
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite.`);
  return Math.round(value * 1000) / 1000;
}

function normalizedInteger(value: number | null, field: string): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer.`);
  return value;
}

function normalizedString(value: string | null): string | null {
  return value == null ? null : value;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function canonicalCue(cue: WorkingCue): CueDraftCue {
  const startMs = normalizedNumber(cue.startMs, 'Cue startMs', true);
  if (startMs == null || startMs < 0) throw new Error('Cue startMs must be zero or greater.');

  const endMs = normalizedNumber(cue.endMs, 'Cue endMs');
  if (cue.family === 'hot') {
    if (cue.hotCueSlot == null || cue.hotCueSlot < HOT_CUE_MIN_SLOT || cue.hotCueSlot > HOT_CUE_MAX_SLOT || !Number.isInteger(cue.hotCueSlot)) {
      throw new Error('Hot Cues must own one deterministic slot from A through H.');
    }
  } else if (cue.hotCueSlot != null) {
    throw new Error('Memory Cues cannot own a Hot Cue slot.');
  }

  if (cue.pointType === 'loop') {
    if (endMs == null || endMs <= startMs) throw new Error('Loop cues require an endMs after startMs.');
  } else {
    if (endMs != null && endMs < startMs) throw new Error('Cue endMs cannot be before startMs.');
    if (cue.isActiveLoop === true) throw new Error('Point cues cannot be active loops.');
  }

  const colorTableIndex = normalizedInteger(cue.colorTableIndex, 'colorTableIndex');
  if (colorTableIndex != null && colorTableIndex < 0) throw new Error('colorTableIndex cannot be negative.');
  const rekordboxColor = normalizedInteger(cue.rekordboxColor ?? null, 'rekordboxColor');
  if (rekordboxColor != null && !isSupportedMemoryDjmdCueColor(rekordboxColor)) {
    throw new Error('rekordboxColor must be -1 or a supported Memory Cue Color value from 1 through 7.');
  }
  const beatLoopNumerator = normalizedInteger(cue.beatLoopNumerator, 'beatLoopNumerator');
  const beatLoopDenominator = normalizedInteger(cue.beatLoopDenominator, 'beatLoopDenominator');
  if (beatLoopNumerator != null && beatLoopNumerator < 0) throw new Error('beatLoopNumerator cannot be negative.');
  if (beatLoopDenominator != null && beatLoopDenominator <= 0) throw new Error('beatLoopDenominator must be positive.');

  return {
    importedCueId: normalizedString(cue.importedCueId),
    rekordboxCueId: normalizedString(cue.rekordboxCueId),
    dedupeKey: normalizedString(cue.dedupeKey),
    family: cue.family,
    hotCueSlot: cue.hotCueSlot,
    pointType: cue.pointType,
    startMs,
    endMs,
    colorTableIndex,
    colorHex: normalizedString(cue.colorHex),
    colorName: normalizedString(cue.colorName),
    rekordboxColor,
    comment: normalizedString(cue.comment),
    isActiveLoop: cue.isActiveLoop,
    beatLoopNumerator,
    beatLoopDenominator,
    sourceDbPresent: Boolean(cue.sourceDbPresent),
    sourceAnlzPresent: Boolean(cue.sourceAnlzPresent),
    sourceConflict: Boolean(cue.sourceConflict),
    sourceKind: normalizedString(cue.sourceKind),
    cueFamilyAuthority: cue.cueFamilyAuthority === 'anlz' || cue.cueFamilyAuthority === 'provisional' ? cue.cueFamilyAuthority : null,
    sourcePayload: cue.sourcePayload == null ? null : stableValue(cue.sourcePayload) as Record<string, unknown>,
    rekordboxKind: normalizedInteger(cue.rekordboxKind, 'rekordboxKind'),
    semantic: normalizedString(cue.semantic),
    pairedHotCueSlot: normalizedInteger(cue.pairedHotCueSlot, 'pairedHotCueSlot'),
    strategyVersion: normalizedString(cue.strategyVersion),
    strategySettings: cue.strategySettings == null
      ? null
      : stableValue(cue.strategySettings) as Record<string, unknown>,
    source: cue.source,
  };
}

function cueSortKey(cue: CueDraftCue): string {
  const start = cue.startMs.toFixed(3).padStart(20, '0');
  const family = cue.family === 'hot' ? '0' : '1';
  const slot = String(cue.hotCueSlot ?? 99).padStart(2, '0');
  return `${start}:${family}:${slot}:${cue.pointType}:${cue.rekordboxCueId ?? ''}:${cue.importedCueId ?? ''}:${cue.dedupeKey ?? ''}`;
}

export function createCueDraftDocument(input: {
  importId: string;
  trackId: string;
  rekordboxContentId: string;
  cues: WorkingCue[];
}): CueDraftDocument {
  if (!input.importId) throw new Error('Cue draft importId is required.');
  if (!input.trackId) throw new Error('Cue draft trackId is required.');
  if (!input.rekordboxContentId) throw new Error('Cue draft Rekordbox ContentID is required.');

  for (const cue of input.cues) {
    if (cue.trackId !== input.trackId) throw new Error('Cue draft contains a cue owned by another track.');
    if (cue.importId != null && cue.importId !== input.importId) {
      throw new Error('Cue draft contains a cue owned by another import.');
    }
  }

  const cues = input.cues.map(canonicalCue).sort((left, right) => cueSortKey(left).localeCompare(cueSortKey(right)));
  const occupiedHotSlots = new Set<number>();
  for (const cue of cues) {
    if (cue.family !== 'hot' || cue.hotCueSlot == null) continue;
    if (occupiedHotSlots.has(cue.hotCueSlot)) {
      throw new Error(`Duplicate Hot Cue slot ${String.fromCharCode(64 + cue.hotCueSlot)}.`);
    }
    occupiedHotSlots.add(cue.hotCueSlot);
  }

  return {
    schemaVersion: CUE_DRAFT_SCHEMA_VERSION,
    importId: input.importId,
    trackId: input.trackId,
    rekordboxContentId: input.rekordboxContentId,
    cues,
  };
}

/**
 * Validate a hydrated editor baseline using the same canonical document rules
 * that guard Save and Apply. Unknown/invalid Hot Cue slot identity is reported
 * separately so the UI can keep the source visible while blocking mutation.
 */
export function validateCueDraftWorkingSet(input: {
  importId: string;
  trackId: string;
  rekordboxContentId: string;
  cues: WorkingCue[];
}): CueDraftValidationResult {
  const unresolvedHotCue = input.cues.find((cue) => cue.family === 'hot' && cue.hotCueSlot == null);
  if (unresolvedHotCue) {
    return {
      status: 'unresolved',
      error: 'Hot Cue A–H ownership is unresolved. Refresh or re-analyze cue data before editing, saving, or applying this track.',
    };
  }

  const invalidHotCue = input.cues.find((cue) => (
    cue.family === 'hot'
    && cue.hotCueSlot != null
    && (!Number.isInteger(cue.hotCueSlot)
      || cue.hotCueSlot < HOT_CUE_MIN_SLOT
      || cue.hotCueSlot > HOT_CUE_MAX_SLOT)
  ));
  if (invalidHotCue) {
    return {
      status: 'invalid',
      error: 'Hot Cue slot identity is invalid. Refresh or re-analyze cue data before editing, saving, or applying this track.',
    };
  }

  if (input.cues.some((cue) => cue.sourceConflict)) {
    return {
      status: 'invalid',
      error: 'Cue source reconciliation conflicts must be resolved before cue changes can be edited, saved, or applied.',
    };
  }

  try {
    createCueDraftDocument(input);
    return { status: 'valid', error: null };
  } catch (error) {
    return {
      status: 'invalid',
      error: error instanceof Error ? error.message : 'Cue baseline is invalid.',
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function parseCueDraftDocument(value: unknown): CueDraftDocument {
  if (!isRecord(value)) throw new Error('Saved cue draft document is malformed.');
  if (value.schemaVersion !== CUE_DRAFT_SCHEMA_VERSION) {
    throw new Error(`Unsupported cue draft schema version: ${String(value.schemaVersion)}.`);
  }
  if (typeof value.importId !== 'string' || typeof value.trackId !== 'string' || typeof value.rekordboxContentId !== 'string') {
    throw new Error('Saved cue draft identity is malformed.');
  }
  if (!Array.isArray(value.cues)) throw new Error('Saved cue draft cues are malformed.');

  const working = value.cues.map((raw, index): WorkingCue => {
    if (!isRecord(raw)) throw new Error(`Saved cue ${index + 1} is malformed.`);
    const family = raw.family;
    const pointType = raw.pointType;
    const source = raw.source;
    if (family !== 'hot' && family !== 'memory') throw new Error(`Saved cue ${index + 1} has an invalid family.`);
    if (pointType !== 'cue' && pointType !== 'loop') throw new Error(`Saved cue ${index + 1} has an invalid point type.`);
    if (source !== 'imported' && source !== 'manual' && source !== 'auto') throw new Error(`Saved cue ${index + 1} has an invalid source.`);

    return {
      editorId: `draft:${index}:${family}:${String(raw.hotCueSlot ?? 'memory')}`,
      trackId: value.trackId as string,
      importId: value.importId as string,
      importedCueId: typeof raw.importedCueId === 'string' ? raw.importedCueId : null,
      rekordboxCueId: typeof raw.rekordboxCueId === 'string' ? raw.rekordboxCueId : null,
      dedupeKey: typeof raw.dedupeKey === 'string' ? raw.dedupeKey : null,
      family,
      hotCueSlot: typeof raw.hotCueSlot === 'number' ? raw.hotCueSlot : null,
      pointType,
      startMs: typeof raw.startMs === 'number' ? raw.startMs : null,
      endMs: typeof raw.endMs === 'number' ? raw.endMs : null,
      colorTableIndex: typeof raw.colorTableIndex === 'number' ? raw.colorTableIndex : null,
      colorHex: typeof raw.colorHex === 'string' ? raw.colorHex : null,
      colorName: typeof raw.colorName === 'string' ? raw.colorName : null,
      rekordboxColor: typeof raw.rekordboxColor === 'number'
        && Number.isInteger(raw.rekordboxColor)
        && (raw.rekordboxColor === -1 || (raw.rekordboxColor >= 1 && raw.rekordboxColor <= 7))
        ? raw.rekordboxColor
        : null,
      comment: typeof raw.comment === 'string' ? raw.comment : null,
      isActiveLoop: typeof raw.isActiveLoop === 'boolean' ? raw.isActiveLoop : null,
      beatLoopNumerator: typeof raw.beatLoopNumerator === 'number' ? raw.beatLoopNumerator : null,
      beatLoopDenominator: typeof raw.beatLoopDenominator === 'number' ? raw.beatLoopDenominator : null,
      sourceDbPresent: raw.sourceDbPresent === true,
      sourceAnlzPresent: raw.sourceAnlzPresent === true,
      sourceConflict: raw.sourceConflict === true,
      sourceKind: typeof raw.sourceKind === 'string' ? raw.sourceKind : null,
      cueFamilyAuthority: raw.cueFamilyAuthority === 'anlz' || raw.cueFamilyAuthority === 'provisional' ? raw.cueFamilyAuthority : null,
      sourcePayload: isRecord(raw.sourcePayload) ? stableValue(raw.sourcePayload) as Record<string, unknown> : null,
      rekordboxKind: typeof raw.rekordboxKind === 'number' ? raw.rekordboxKind : null,
      semantic: typeof raw.semantic === 'string' ? raw.semantic : null,
      pairedHotCueSlot: typeof raw.pairedHotCueSlot === 'number' ? raw.pairedHotCueSlot : null,
      strategyVersion: typeof raw.strategyVersion === 'string' ? raw.strategyVersion : null,
      strategySettings: isRecord(raw.strategySettings) ? raw.strategySettings : null,
      source,
    };
  });

  return createCueDraftDocument({
    importId: value.importId,
    trackId: value.trackId,
    rekordboxContentId: value.rekordboxContentId,
    cues: working,
  });
}

export function hydrateCueDraftDocument(document: CueDraftDocument): WorkingCue[] {
  return document.cues.map((cue, index) => ({
    editorId: `draft:${index}:${cue.family}:${String(cue.hotCueSlot ?? 'memory')}`,
    trackId: document.trackId,
    importId: document.importId,
    importedCueId: cue.importedCueId,
    rekordboxCueId: cue.rekordboxCueId,
    dedupeKey: cue.dedupeKey,
    family: cue.family,
    hotCueSlot: cue.hotCueSlot,
    pointType: cue.pointType,
    startMs: cue.startMs,
    endMs: cue.endMs,
    colorTableIndex: cue.colorTableIndex,
    colorHex: cue.colorHex,
    colorName: cue.colorName,
    rekordboxColor: cue.rekordboxColor,
    comment: cue.comment,
    isActiveLoop: cue.isActiveLoop,
    beatLoopNumerator: cue.beatLoopNumerator,
    beatLoopDenominator: cue.beatLoopDenominator,
    sourceDbPresent: cue.sourceDbPresent,
    sourceAnlzPresent: cue.sourceAnlzPresent,
    sourceConflict: cue.sourceConflict,
    sourceKind: cue.sourceKind,
    cueFamilyAuthority: cue.cueFamilyAuthority ?? null,
    sourcePayload: cue.sourcePayload ?? null,
    rekordboxKind: cue.rekordboxKind,
    semantic: cue.semantic,
    pairedHotCueSlot: cue.pairedHotCueSlot,
    strategyVersion: cue.strategyVersion,
    strategySettings: cue.strategySettings,
    source: cue.source,
  }));
}

export async function fingerprintCueDraftDocument(document: CueDraftDocument): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(document));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function cueDraftStrategySummary(document: CueDraftDocument): CueDraftStrategySummary {
  const strategies = new Map<string, { version: string; settings: Record<string, unknown> | null }>();
  document.cues.forEach((cue) => {
    if (cue.source !== 'auto' || !cue.strategyVersion) return;
    const settingsKey = stableStringify(cue.strategySettings ?? {});
    strategies.set(`${cue.strategyVersion}:${settingsKey}`, {
      version: cue.strategyVersion,
      settings: cue.strategySettings,
    });
  });
  const values = [...strategies.values()].sort((left, right) => {
    const version = left.version.localeCompare(right.version);
    return version !== 0 ? version : stableStringify(left.settings).localeCompare(stableStringify(right.settings));
  });
  if (values.length === 0) return { version: null, settings: null };
  if (values.length === 1) return values[0];
  return {
    version: 'multiple',
    settings: { strategies: values },
  };
}
