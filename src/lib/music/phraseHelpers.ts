/**
 * Pure helper functions for working with Rekordbox phrase analysis data.
 *
 * All functions are stateless and have no Supabase dependency.
 * Input types mirror PhraseRow from src/lib/queries/analysisData.ts.
 */

export interface PhraseRow {
  id: string;
  phrase_index: number;
  source_mood: string | null;
  normalized_label: string | null;
  start_beat: number | null;
  end_beat: number | null;
  start_ms: number | null;
  end_ms: number | null;
  fill_start_beat: number | null;
  fill_start_ms: number | null;
  source_flags: Record<string, unknown>;
  source_payload: Record<string, unknown>;
  parser_version: string | null;
}

/**
 * Return the phrase that contains the given ms position.
 *
 * A phrase contains ms when start_ms <= ms < end_ms.
 * When end_ms is null, the phrase extends to the end of the track — it
 * matches any ms >= start_ms.
 *
 * Returns null when no phrase matches (e.g., ms is before the first phrase).
 */
export function phraseAtMs(phrases: PhraseRow[], ms: number): PhraseRow | null {
  for (const p of phrases) {
    if (p.start_ms === null) continue;
    if (ms < p.start_ms) continue;
    if (p.end_ms !== null && ms >= p.end_ms) continue;
    return p;
  }
  return null;
}

/**
 * Return a sorted list of unique phrase boundary ms values.
 *
 * Includes both start_ms and end_ms of every phrase (nulls omitted).
 * Values are deduplicated and sorted ascending.
 */
export function orderedBoundaries(phrases: PhraseRow[]): number[] {
  const seen = new Set<number>();
  for (const p of phrases) {
    if (p.start_ms !== null) seen.add(p.start_ms);
    if (p.end_ms !== null) seen.add(p.end_ms);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * Group phrases by their normalized_label.
 *
 * Phrases with a null label are grouped under the key "unknown".
 * Preserves original phrase ordering within each group.
 */
export function groupByLabel(phrases: PhraseRow[]): Record<string, PhraseRow[]> {
  const result: Record<string, PhraseRow[]> = {};
  for (const p of phrases) {
    const key = p.normalized_label ?? 'unknown';
    if (!result[key]) result[key] = [];
    result[key].push(p);
  }
  return result;
}

/**
 * Return the overall mood string for the track, derived from source_mood of
 * the first phrase.  Returns null when phrases is empty or source_mood is null.
 *
 * All phrases in a PSSI block share the same mood, so only the first is checked.
 */
export function trackMood(phrases: PhraseRow[]): string | null {
  return phrases[0]?.source_mood ?? null;
}

/**
 * Return the duration of a phrase in ms.
 * Returns null when start_ms or end_ms is missing.
 */
export function phraseDurationMs(phrase: PhraseRow): number | null {
  if (phrase.start_ms === null || phrase.end_ms === null) return null;
  return phrase.end_ms - phrase.start_ms;
}
