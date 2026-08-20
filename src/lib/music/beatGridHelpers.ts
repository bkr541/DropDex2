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
