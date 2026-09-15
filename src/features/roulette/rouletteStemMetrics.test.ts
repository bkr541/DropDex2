import { describe, expect, it } from 'vitest';
import { normalizeStemAudioMetrics, summarizeStemWindow, type StemAudioMetrics } from './rouletteStemMetrics';

function metrics(bins: StemAudioMetrics['bins']): StemAudioMetrics {
  return {
    version: 'roulette-stem-metrics-v1',
    durationMs: 4000,
    rms: 0.05,
    signalRatio: 0.5,
    usableNonSilentDurationMs: 3000,
    activityEvidence: 0.6,
    energyStability: 0.7,
    suitabilityScore: 0.65,
    bins,
  };
}

describe('Roulette stem window metrics', () => {
  it('summarizes overlapping bins and prefers a stable active instrumental window', () => {
    const source = metrics([
      { startMs: 0, endMs: 1000, rms: 0.05, signalRatio: 0.9, nonSilentRatio: 0.9 },
      { startMs: 1000, endMs: 2000, rms: 0.051, signalRatio: 0.9, nonSilentRatio: 0.9 },
      { startMs: 2000, endMs: 3000, rms: 0.005, signalRatio: 0.1, nonSilentRatio: 0.1 },
      { startMs: 3000, endMs: 4000, rms: 0.09, signalRatio: 0.9, nonSilentRatio: 0.9 },
    ]);
    const stable = summarizeStemWindow(source, 0, 2000, 'instrumental');
    const unstable = summarizeStemWindow(source, 2000, 4000, 'instrumental');
    expect(stable?.score).toBeGreaterThan(unstable?.score ?? 1);
    expect(stable?.coveredMs).toBe(2000);
  });

  it('returns null for malformed metrics rather than creating a hard rejection signal', () => {
    expect(normalizeStemAudioMetrics({ version: 'x', bins: 'bad' })).toBeNull();
    expect(summarizeStemWindow(null, 0, 1000, 'vocal')).toBeNull();
  });
});
