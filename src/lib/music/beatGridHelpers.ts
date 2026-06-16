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

/**
 * Return the beat whose ms position is closest to the given ms.
 * Returns null when the beat array is empty.
 */
export function nearestBeat(beats: BeatEntry[], ms: number): BeatEntry | null {
  if (beats.length === 0) return null;
  let best = beats[0];
  let bestDist = Math.abs(beats[0].ms - ms);
  for (let i = 1; i < beats.length; i++) {
    const dist = Math.abs(beats[i].ms - ms);
    if (dist < bestDist) {
      best = beats[i];
      bestDist = dist;
    }
  }
  return best;
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
 * Uses the nearest beat's local BPM.  Returns null when no beats are available.
 */
export function bpmAt(beats: BeatEntry[], ms: number): number | null {
  const beat = nearestBeat(beats, ms);
  return beat !== null ? beat.bpm : null;
}

/**
 * Return the beat that immediately precedes or is at the given ms position.
 * Returns null when ms is before the first beat.
 */
export function beatAtOrBefore(beats: BeatEntry[], ms: number): BeatEntry | null {
  let result: BeatEntry | null = null;
  for (const b of beats) {
    if (b.ms <= ms) result = b;
    else break;
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
