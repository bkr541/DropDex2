import { isUsableBeatGrid, nearestBeat, type BeatEntry } from './beatGridHelpers';
import type { CueRow } from '../queries/analysisData';

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
  comment: string | null;
  isActiveLoop: boolean | null;
  beatLoopNumerator: number | null;
  beatLoopDenominator: number | null;
  sourceDbPresent: boolean;
  sourceAnlzPresent: boolean;
  sourceConflict: boolean;
  sourceKind: string | null;
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
    comment: row.comment,
    isActiveLoop: row.is_active_loop,
    beatLoopNumerator: row.beat_loop_numerator,
    beatLoopDenominator: row.beat_loop_denominator,
    sourceDbPresent: row.source_db_present,
    sourceAnlzPresent: row.source_anlz_present,
    sourceConflict: row.source_conflict,
    sourceKind: row.source_kind,
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
    comment: cue.comment,
    isActiveLoop: cue.isActiveLoop,
    beatLoopNumerator: cue.beatLoopNumerator,
    beatLoopDenominator: cue.beatLoopDenominator,
    sourceDbPresent: cue.sourceDbPresent,
    sourceAnlzPresent: cue.sourceAnlzPresent,
    sourceConflict: cue.sourceConflict,
    sourceKind: cue.sourceKind,
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
  },
): CueEditResult {
  if (!Number.isFinite(options.requestedMs)) {
    return { cues, beat: null, error: 'Cue position is invalid.' };
  }
  if (!isUsableBeatGrid(options.beats)) {
    return { cues, beat: null, error: 'Beat snapping is unavailable because this track has no valid Rekordbox beat grid.' };
  }
  const beat = nearestBeat(options.beats, options.requestedMs);
  if (!beat) {
    return { cues, beat: null, error: 'Beat snapping is unavailable because this track has no valid Rekordbox beat grid.' };
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
    startMs: beat.ms,
    endMs: null,
    colorTableIndex: null,
    colorHex: null,
    colorName: null,
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

export function moveWorkingCue(
  cues: WorkingCue[],
  editorId: string,
  requestedMs: number,
  beats: BeatEntry[],
): CueEditResult {
  if (!Number.isFinite(requestedMs)) {
    return { cues, beat: null, error: 'Cue position is invalid.' };
  }
  if (!isUsableBeatGrid(beats)) {
    return { cues, beat: null, error: 'Beat snapping is unavailable because this track has no valid Rekordbox beat grid.' };
  }
  const targetBeat = nearestBeat(beats, requestedMs);
  if (!targetBeat) {
    return { cues, beat: null, error: 'Beat snapping is unavailable because this track has no valid Rekordbox beat grid.' };
  }

  const cueIndex = cues.findIndex((cue) => cue.editorId === editorId);
  if (cueIndex < 0) return { cues, beat: targetBeat, error: 'The selected cue no longer exists.' };

  const cue = cues[cueIndex];
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
  return { cues: sortWorkingCues(next), beat: targetBeat, error: null };
}

export function deleteWorkingCue(cues: WorkingCue[], editorId: string): WorkingCue[] {
  return cues.filter((cue) => cue.editorId !== editorId);
}

/** Stable Stage 3 extension point for replacing auto-generated proposals. */
export function replaceWorkingCues(cues: WorkingCue[]): WorkingCue[] {
  return sortWorkingCues(cues);
}
