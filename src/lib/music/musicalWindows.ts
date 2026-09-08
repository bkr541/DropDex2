import {
  downbeatsOnly,
  isUsableBeatGrid,
  type BeatEntry,
} from './beatGridHelpers';

export type MusicalBarCount = 4 | 8 | 16;
export type MusicalWindowTimingSource = 'beat-grid' | 'bpm';

export interface MusicalTimeWindow {
  startMs: number;
  endMs: number;
  durationMs: number;
  timingSource: MusicalWindowTimingSource;
}

export function createMusicalTimeWindow(
  startMs: number,
  endMs: number,
  durationMs: number | null,
  timingSource: MusicalWindowTimingSource,
): MusicalTimeWindow | null {
  const safeStart = Math.max(0, startMs);
  const safeEnd = durationMs != null ? Math.min(durationMs, endMs) : endMs;
  if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd) || safeEnd <= safeStart) {
    return null;
  }
  return {
    startMs: safeStart,
    endMs: safeEnd,
    durationMs: safeEnd - safeStart,
    timingSource,
  };
}

export function bpmBarWindowMs(
  bpm: number | null,
  barCount: MusicalBarCount,
): number | null {
  if (bpm == null || !Number.isFinite(bpm) || bpm <= 0) return null;
  return (60_000 / bpm) * 4 * barCount;
}

function averageBeatMs(beats: BeatEntry[], fallbackBpm: number | null): number | null {
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    const delta = beats[i].ms - beats[i - 1].ms;
    if (Number.isFinite(delta) && delta > 0 && delta < 3000) intervals.push(delta);
  }
  if (intervals.length > 0) {
    return intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  }
  if (fallbackBpm != null && Number.isFinite(fallbackBpm) && fallbackBpm > 0) {
    return 60_000 / fallbackBpm;
  }
  return null;
}

/** Shift an anchor by exact stored beats when possible, with BPM/interval fallback. */
export function shiftMusicalAnchorByBeats(
  ms: number,
  beats: BeatEntry[],
  beatOffset: number,
  fallbackBpm: number | null,
): number {
  if (!Number.isFinite(ms) || !Number.isInteger(beatOffset) || beatOffset === 0) return ms;

  if (isUsableBeatGrid(beats)) {
    const nearestIndex = beats.findIndex((beat) => beat.ms >= ms);
    const index = nearestIndex >= 0 ? nearestIndex : beats.length - 1;
    const shifted = beats[index + beatOffset];
    if (shifted) return shifted.ms;
  }

  const beatMs = averageBeatMs(beats, fallbackBpm);
  return beatMs == null ? ms : Math.max(0, ms + beatOffset * beatMs);
}

function downbeatAtOrBefore(downbeats: BeatEntry[], ms: number): number {
  let result = -1;
  for (let i = 0; i < downbeats.length; i++) {
    if (downbeats[i].ms <= ms) result = i;
    else break;
  }
  return result;
}

/**
 * Resolve a deterministic bar window around an anchor. Valid Rekordbox
 * downbeats are authoritative; average-BPM timing is used only when exact grid
 * traversal cannot produce the requested side of the window.
 */
export function resolveMusicalBarWindow(input: {
  beats: BeatEntry[];
  anchorMs: number;
  barCount: MusicalBarCount;
  direction: 'before' | 'after';
  durationMs: number | null;
  fallbackBpm: number | null;
}): MusicalTimeWindow | null {
  const downbeats = isUsableBeatGrid(input.beats) ? downbeatsOnly(input.beats) : [];

  if (input.direction === 'before') {
    const anchorIndex = downbeatAtOrBefore(downbeats, input.anchorMs);
    if (anchorIndex >= 0) {
      const start = downbeats[Math.max(0, anchorIndex - input.barCount)]?.ms ?? 0;
      return createMusicalTimeWindow(start, input.anchorMs, input.durationMs, 'beat-grid');
    }

    const windowMs = bpmBarWindowMs(input.fallbackBpm, input.barCount);
    return windowMs == null
      ? null
      : createMusicalTimeWindow(
          input.anchorMs - windowMs,
          input.anchorMs,
          input.durationMs,
          'bpm',
        );
  }

  const anchorIndex = downbeats.findIndex((beat) => beat.ms >= input.anchorMs);
  if (anchorIndex >= 0) {
    const end = downbeats[anchorIndex + input.barCount]?.ms
      ?? input.durationMs
      ?? input.anchorMs;
    return createMusicalTimeWindow(input.anchorMs, end, input.durationMs, 'beat-grid');
  }

  const windowMs = bpmBarWindowMs(input.fallbackBpm, input.barCount);
  return windowMs == null
    ? null
    : createMusicalTimeWindow(
        input.anchorMs,
        input.anchorMs + windowMs,
        input.durationMs,
        'bpm',
      );
}
