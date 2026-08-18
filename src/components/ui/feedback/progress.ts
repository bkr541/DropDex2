export function clampProgress(value: number, min = 0, max = 100): number {
  const safeMin = Number.isFinite(min) ? min : 0;
  if (!Number.isFinite(max) || max <= safeMin) return safeMin;
  if (!Number.isFinite(value)) return safeMin;
  return Math.min(max, Math.max(safeMin, value));
}

export function progressPercent(value: number, max = 100): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  return clampProgress((value / max) * 100);
}
