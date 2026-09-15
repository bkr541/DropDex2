/**
 * Pure helper functions for working with Rekordbox beat grid data.
 *
 * All functions are stateless and have no Supabase dependency.
 * Input types mirror BeatEntry from src/lib/queries/analysisData.ts.
 */

export interface BeatEntry {
  seq: number;
  srcIdx: number;
  beatInBar: number;
  bar: number;
  ms: number;
  bpm: number;
  isDownbeat: boolean;
}

const usableGridCache = new WeakMap<BeatEntry[], boolean>();

function isFiniteBeat(beat: BeatEntry): boolean {
  return Number.isFinite(beat.seq)
    && Number.isFinite(beat.srcIdx)
    && Number.isFinite(beat.beatInBar)
    && Number.isFinite(beat.bar)
    && Number.isFinite(beat.ms)
    && beat.ms >= 0
    && Number.isFinite(beat.bpm)
    && beat.bpm > 0;
}

/**
 * A beat grid is usable for editor snapping only when every record is finite
 * and the source-stored millisecond positions are strictly increasing. The
 * validation result is cached by the immutable query-array identity so repeated
 * drag snapping pays this O(n) validation cost once. Failing closed prevents the editor from claiming precision for malformed or
 * non-monotonic Rekordbox analysis data.
 */
export function isUsableBeatGrid(beats: BeatEntry[]): boolean {
  const cached = usableGridCache.get(beats);
  if (cached != null) return cached;
  if (beats.length === 0) {
    usableGridCache.set(beats, false);
    return false;
  }
  let previousMs = -1;
  for (const beat of beats) {
    if (!isFiniteBeat(beat) || beat.ms <= previousMs) {
      usableGridCache.set(beats, false);
      return false;
    }
    previousMs = beat.ms;
  }
  usableGridCache.set(beats, true);
  return true;
}

/**
 * Return the source beat whose stored millisecond position is closest to ms.
 * Uses binary search over a validated grid, so drag-time snapping is O(log n).
 * Exact ties resolve to the earlier beat for deterministic behavior.
 */
export function nearestBeat(beats: BeatEntry[], ms: number): BeatEntry | null {
  if (!Number.isFinite(ms) || !isUsableBeatGrid(beats)) return null;
  if (beats.length === 1) return beats[0];
  if (ms <= beats[0].ms) return beats[0];
  const last = beats[beats.length - 1];
  if (ms >= last.ms) return last;

  let low = 0;
  let high = beats.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = beats[middle];
    if (candidate.ms === ms) return candidate;
    if (candidate.ms < ms) low = middle + 1;
    else high = middle - 1;
  }

  const earlier = beats[Math.max(0, high)];
  const later = beats[Math.min(beats.length - 1, low)];
  const earlierDistance = Math.abs(ms - earlier.ms);
  const laterDistance = Math.abs(later.ms - ms);
  return earlierDistance <= laterDistance ? earlier : later;
}



export type BeatSnapResolution = 1 | 2 | 4;

const snapCandidateCache = new WeakMap<BeatEntry[], Map<BeatSnapResolution, BeatEntry[] | null>>();

function hasTrustworthyFourFourPositions(beats: BeatEntry[]): boolean {
  if (!isUsableBeatGrid(beats) || !beats.some((beat) => beat.isDownbeat || beat.beatInBar === 1)) return false;
  if (!beats.every((beat) => Number.isInteger(beat.beatInBar) && beat.beatInBar >= 1 && beat.beatInBar <= 4)) return false;

  for (let index = 1; index < beats.length; index += 1) {
    const previous = beats[index - 1];
    const current = beats[index];
    if (Number.isInteger(previous.seq) && Number.isInteger(current.seq) && current.seq === previous.seq + 1) {
      const expected = previous.beatInBar === 4 ? 1 : previous.beatInBar + 1;
      if (current.beatInBar !== expected) return false;
    }
  }
  return true;
}

/**
 * Return the exact stored source beats eligible for the selected snap resolution.
 *
 * 1-beat uses every source beat. 2-beat prefers canonical 4/4 anchors on beats
 * 1 and 3 when beat-in-bar data is trustworthy; otherwise it deterministically
 * falls back to every other source-sequence beat. 4-beat uses only stored
 * downbeats/bar starts. No timestamps are interpolated.
 */
export function snapBeatCandidates(beats: BeatEntry[], resolution: BeatSnapResolution): BeatEntry[] | null {
  if (!isUsableBeatGrid(beats)) return null;
  let byResolution = snapCandidateCache.get(beats);
  if (!byResolution) {
    byResolution = new Map();
    snapCandidateCache.set(beats, byResolution);
  }
  if (byResolution.has(resolution)) return byResolution.get(resolution) ?? null;

  let candidates: BeatEntry[];
  if (resolution === 1) {
    candidates = beats;
  } else if (resolution === 4) {
    candidates = beats.filter((beat) => beat.isDownbeat || beat.beatInBar === 1);
  } else if (hasTrustworthyFourFourPositions(beats)) {
    candidates = beats.filter((beat) => beat.beatInBar === 1 || beat.beatInBar === 3);
  } else {
    const anchorSeq = beats[0]?.seq;
    candidates = Number.isInteger(anchorSeq)
      ? beats.filter((beat) => Number.isInteger(beat.seq) && Math.abs(beat.seq - anchorSeq) % 2 === 0)
      : [];
  }

  const result = candidates.length > 0 ? candidates : null;
  byResolution.set(resolution, result);
  return result;
}

