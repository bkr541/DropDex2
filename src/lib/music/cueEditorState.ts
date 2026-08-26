import { beatByBarOffset, isUsableBeatGrid, nearestBeat, type BeatEntry } from './beatGridHelpers';
import type { CueRow } from '../queries/analysisData';
import {
  isSupportedMemoryDjmdCueColor,
  memoryDjmdCueColorFromImportedDisplayEvidence,
} from '../cues/rekordboxCueColorCodec';

export type WorkingCueSource = 'imported' | 'manual' | 'auto';

/**
 * Canonical, runtime-only cue shape owned by the Cue Points editor.
 *
 * It intentionally does not reuse the Supabase row as mutable UI state. The
 * imported identifiers and round-trip fields are retained so later stages can
 * persist/export without reconstructing source metadata, but Stage 2 never
 * writes this model anywhere.
 */
export interface WorkingCue {
  editorId: string;
  trackId: string;
  importId: string | null;
  importedCueId: string | null;
  rekordboxCueId: string | null;
  dedupeKey: string | null;
  family: 'hot' | 'memory';
  hotCueSlot: number | null;
  pointType: 'cue' | 'loop';
  startMs: number | null;
  endMs: number | null;
  colorTableIndex: number | null;
  colorHex: string | null;
  colorName: string | null;
  /** Canonical writer-facing DjmdCue.Color value for Memory Cue round-trip fidelity. */
  rekordboxColor?: number | null;
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

export interface CueEditResult {
  cues: WorkingCue[];
  beat: BeatEntry | null;
  error: string | null;
}

export type CueTimingMode = 'snap' | 'exact';

export type CueEditAction =
  | { kind: 'family'; family: 'hot' | 'memory'; hotCueSlot?: number }
  | { kind: 'hot-slot'; hotCueSlot: number }
  | { kind: 'point-type'; pointType: 'cue' | 'loop' }
  | { kind: 'end-ms'; requestedMs: number; timingMode: CueTimingMode }
  | { kind: 'loop-length-ms'; requestedMs: number; timingMode: CueTimingMode }
  | { kind: 'comment'; comment: string | null }
  | { kind: 'hot-color-table'; colorTableIndex: number | null }
  | { kind: 'memory-color'; rekordboxColor: number; colorHex: string | null; colorName: string | null }
  | { kind: 'active-loop'; isActiveLoop: boolean };

export const DEFAULT_LOOP_BEATS = 16;

const HOT_REKORDBOX_KIND_BY_SLOT: Readonly<Record<number, number>> = Object.freeze({
  1: 1,
  2: 2,
  3: 3,
  4: 5,
  5: 6,
  6: 7,
  7: 8,
  8: 9,
});

export const HOT_CUE_MIN_SLOT = 1;
export const HOT_CUE_MAX_SLOT = 8;

export type HotCueSlotOwnershipStatus = 'valid' | 'unresolved' | 'invalid';

export interface HotCueSlotOwnership {
  status: HotCueSlotOwnershipStatus;
  occupiedSlots: number[];
  error: string | null;
}

export function hotCueSlotLabel(slot: number | null): string {
  return slot != null
    && Number.isInteger(slot)
    && slot >= HOT_CUE_MIN_SLOT
    && slot <= HOT_CUE_MAX_SLOT
    ? String.fromCharCode(64 + slot)
    : '?';
}

export function inspectHotCueSlotOwnership(cues: WorkingCue[]): HotCueSlotOwnership {
  const occupied = new Set<number>();
  for (const cue of cues) {
    if (cue.family !== 'hot') continue;
    const slot = cue.hotCueSlot;
    if (slot == null) {
      return {
        status: 'unresolved',
        occupiedSlots: [...occupied].sort((left, right) => left - right),
        error: 'Hot Cue ownership is unresolved. Refresh or re-analyze cue data before editing Hot Cues.',
      };
    }
    if (!Number.isInteger(slot) || slot < HOT_CUE_MIN_SLOT || slot > HOT_CUE_MAX_SLOT) {
      return {
        status: 'invalid',
        occupiedSlots: [...occupied].sort((left, right) => left - right),
        error: 'Hot Cue slot identity is invalid. Refresh or re-analyze cue data before editing Hot Cues.',
      };
    }
    if (occupied.has(slot)) {
      return {
        status: 'invalid',
        occupiedSlots: [...occupied].sort((left, right) => left - right),
        error: `Duplicate Hot Cue slot ${hotCueSlotLabel(slot)} prevents safe cue editing.`,
      };
    }
    occupied.add(slot);
  }
  return {
    status: 'valid',
    occupiedSlots: [...occupied].sort((left, right) => left - right),
    error: null,
  };
}

export function isCurrentTrackResponse(activeTrackId: string | null, requestedTrackId: string): boolean {
  return activeTrackId === requestedTrackId;
}

function finiteOrNull(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function stableMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableMetadataValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableMetadataValue(nested)]),
    );
  }
  return value;
}

