const CAMELOT_COLORS: Record<number, string> = {
  1: '#e74c3c', 2: '#3b82f6', 3: '#1d4ed8', 4: '#f59e0b', 5: '#16a34a', 6: '#d97706',
  7: '#8b5cf6', 8: '#0d9488', 9: '#22c55e', 10: '#0891b2', 11: '#06b6d4', 12: '#ec4899',
};

/** "7a" / "07A" → "07A"; anything that isn't a Camelot code is returned trimmed. */
export function formatCamelotCode(key: string | null | undefined): string {
  const value = (key ?? '').trim();
  const match = value.match(/^(\d{1,2})([AB])$/i);
  if (!match) return value;
  return `${match[1].padStart(2, '0')}${match[2].toUpperCase()}`;
}

/** Camelot wheel color for a key, matching Cue Points; gray when unknown. */
export function camelotKeyColor(key: string | null | undefined): string {
  const match = (key ?? '').trim().match(/^(\d{1,2})[AB]$/i);
  if (!match) return '#6b7280';
  const number = parseInt(match[1], 10);
  return CAMELOT_COLORS[number] ?? '#6b7280';
}
