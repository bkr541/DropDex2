import { formatKey } from '../../lib/utils';
import type { BpmStatTotal, NamedStatTotal } from '../../lib/queries/rekordbox';

export type StatPairs = readonly (readonly [string, number])[];

/** Groups BPM totals into 20-BPM ranges ("140–159"), lowest range first. */
export function bpmRangeStatsFrom(bpmTotals: readonly BpmStatTotal[] | undefined): StatPairs {
  const buckets = new Map<number, number>();
  for (const { bpm, count } of bpmTotals ?? []) {
    const bucket = Math.floor(bpm / 20) * 20;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + count);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([bucket, count]) => [`${bucket}–${bucket + 19}`, count] as const);
}

/** Key totals as Camelot names, most common first. */
export function keyStatsFrom(keyTotals: readonly NamedStatTotal[] | undefined): StatPairs {
  return (keyTotals ?? [])
    .map(({ name, count }) => [formatKey(name), count] as const)
    .sort(([, a], [, b]) => b - a);
}

// ── Insight chart color palettes ─────────────────────────────────────────────
export const GENRE_RANK_COLORS = ['#22d3ee', '#a855f7', '#f59e0b', '#ec4899', '#14b8a6', '#f97316'];
export const GENRE_OTHER_COLOR = '#6b7280';

export const CAMELOT_COLORS: Record<number, string> = {
  1: '#e74c3c', 2: '#3b82f6', 3: '#1d4ed8', 4: '#f59e0b', 5: '#16a34a', 6: '#d97706',
  7: '#8b5cf6', 8: '#0d9488', 9: '#22c55e', 10: '#0891b2', 11: '#06b6d4', 12: '#ec4899',
};

export function parseCamelotKey(key: string): { n: number; letter: 'A' | 'B' } | null {
  const m = key.match(/^(\d{1,2})([AB])$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n < 1 || n > 12) return null;
  return { n, letter: m[2].toUpperCase() as 'A' | 'B' };
}

export function camelotColor(key: string): string {
  const parsed = parseCamelotKey(key);
  return parsed ? (CAMELOT_COLORS[parsed.n] ?? '#6b7280') : '#6b7280';
}