/** Resolve the nearest exact source beat eligible for a snap resolution. */
export function nearestSnapBeat(beats: BeatEntry[], ms: number, resolution: BeatSnapResolution): BeatEntry | null {
  const candidates = snapBeatCandidates(beats, resolution);
  return candidates ? nearestBeat(candidates, ms) : null;
}

/** Return the first exact source beat when the grid is valid. */
export function firstValidBeat(beats: BeatEntry[]): BeatEntry | null {
  return isUsableBeatGrid(beats) ? beats[0] : null;
}

/** Return the exact source beat with a given Rekordbox sequence number. */
export function beatBySequence(beats: BeatEntry[], seq: number | null): BeatEntry | null {
  if (seq == null || !Number.isFinite(seq) || !isUsableBeatGrid(beats)) return null;
  return beats.find((beat) => beat.seq === seq) ?? null;
}

/**
 * Resolve a stored phrase/cue boundary onto an exact beat. Sequence identity is
 * authoritative when available; millisecond proximity is only the fallback.
 */
export function exactBeatForBoundary(
  beats: BeatEntry[],
  boundary: { beatSequence?: number | null; ms?: number | null },
): BeatEntry | null {
  const bySequence = beatBySequence(beats, boundary.beatSequence ?? null);
  if (bySequence) return bySequence;
  const ms = boundary.ms;
  return ms != null && Number.isFinite(ms) ? nearestBeat(beats, ms) : null;
}

/**
 * Traverse an exact 4/4 Rekordbox grid by whole bars while preserving the
 * anchor's beat-in-bar. Missing target beats fail closed instead of falling
 * back to average-BPM arithmetic.
 */
export function beatByBarOffset(beats: BeatEntry[], anchor: BeatEntry, bars: number): BeatEntry | null {
  if (!Number.isInteger(bars) || !isUsableBeatGrid(beats)) return null;
  const exactAnchor = beats.find((beat) => beat.seq === anchor.seq && beat.ms === anchor.ms);
  if (!exactAnchor) return null;
  if (bars === 0) return exactAnchor;

  if (exactAnchor.bar > 0) {
    const targetBar = exactAnchor.bar + bars;
    if (targetBar <= 0) return null;
    return beats.find((beat) => beat.bar === targetBar && beat.beatInBar === exactAnchor.beatInBar) ?? null;
  }

  // Beats before the first Rekordbox downbeat are marked bar 0. For positive
  // offsets only, traverse exact stored beat entries rather than inventing a
  // synthetic bar number.
  if (bars < 0) return null;
  const anchorIndex = beats.indexOf(exactAnchor);
  const target = beats[anchorIndex + bars * 4] ?? null;
  return target && target.beatInBar === exactAnchor.beatInBar ? target : null;
}

/**
 * Return only the downbeat entries (beatInBar === 1), preserving order.
 */
export function downbeatsOnly(beats: BeatEntry[]): BeatEntry[] {
  return beats.filter(b => b.isDownbeat);
}

/**
 * Return all beats whose ms position falls within [startMs, endMs) (inclusive start, exclusive end).
 */
export function beatsInRange(beats: BeatEntry[], startMs: number, endMs: number): BeatEntry[] {
  return beats.filter(b => b.ms >= startMs && b.ms < endMs);
}

/**
 * Return the BPM at the given ms position.
 *
 * Uses the nearest beat's local BPM.  Returns null when no usable beats are available.
 */
export function bpmAt(beats: BeatEntry[], ms: number): number | null {
  const beat = nearestBeat(beats, ms);
  return beat !== null ? beat.bpm : null;
}

/**
 * Return the beat that immediately precedes or is at the given ms position.
 * Returns null when ms is before the first beat or the grid is malformed.
 */
export function beatAtOrBefore(beats: BeatEntry[], ms: number): BeatEntry | null {
  if (!Number.isFinite(ms) || !isUsableBeatGrid(beats) || ms < beats[0].ms) return null;
  let low = 0;
  let high = beats.length - 1;
  let result: BeatEntry | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const beat = beats[middle];
    if (beat.ms <= ms) {
      result = beat;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

/**
 * Return the bar number at the given ms position (from the nearest beat).
 * Returns null when no beats are available.
 */
export function barAt(beats: BeatEntry[], ms: number): number | null {
  const beat = nearestBeat(beats, ms);
  return beat !== null ? beat.bar : null;
}
