export type RangeEnd = 'minimum' | 'maximum';

/**
 * What typing a number into one end of the range does. Returns the new range, or null when
 * there is nothing usable to apply (empty, or no digits). The number is kept inside the
 * limits, and one end can reach the other but never cross it.
 */
export function commitTypedBound(
  end: RangeEnd,
  text: string,
  range: [number, number],
  bounds: [number, number],
): [number, number] | null {
  const digits = text.replace(/\D/g, '');
  if (digits === '') return null;
  const typed = Number.parseInt(digits, 10);
  if (!Number.isFinite(typed)) return null;
  const [lo, hi] = range;
  if (end === 'minimum') return [Math.max(bounds[0], Math.min(typed, hi)), hi];
  return [lo, Math.min(bounds[1], Math.max(typed, lo))];
}