function stableMetadataRecord(value: Record<string, unknown> | null): Record<string, unknown> | null {
  return value == null ? null : stableMetadataValue(value) as Record<string, unknown>;
}

function importedMemoryRekordboxColor(row: CueRow): number | null {
  // PCO2 RGB/name can seed a supported desired Memory color for editing, but
  // no PCO2/color-table integer is ever interpreted as local DjmdCue.Color.
  // Imported-local safety fingerprinting independently requires raw DB proof.
  return memoryDjmdCueColorFromImportedDisplayEvidence({
    colorHex: row.color_hex,
    colorName: row.color_name,
  });
}

function exactMilliseconds(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function validHotSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= HOT_CUE_MIN_SLOT && slot <= HOT_CUE_MAX_SLOT;
}

function exactBeatAtMs(beats: BeatEntry[], ms: number): BeatEntry | null {
  return beats.find((beat) => Math.abs(beat.ms - ms) <= 0.001) ?? null;
}

function cueResult(cues: WorkingCue[], error: string | null = null, beat: BeatEntry | null = null): CueEditResult {
  return { cues: error ? cues : sortWorkingCues(cues), beat, error };
}

function sortWorkingCues(cues: WorkingCue[]): WorkingCue[] {
  return [...cues].sort((a, b) => {
    const aStart = a.startMs ?? Number.POSITIVE_INFINITY;
    const bStart = b.startMs ?? Number.POSITIVE_INFINITY;
    if (aStart !== bStart) return aStart - bStart;
    return a.editorId.localeCompare(b.editorId);
  });
}

export function normalizeImportedCues(trackId: string, rows: CueRow[]): WorkingCue[] {
  return sortWorkingCues(rows.map((row) => ({
    editorId: `imported:${row.id}`,
    trackId,
    importId: row.import_id,
    importedCueId: row.id,
    rekordboxCueId: row.rekordbox_cue_id,
    dedupeKey: row.dedupe_key,
    family: row.cue_family,
    hotCueSlot: row.hot_cue_slot,
    pointType: row.point_type,
    startMs: finiteOrNull(row.start_ms),
    endMs: finiteOrNull(row.end_ms),
    colorTableIndex: row.color_table_index,
    colorHex: row.color_hex,
    colorName: row.color_name,
    rekordboxColor: row.cue_family === 'memory' ? importedMemoryRekordboxColor(row) : null,
    comment: row.comment,
    isActiveLoop: row.is_active_loop,
    beatLoopNumerator: row.beat_loop_numerator,
    beatLoopDenominator: row.beat_loop_denominator,
    sourceDbPresent: row.source_db_present,
    sourceAnlzPresent: row.source_anlz_present,
    sourceConflict: row.source_conflict,
    sourceKind: row.source_kind,
    cueFamilyAuthority: row.cue_family_authority,
    sourcePayload: stableMetadataRecord(row.source_payload),
    rekordboxKind: null,
    semantic: null,
    pairedHotCueSlot: null,
    strategyVersion: null,
    strategySettings: null,
    source: 'imported' as const,
  })));
}

export function nextAvailableHotCueSlot(cues: WorkingCue[]): number | null {
  const ownership = inspectHotCueSlotOwnership(cues);
  if (ownership.status !== 'valid') return null;

  const occupied = new Set(ownership.occupiedSlots);
  for (let slot = HOT_CUE_MIN_SLOT; slot <= HOT_CUE_MAX_SLOT; slot += 1) {
    if (!occupied.has(slot)) return slot;
  }
  return null;
}

