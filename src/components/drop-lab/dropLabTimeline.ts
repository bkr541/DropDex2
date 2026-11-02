/** Where a position sits across the visible window, as a percentage. Outside the window it is below 0 or above 100. */
export function percentageAt(position: number, viewStart: number, viewEnd: number): number {
  return ((position - viewStart) / (viewEnd - viewStart)) * 100;
}

/**
 * The part of a span that is on screen, as a left edge and width in percent of the window,
 * or null when none of it is visible. Keeps a section name inside the lane when zoomed in.
 */
export function visibleSpan(
  startBeat: number,
  endBeat: number,
  viewStart: number,
  viewEnd: number,
): { leftPercent: number; widthPercent: number } | null {
  const left = Math.max(0, percentageAt(startBeat, viewStart, viewEnd));
  const right = Math.min(100, percentageAt(endBeat, viewStart, viewEnd));
  if (right - left <= 0) return null;
  return { leftPercent: left, widthPercent: right - left };
}
