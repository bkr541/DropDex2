export function clampCueTransportTime(currentSeconds: number, durationSeconds: number, deltaSeconds: number): number {
  const current = Number.isFinite(currentSeconds) ? Math.max(0, currentSeconds) : 0;
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(duration, current + deltaSeconds));
}

export function cueAdjacentTrackIndex(
  orderedTrackIds: string[],
  activeTrackId: string | null | undefined,
  selectedTrackId: string | null | undefined,
  direction: -1 | 1,
): number | null {
  if (orderedTrackIds.length === 0) return null;
  const activeIndex = activeTrackId ? orderedTrackIds.indexOf(activeTrackId) : -1;
  const selectedIndex = selectedTrackId ? orderedTrackIds.indexOf(selectedTrackId) : -1;
  const anchorIndex = activeIndex >= 0 ? activeIndex : selectedIndex;
  const destination = anchorIndex >= 0
    ? anchorIndex + direction
    : direction > 0 ? 0 : orderedTrackIds.length - 1;
  return destination >= 0 && destination < orderedTrackIds.length ? destination : null;
}

export function cuePlaybackPlayheadPercent(currentTimeMs: number, viewStartMs: number, viewEndMs: number): number | null {
  if (!Number.isFinite(currentTimeMs) || !Number.isFinite(viewStartMs) || !Number.isFinite(viewEndMs) || viewEndMs <= viewStartMs) {
    return null;
  }
  if (currentTimeMs < viewStartMs || currentTimeMs > viewEndMs) return null;
  return ((currentTimeMs - viewStartMs) / (viewEndMs - viewStartMs)) * 100;
}