function canonicalCue(cue: WorkingCue) {
  return {
    trackId: cue.trackId,
    importId: cue.importId,
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
    rekordboxColor: cue.rekordboxColor ?? null,
    comment: cue.comment,
    isActiveLoop: cue.isActiveLoop,
    beatLoopNumerator: cue.beatLoopNumerator,
    beatLoopDenominator: cue.beatLoopDenominator,
    sourceDbPresent: cue.sourceDbPresent,
    sourceAnlzPresent: cue.sourceAnlzPresent,
    sourceConflict: cue.sourceConflict,
    sourceKind: cue.sourceKind,
    cueFamilyAuthority: cue.cueFamilyAuthority ?? null,
    sourcePayload: stableMetadataRecord(cue.sourcePayload ?? null),
    rekordboxKind: cue.rekordboxKind,
    semantic: cue.semantic,
    pairedHotCueSlot: cue.pairedHotCueSlot,
    strategyVersion: cue.strategyVersion,
    strategySettings: cue.strategySettings,
    source: cue.source,
  };
}

export function workingCueSetsEqual(a: WorkingCue[], b: WorkingCue[]): boolean {
  if (a.length !== b.length) return false;
  const left = sortWorkingCues(a).map(canonicalCue);
  const right = sortWorkingCues(b).map(canonicalCue);
  return JSON.stringify(left) === JSON.stringify(right);
}

export function addWorkingCue(
  cues: WorkingCue[],
  options: {
    editorId: string;
    trackId: string;
    family: 'hot' | 'memory';
    requestedMs: number;
    beats: BeatEntry[];
    timingMode?: CueTimingMode;
  },
): CueEditResult {
  if (!Number.isFinite(options.requestedMs) || options.requestedMs < 0) {
    return { cues, beat: null, error: 'Cue position is invalid.' };
  }
  const timingMode = options.timingMode ?? 'snap';
  let beat: BeatEntry | null = null;
  let startMs: number;
  if (timingMode === 'snap') {
    if (!isUsableBeatGrid(options.beats)) {
      return { cues, beat: null, error: 'Beat snapping is unavailable because this track has no valid Rekordbox beat grid.' };
    }
    beat = nearestBeat(options.beats, options.requestedMs);
    if (!beat) {
      return { cues, beat: null, error: 'Beat snapping is unavailable because this track has no valid Rekordbox beat grid.' };
    }
    startMs = beat.ms;
  } else {
    const exact = exactMilliseconds(options.requestedMs);
    if (exact == null) return { cues, beat: null, error: 'Cue position is invalid.' };
    startMs = exact;
  }

  let hotCueSlot: number | null = null;
  if (options.family === 'hot') {
    const ownership = inspectHotCueSlotOwnership(cues);
    if (ownership.status !== 'valid') {
      return { cues, beat, error: ownership.error ?? 'Hot Cue ownership is not safe to edit.' };
    }
    hotCueSlot = nextAvailableHotCueSlot(cues);
    if (hotCueSlot == null) {
      return { cues, beat, error: 'Hot Cue slots A–H are already in use.' };
    }
  }

  const nextCue: WorkingCue = {
    editorId: options.editorId,
    trackId: options.trackId,
    importId: null,
    importedCueId: null,
    rekordboxCueId: null,
    dedupeKey: null,
    family: options.family,
    hotCueSlot,
    pointType: 'cue',
    startMs,
    endMs: null,
    colorTableIndex: null,
    colorHex: null,
    colorName: null,
    rekordboxColor: options.family === 'memory' ? -1 : null,
    comment: null,
    isActiveLoop: null,
    beatLoopNumerator: null,
    beatLoopDenominator: null,
    sourceDbPresent: false,
    sourceAnlzPresent: false,
    sourceConflict: false,
    sourceKind: 'manual',
    rekordboxKind: null,
    semantic: null,
    pairedHotCueSlot: null,
    strategyVersion: null,
    strategySettings: null,
    source: 'manual',
  };

  return { cues: sortWorkingCues([...cues, nextCue]), beat, error: null };
}

function beatIndex(beats: BeatEntry[], beat: BeatEntry): number {
  return beats.findIndex((candidate) => candidate === beat || candidate.seq === beat.seq && candidate.ms === beat.ms);
}

function pairedGeneratedMemoryCues(cues: WorkingCue[], hotCueSlot: number | null): WorkingCue[] {
  if (hotCueSlot == null) return [];
  return cues.filter((cue) => (
    cue.family === 'memory'
    && cue.pairedHotCueSlot === hotCueSlot
    && cue.source === 'auto'
  ));
}

