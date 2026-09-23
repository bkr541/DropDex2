import type { BeatEntry } from '../music/beatGridHelpers';

export type CueGridDisplayMode = 'beats' | 'bars' | '4-bars' | '8-bars' | '16-bars';

export interface CueTimelineView {
  start: number;
  end: number;
}

export const MIN_CUE_TIMELINE_WINDOW_MS = 2_000;

export function gridBeatsForMode(beats: BeatEntry[], mode: CueGridDisplayMode): BeatEntry[] {
  if (mode === 'bars') return beats.filter((beat) => beat.isDownbeat || beat.beatInBar === 1);
  if (mode === '4-bars') return beats.filter((beat) => (beat.isDownbeat || beat.beatInBar === 1) && beat.bar % 4 === 1);
  if (mode === '8-bars') return beats.filter((beat) => (beat.isDownbeat || beat.beatInBar === 1) && beat.bar % 8 === 1);
  if (mode === '16-bars') return beats.filter((beat) => (beat.isDownbeat || beat.beatInBar === 1) && beat.bar % 16 === 1);
  return beats;
}

function normalizeView(view: CueTimelineView, durationMs: number): CueTimelineView | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  if (!Number.isFinite(view.start) || !Number.isFinite(view.end) || view.end <= view.start) return null;

  const start = Math.max(0, Math.min(durationMs, view.start));
  const end = Math.max(start, Math.min(durationMs, view.end));
  if (end <= start) return { start: 0, end: durationMs };
  return { start, end };
}

function clampViewToDuration(start: number, end: number, durationMs: number): CueTimelineView {
  let nextStart = start;
  let nextEnd = end;
  if (nextStart < 0) {
    nextEnd = Math.min(durationMs, nextEnd - nextStart);
    nextStart = 0;
  }
  if (nextEnd > durationMs) {
    nextStart = Math.max(0, nextStart - (nextEnd - durationMs));
    nextEnd = durationMs;
  }
  return { start: nextStart, end: nextEnd };
}

export function zoomCueTimelineView(
  view: CueTimelineView,
  durationMs: number,
  factor: number,
  focusFraction = 0.5,
): CueTimelineView | null {
  const normalized = normalizeView(view, durationMs);
  if (!normalized || !Number.isFinite(factor) || factor <= 0) return null;

  const fraction = Math.max(0, Math.min(1, focusFraction));
  const currentRange = normalized.end - normalized.start;
  const minimumRange = Math.min(MIN_CUE_TIMELINE_WINDOW_MS, durationMs);
  const nextRange = Math.max(minimumRange, Math.min(durationMs, currentRange * factor));
  const focusMs = normalized.start + fraction * currentRange;
  const start = focusMs - fraction * nextRange;
  const end = focusMs + (1 - fraction) * nextRange;
  return clampViewToDuration(start, end, durationMs);
}

export function panCueTimelineView(
  view: CueTimelineView,
  durationMs: number,
  deltaMs: number,
): CueTimelineView | null {
  const normalized = normalizeView(view, durationMs);
  if (!normalized || !Number.isFinite(deltaMs)) return null;
  return clampViewToDuration(normalized.start + deltaMs, normalized.end + deltaMs, durationMs);
}
