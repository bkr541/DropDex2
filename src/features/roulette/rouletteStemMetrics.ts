import type { RouletteSourceRole } from './rouletteSession';

export const ROULETTE_STEM_METRICS_VERSION = 'roulette-stem-metrics-v1' as const;

export interface StemAudioMetricBin {
  startMs: number;
  endMs: number;
  rms: number;
  signalRatio: number;
  nonSilentRatio: number;
}

export interface StemAudioMetrics {
  version: string;
  durationMs: number;
  rms: number;
  signalRatio: number;
  usableNonSilentDurationMs: number;
  activityEvidence: number;
  energyStability: number;
  suitabilityScore: number;
  bins: StemAudioMetricBin[];
}

export interface StemWindowMetricSummary {
  score: number;
  rms: number;
  signalRatio: number;
  nonSilentRatio: number;
  energyStability: number;
  coveredMs: number;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function unit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function validBin(value: unknown): value is StemAudioMetricBin {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const bin = value as Record<string, unknown>;
  return finiteNumber(bin.startMs)
    && finiteNumber(bin.endMs)
    && finiteNumber(bin.rms)
    && finiteNumber(bin.signalRatio)
    && finiteNumber(bin.nonSilentRatio)
    && bin.startMs >= 0
    && bin.endMs > bin.startMs;
}

/**
 * Metrics are supplemental evidence only. Invalid/missing data degrades to null
 * and must never become a hard Roulette eligibility gate.
 */
export function normalizeStemAudioMetrics(value: unknown): StemAudioMetrics | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const metrics = value as Record<string, unknown>;
  if (
    typeof metrics.version !== 'string'
    || !finiteNumber(metrics.durationMs)
    || !finiteNumber(metrics.rms)
    || !finiteNumber(metrics.signalRatio)
    || !finiteNumber(metrics.usableNonSilentDurationMs)
    || !finiteNumber(metrics.activityEvidence)
    || !finiteNumber(metrics.energyStability)
    || !finiteNumber(metrics.suitabilityScore)
    || !Array.isArray(metrics.bins)
  ) return null;

  const bins = metrics.bins.filter(validBin).map((bin) => ({
    startMs: Math.max(0, bin.startMs),
    endMs: Math.max(0, bin.endMs),
    rms: unit(bin.rms),
    signalRatio: unit(bin.signalRatio),
    nonSilentRatio: unit(bin.nonSilentRatio),
  }));
  if (metrics.bins.length > 0 && bins.length === 0) return null;

  return {
    version: metrics.version,
    durationMs: Math.max(0, metrics.durationMs),
    rms: unit(metrics.rms),
    signalRatio: unit(metrics.signalRatio),
    usableNonSilentDurationMs: Math.max(0, metrics.usableNonSilentDurationMs),
    activityEvidence: unit(metrics.activityEvidence),
    energyStability: unit(metrics.energyStability),
    suitabilityScore: unit(metrics.suitabilityScore),
    bins,
  };
}

function energyScore(rms: number): number {
  // 0.08 normalized RMS is already substantial for a separated stem. Saturate
  // there so loudness is evidence, not an incentive to choose the loudest clip.
  return unit(rms / 0.08);
}

function stability(values: Array<{ value: number; weight: number }>, mean: number): number {
  const totalWeight = values.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0 || mean <= 0.00001) return 0;
  const variance = values.reduce(
    (sum, entry) => sum + entry.weight * ((entry.value - mean) ** 2),
    0,
  ) / totalWeight;
  const coefficient = Math.sqrt(variance) / Math.max(mean, 0.00001);
  return unit(1 - coefficient);
}

export function summarizeStemWindow(
  rawMetrics: unknown,
  startMs: number,
  endMs: number,
  role: RouletteSourceRole,
): StemWindowMetricSummary | null {
  const metrics = normalizeStemAudioMetrics(rawMetrics);
  if (!metrics || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const overlaps = metrics.bins.flatMap((bin) => {
    const overlapStart = Math.max(startMs, bin.startMs);
    const overlapEnd = Math.min(endMs, bin.endMs);
    const weight = Math.max(0, overlapEnd - overlapStart);
    return weight > 0 ? [{ bin, weight }] : [];
  });
  const coveredMs = overlaps.reduce((sum, entry) => sum + entry.weight, 0);
  if (coveredMs <= 0) return null;

  const weighted = (selector: (bin: StemAudioMetricBin) => number) => (
    overlaps.reduce((sum, entry) => sum + selector(entry.bin) * entry.weight, 0) / coveredMs
  );
  const rms = weighted((bin) => bin.rms);
  const signalRatio = weighted((bin) => bin.signalRatio);
  const nonSilentRatio = weighted((bin) => bin.nonSilentRatio);
  const energyStability = stability(
    overlaps.map((entry) => ({ value: entry.bin.rms, weight: entry.weight })),
    rms,
  );
  const normalizedEnergy = energyScore(rms);
  const coverage = unit(coveredMs / (endMs - startMs));

  const score = role === 'vocal'
    ? unit((0.38 * signalRatio) + (0.34 * nonSilentRatio) + (0.18 * normalizedEnergy) + (0.10 * coverage))
    : unit((0.30 * signalRatio) + (0.30 * nonSilentRatio) + (0.22 * normalizedEnergy) + (0.18 * energyStability));

  return { score, rms, signalRatio, nonSilentRatio, energyStability, coveredMs };
}