function pairedMemoryLeadBars(cue: WorkingCue): number | null {
  const value = cue.strategySettings?.memoryLeadBars;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function updatePairedMemorySlot(cues: WorkingCue[], previousSlot: number | null, nextSlot: number): WorkingCue[] {
  if (previousSlot == null || previousSlot === nextSlot) return cues;
  const nextLabel = hotCueSlotLabel(nextSlot);
  return cues.map((candidate) => {
    if (candidate.family !== 'memory' || candidate.source !== 'auto' || candidate.pairedHotCueSlot !== previousSlot) {
      return candidate;
    }
    const comment = candidate.comment?.startsWith('Auto Memory · ')
      ? candidate.comment.replace(/Hot Cue [A-H]$/, `Hot Cue ${nextLabel}`)
      : candidate.comment;
    return { ...candidate, pairedHotCueSlot: nextSlot, comment };
  });
}

function syncPairedMemoryAfterHotMove(
  originalCues: WorkingCue[],
  movedCues: WorkingCue[],
  hotCue: WorkingCue,
  beats: BeatEntry[],
  timingMode: CueTimingMode,
  resultBeat: BeatEntry | null,
): CueEditResult {
  if (hotCue.family !== 'hot' || hotCue.hotCueSlot == null || hotCue.startMs == null) return cueResult(movedCues, null, resultBeat);
  const paired = pairedGeneratedMemoryCues(originalCues, hotCue.hotCueSlot);
  if (paired.length === 0) return cueResult(movedCues, null, resultBeat);
  if (paired.length !== 1) {
    return { cues: originalCues, beat: null, error: 'Auto Cue pairing is ambiguous. Reload or re-run Auto Cue before moving this Hot Cue.' };
  }
  if (!isUsableBeatGrid(beats)) {
    return { cues: originalCues, beat: null, error: 'Moving a paired Auto Cue requires a valid Rekordbox beat grid.' };
  }

  const leadBars = pairedMemoryLeadBars(paired[0]);
  if (leadBars == null) {
    return { cues: originalCues, beat: null, error: 'Auto Cue pairing metadata is incomplete. Reload or re-run Auto Cue before moving this Hot Cue.' };
  }

  const hotAnchor = nearestBeat(beats, hotCue.startMs);
  if (!hotAnchor) {
    return { cues: originalCues, beat: null, error: 'The paired Hot Cue cannot be mapped to the Rekordbox beat grid.' };
  }
  const memoryAnchor = beatByBarOffset(beats, hotAnchor, -leadBars);
  if (!memoryAnchor) {
    return { cues: originalCues, beat: hotAnchor, error: `The paired Memory Cue cannot remain ${leadBars} bars before this Hot Cue.` };
  }

  const phaseOffsetMs = timingMode === 'exact' ? hotCue.startMs - hotAnchor.ms : 0;
  const pairedStartMs = exactMilliseconds(memoryAnchor.ms + phaseOffsetMs);
  if (pairedStartMs == null || pairedStartMs < 0) {
    return { cues: originalCues, beat: hotAnchor, error: 'The paired Memory Cue would move before the start of the track.' };
  }

  const next = movedCues.map((candidate) => (
    candidate.editorId === paired[0].editorId
      ? { ...candidate, startMs: pairedStartMs }
      : candidate
  ));
  return cueResult(next, null, hotAnchor);
}

export function moveWorkingCue(
  cues: WorkingCue[],
  editorId: string,
  requestedMs: number,
  beats: BeatEntry[],
  timingMode: CueTimingMode = 'snap',
): CueEditResult {
  if (!Number.isFinite(requestedMs) || requestedMs < 0) {
    return { cues, beat: null, error: 'Cue position is invalid.' };
  }

  const cueIndex = cues.findIndex((cue) => cue.editorId === editorId);
  if (cueIndex < 0) return { cues, beat: null, error: 'The selected cue no longer exists.' };
  const cue = cues[cueIndex];

  if (timingMode === 'exact') {
    const startMs = exactMilliseconds(requestedMs);
    if (startMs == null) return { cues, beat: null, error: 'Cue position is invalid.' };
    let endMs = cue.endMs;
    let beatLoopNumerator = cue.beatLoopNumerator;
    let beatLoopDenominator = cue.beatLoopDenominator;
    if (cue.pointType === 'loop') {
      if (cue.startMs == null || cue.endMs == null || cue.endMs <= cue.startMs) {
        return { cues, beat: null, error: 'This loop has an invalid range and cannot be repositioned safely.' };
      }
      const exactEndMs = exactMilliseconds(startMs + (cue.endMs - cue.startMs));
      if (exactEndMs == null || exactEndMs <= startMs) {
        return { cues, beat: null, error: 'This loop has an invalid range and cannot be repositioned safely.' };
      }
      endMs = exactEndMs;
      const metadata = beatLoopMetadata(beats, startMs, endMs);
      beatLoopNumerator = metadata.numerator;
      beatLoopDenominator = metadata.denominator;
    }
    const next = [...cues];
    next[cueIndex] = { ...cue, startMs, endMs, beatLoopNumerator, beatLoopDenominator };
    return syncPairedMemoryAfterHotMove(cues, next, next[cueIndex], beats, timingMode, null);
  }

  if (!isUsableBeatGrid(beats)) {
    return { cues, beat: null, error: 'Beat snapping is unavailable because this track has no valid Rekordbox beat grid.' };
  }
  const targetBeat = nearestBeat(beats, requestedMs);
  if (!targetBeat) {
    return { cues, beat: null, error: 'Beat snapping is unavailable because this track has no valid Rekordbox beat grid.' };
  }

  let endMs = cue.endMs;
  if (cue.pointType === 'loop') {
    if (cue.startMs == null || cue.endMs == null || cue.endMs <= cue.startMs) {
      return { cues, beat: targetBeat, error: 'This loop has an invalid range and cannot be repositioned safely.' };
    }
    const originalStartBeat = nearestBeat(beats, cue.startMs);
    const originalEndBeat = nearestBeat(beats, cue.endMs);
    if (!originalStartBeat || !originalEndBeat) {
      return { cues, beat: targetBeat, error: 'This loop cannot be mapped to the Rekordbox beat grid.' };
    }
    const originalStartIndex = beatIndex(beats, originalStartBeat);
    const originalEndIndex = beatIndex(beats, originalEndBeat);
    const targetIndex = beatIndex(beats, targetBeat);
    const beatLength = originalEndIndex - originalStartIndex;
    if (originalStartIndex < 0 || originalEndIndex < 0 || targetIndex < 0 || beatLength <= 0) {
      return { cues, beat: targetBeat, error: 'This loop cannot be mapped to a valid beat range.' };
    }
    const targetEndBeat = beats[targetIndex + beatLength];
    if (!targetEndBeat || targetEndBeat.ms <= targetBeat.ms) {
      return { cues, beat: targetBeat, error: 'The loop would extend beyond the available Rekordbox beat grid.' };
    }
    endMs = targetEndBeat.ms;
  }

  const next = [...cues];
  next[cueIndex] = { ...cue, startMs: targetBeat.ms, endMs };
  return syncPairedMemoryAfterHotMove(cues, next, next[cueIndex], beats, timingMode, targetBeat);
}

function slotCollision(cues: WorkingCue[], editorId: string, slot: number): WorkingCue | null {
  return cues.find((cue) => cue.editorId !== editorId && cue.family === 'hot' && cue.hotCueSlot === slot) ?? null;
}

function beatLoopMetadata(beats: BeatEntry[], startMs: number, endMs: number): { numerator: number | null; denominator: number | null } {
  if (!isUsableBeatGrid(beats)) return { numerator: null, denominator: null };
  const startBeat = exactBeatAtMs(beats, startMs);
  const endBeat = exactBeatAtMs(beats, endMs);
  if (!startBeat || !endBeat) return { numerator: null, denominator: null };
  const startIndex = beatIndex(beats, startBeat);
  const endIndex = beatIndex(beats, endBeat);
  const length = endIndex - startIndex;
  return length > 0 ? { numerator: length, denominator: 1 } : { numerator: null, denominator: null };
}

export function editWorkingCue(
  cues: WorkingCue[],
  editorId: string,
  action: CueEditAction,
  beats: BeatEntry[] = [],
): CueEditResult {
  const cueIndex = cues.findIndex((cue) => cue.editorId === editorId);
  if (cueIndex < 0) return { cues, beat: null, error: 'The selected cue no longer exists.' };
  const cue = cues[cueIndex];
  const next = [...cues];

  if (action.kind === 'family') {
    if (action.family === 'memory') {
      const previousSlot = cue.family === 'hot' ? cue.hotCueSlot : null;
      next[cueIndex] = {
        ...cue,
        family: 'memory',
        hotCueSlot: null,
        rekordboxKind: null,
        // Family conversion must not reinterpret a Hot ColorTableIndex as the
        // independent Memory DjmdCue.Color encoding. Start from explicit no-color.
        colorTableIndex: null,
        colorHex: null,
        colorName: null,
        rekordboxColor: -1,
        pairedHotCueSlot: null,
      };
      const withoutGeneratedPair = previousSlot == null
        ? next
        : next.filter((candidate) => !(
          candidate.editorId !== editorId
          && candidate.family === 'memory'
          && candidate.source === 'auto'
          && candidate.pairedHotCueSlot === previousSlot
        ));
      return cueResult(withoutGeneratedPair);
    }
    const slot = action.hotCueSlot;
    if (slot == null || !validHotSlot(slot)) {
      return { cues, beat: null, error: 'Converting a Memory Cue to Hot requires an explicit free slot from A through H.' };
    }
    const ownership = inspectHotCueSlotOwnership(cues);
    if (ownership.status !== 'valid') {
      return { cues, beat: null, error: ownership.error ?? 'Hot Cue ownership is not safe to edit.' };
    }
    if (slotCollision(cues, editorId, slot)) {
      return { cues, beat: null, error: `Hot Cue slot ${hotCueSlotLabel(slot)} is already in use.` };
    }
    next[cueIndex] = {
      ...cue,
      family: 'hot',
      hotCueSlot: slot,
      rekordboxKind: HOT_REKORDBOX_KIND_BY_SLOT[slot] ?? null,
      rekordboxColor: null,
      pairedHotCueSlot: null,
    };
    return cueResult(next);
  }

  if (action.kind === 'hot-slot') {
    if (cue.family !== 'hot') return { cues, beat: null, error: 'Memory Cues do not own Hot Cue slots.' };
    if (!validHotSlot(action.hotCueSlot)) return { cues, beat: null, error: 'Hot Cue slot must be A through H.' };
    const ownership = inspectHotCueSlotOwnership(cues);
    if (ownership.status !== 'valid') {
      return { cues, beat: null, error: ownership.error ?? 'Hot Cue ownership is not safe to edit.' };
    }
    if (slotCollision(cues, editorId, action.hotCueSlot)) {
      return { cues, beat: null, error: `Hot Cue slot ${hotCueSlotLabel(action.hotCueSlot)} is already in use.` };
    }
    const previousSlot = cue.hotCueSlot;
    next[cueIndex] = {
      ...cue,
      hotCueSlot: action.hotCueSlot,
      rekordboxKind: HOT_REKORDBOX_KIND_BY_SLOT[action.hotCueSlot] ?? null,
    };
    return cueResult(updatePairedMemorySlot(next, previousSlot, action.hotCueSlot));
  }

  if (action.kind === 'point-type') {
    if (action.pointType === cue.pointType) return cueResult(next);
    if (action.pointType === 'cue') {
      next[cueIndex] = {
        ...cue,
        pointType: 'cue',
        endMs: null,
        isActiveLoop: null,
        beatLoopNumerator: null,
        beatLoopDenominator: null,
      };
      return cueResult(next);
    }
    if (cue.startMs == null) return { cues, beat: null, error: 'A cue needs a valid start position before it can become a loop.' };
    if (!isUsableBeatGrid(beats)) {
      return { cues, beat: null, error: 'Creating a loop requires a valid Rekordbox beat grid.' };
    }
    const startBeat = nearestBeat(beats, cue.startMs);
    if (!startBeat) return { cues, beat: null, error: 'Creating a loop requires a valid Rekordbox beat grid.' };
    const startIndex = beatIndex(beats, startBeat);
    const endBeat = beats[startIndex + DEFAULT_LOOP_BEATS];
    if (startIndex < 0 || !endBeat) {
      return { cues, beat: startBeat, error: 'A four-bar loop would extend beyond the available Rekordbox beat grid.' };
    }
    const loopDuration = endBeat.ms - startBeat.ms;
    const endMs = cue.startMs + loopDuration;
    if (endMs <= cue.startMs) return { cues, beat: startBeat, error: 'A valid loop end could not be derived.' };
    next[cueIndex] = {
      ...cue,
      pointType: 'loop',
      endMs,
      isActiveLoop: false,
      beatLoopNumerator: DEFAULT_LOOP_BEATS,
      beatLoopDenominator: 1,
    };
    return cueResult(next, null, startBeat);
  }

  if (action.kind === 'end-ms' || action.kind === 'loop-length-ms') {
    if (cue.pointType !== 'loop' || cue.startMs == null) {
      return { cues, beat: null, error: 'Only loops have an editable loop end or length.' };
    }
    const requestedEnd = action.kind === 'loop-length-ms'
      ? cue.startMs + action.requestedMs
      : action.requestedMs;
    if (!Number.isFinite(requestedEnd) || requestedEnd <= cue.startMs) {
      return { cues, beat: null, error: 'Loop end must be after loop start.' };
    }
    let endMs: number;
    let targetBeat: BeatEntry | null = null;
    if (action.timingMode === 'snap') {
      if (!isUsableBeatGrid(beats)) return { cues, beat: null, error: 'Beat snapping requires a valid Rekordbox beat grid.' };
      targetBeat = nearestBeat(beats, requestedEnd);
      if (!targetBeat || targetBeat.ms <= cue.startMs) {
        return { cues, beat: targetBeat, error: 'Loop end must snap to a beat after loop start.' };
      }
      endMs = targetBeat.ms;
    } else {
      const exact = exactMilliseconds(requestedEnd);
      if (exact == null || exact <= cue.startMs) return { cues, beat: null, error: 'Loop end must be after loop start.' };
      endMs = exact;
    }
    const loopMeta = beatLoopMetadata(beats, cue.startMs, endMs);
    next[cueIndex] = {
      ...cue,
      endMs,
      beatLoopNumerator: loopMeta.numerator,
      beatLoopDenominator: loopMeta.denominator,
    };
    return cueResult(next, null, targetBeat);
  }

  if (action.kind === 'comment') {
    next[cueIndex] = { ...cue, comment: action.comment };
    return cueResult(next);
  }

  if (action.kind === 'hot-color-table') {
    if (cue.family !== 'hot') {
      return { cues, beat: null, error: 'Memory Cue color is stored separately from ColorTableIndex.' };
    }
    if (action.colorTableIndex != null && (!Number.isInteger(action.colorTableIndex) || action.colorTableIndex < 0)) {
      return { cues, beat: null, error: 'Rekordbox color index must be a non-negative integer or empty.' };
    }
    next[cueIndex] = {
      ...cue,
      colorTableIndex: action.colorTableIndex,
      colorHex: null,
      colorName: null,
    };
    return cueResult(next);
  }

  if (action.kind === 'memory-color') {
    if (cue.family !== 'memory') {
      return { cues, beat: null, error: 'Hot Cue color uses ColorTableIndex, not Memory DjmdCue.Color.' };
    }
    if (!isSupportedMemoryDjmdCueColor(action.rekordboxColor)) {
      return { cues, beat: null, error: 'Memory Cue color must be clear or a supported Rekordbox Color value from 1 through 7.' };
    }
    next[cueIndex] = {
      ...cue,
      rekordboxColor: action.rekordboxColor,
      colorHex: action.colorHex,
      colorName: action.colorName,
      // Deliberately preserve ColorTableIndex. Memory DjmdCue.Color and
      // ColorTableIndex are independent Rekordbox fields.
    };
    return cueResult(next);
  }

  if (cue.pointType !== 'loop') {
    return { cues, beat: null, error: 'Active Loop is available only for loop cues.' };
  }
  next[cueIndex] = { ...cue, isActiveLoop: action.isActiveLoop };
  return cueResult(next);
}

export function deleteWorkingCue(cues: WorkingCue[], editorId: string): WorkingCue[] {
  const target = cues.find((cue) => cue.editorId === editorId);
  if (!target) return cues;
  if (target.family !== 'hot' || target.hotCueSlot == null) {
    return cues.filter((cue) => cue.editorId !== editorId);
  }
  return cues.filter((cue) => (
    cue.editorId !== editorId
    && !(cue.family === 'memory' && cue.source === 'auto' && cue.pairedHotCueSlot === target.hotCueSlot)
  ));
}

/** Stable Stage 3 extension point for replacing auto-generated proposals. */
export function replaceWorkingCues(cues: WorkingCue[]): WorkingCue[] {
  return sortWorkingCues(cues);
}
