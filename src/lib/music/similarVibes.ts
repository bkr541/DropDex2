/** Maximum BPM delta used when matching tracks by tempo. */
export const BPM_TOLERANCE_DEFAULT = 2;

/** Maximum candidates to request from the database before in-TypeScript ranking. */
export const SIMILAR_CANDIDATE_FETCH_LIMIT = 20;

/** Maximum ranked results to return to the caller. */
export const SIMILAR_TRACKS_LIMIT = 5;

export interface RankableTrack {
  id: string;
  title: string;
  bpm: number | null;
}

/** Returns true when `bpm` is a usable positive number (0 = unanalyzed in Rekordbox). */
export function shouldUseBpm(bpm: number | null | undefined): bpm is number {
  return bpm != null && bpm > 0;
}

/**
 * Returns true when the track has at least one signal (key or BPM) that can
 * drive a Similar Vibes query.  When false, no DB fetch is needed.
 */
export function hasSimilarVibesSignal(
  key: string | null | undefined,
  bpm: number | null | undefined,
): boolean {
  return Boolean(key) || shouldUseBpm(bpm);
}

/**
 * Pure ranking step applied after the database returns candidates.
 *
 * Filters out:
 *  - the selected track itself (safety guard against the DB exclusion failing)
 *  - candidates with null BPM when BPM matching is required
 *  - candidates outside [selectedBpm − tolerance, selectedBpm + tolerance]
 *
 * Sorts by:
 *  1. Absolute BPM difference (ascending) — only when selectedBpm is a valid number
 *  2. Title (locale-aware, ascending)
 *
 * Returns at most `limit` results.
 */
export function rankSimilarTracks<T extends RankableTrack>(
  candidates: T[],
  selectedId: string,
  selectedBpm: number | null | undefined,
  bpmTolerance = BPM_TOLERANCE_DEFAULT,
  limit = SIMILAR_TRACKS_LIMIT,
): T[] {
  return candidates
    .filter((c) => {
      if (c.id === selectedId) return false;
      if (shouldUseBpm(selectedBpm)) {
        if (c.bpm == null) return false;
        return c.bpm >= selectedBpm - bpmTolerance && c.bpm <= selectedBpm + bpmTolerance;
      }
      return true;
    })
    .sort((a, b) => {
      if (shouldUseBpm(selectedBpm)) {
        const aDiff = Math.abs((a.bpm ?? Infinity) - selectedBpm);
        const bDiff = Math.abs((b.bpm ?? Infinity) - selectedBpm);
        if (aDiff !== bDiff) return aDiff - bDiff;
      }
      return a.title.localeCompare(b.title);
    })
    .slice(0, limit);
}
