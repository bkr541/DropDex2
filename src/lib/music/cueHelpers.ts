/**
 * Pure helper functions for working with Rekordbox cue point data.
 *
 * All functions are stateless and have no Supabase dependency.
 * Input types mirror CueRow from src/lib/queries/analysisData.ts.
 */

export interface CueRow {
  id: string;
  cue_family: 'hot' | 'memory';
  hot_cue_slot: number | null;
  point_type: 'cue' | 'loop';
  start_ms: number | null;
  end_ms: number | null;
  color_hex: string | null;
  color_name: string | null;
  comment: string | null;
  is_active_loop: boolean | null;
  beat_loop_numerator: number | null;
  beat_loop_denominator: number | null;
  source_db_present: boolean;
  source_anlz_present: boolean;
}

// Hot cue slot number → label string (A–H)
const _HOT_CUE_LABELS: Record<number, string> = {
  1: 'A', 2: 'B', 3: 'C', 4: 'D',
  5: 'E', 6: 'F', 7: 'G', 8: 'H',
};

/**
 * Return the label for a hot cue slot (1→"A", 2→"B", …, 8→"H").
 * Returns null for unknown slots.
 */
export function hotCueLabel(slot: number | null): string | null {
  if (slot === null) return null;
  return _HOT_CUE_LABELS[slot] ?? null;
}

/**
 * Return hot cues only, sorted by slot number ascending.
 * Cues with a null slot are placed last.
 */
export function hotCuesOnly(cues: CueRow[]): CueRow[] {
  return cues
    .filter(c => c.cue_family === 'hot')
    .sort((a, b) => {
      const sa = a.hot_cue_slot ?? 9;
      const sb = b.hot_cue_slot ?? 9;
      return sa - sb;
    });
}

/**
 * Return memory cues only, sorted by start_ms ascending.
 * Cues with a null start_ms are placed last.
 */
export function memoryCuesOnly(cues: CueRow[]): CueRow[] {
  return cues
    .filter(c => c.cue_family === 'memory')
    .sort((a, b) => {
      const ma = a.start_ms ?? Infinity;
      const mb = b.start_ms ?? Infinity;
      return ma - mb;
    });
}

/**
 * Return loop cues only (point_type === 'loop'), sorted by start_ms ascending.
 */
export function loopsOnly(cues: CueRow[]): CueRow[] {
  return cues
    .filter(c => c.point_type === 'loop')
    .sort((a, b) => {
      const ma = a.start_ms ?? Infinity;
      const mb = b.start_ms ?? Infinity;
      return ma - mb;
    });
}

/**
 * Return the cue's color_hex, falling back to the provided fallback.
 * Returns null when there is no color and no fallback.
 */
export function cueColorOrFallback(
  cue: CueRow,
  fallback: string | null = null,
): string | null {
  return cue.color_hex ?? fallback;
}

/**
 * Return a human-readable beat loop ratio string, e.g. "1/2", "4", "1/4".
 * Returns null when numerator or denominator is missing.
 */
export function beatLoopRatio(cue: CueRow): string | null {
  const num = cue.beat_loop_numerator;
  const den = cue.beat_loop_denominator;
  if (num === null || den === null) return null;
  if (den === 1) return String(num);
  return `${num}/${den}`;
}

/**
 * Return true when the cue has been confirmed by both the database and ANLZ
 * sources (highest confidence).
 */
export function isConfirmedByBothSources(cue: CueRow): boolean {
  return cue.source_db_present && cue.source_anlz_present;
}
