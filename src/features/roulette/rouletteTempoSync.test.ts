import { describe, expect, it } from 'vitest';
import {
  calculateRouletteTempoRatio,
  isRouletteTempoRatioSupported,
  resolveRouletteTempoPlan,
  rouletteOutputDurationSeconds,
  rouletteSourceDurationSeconds,
} from './rouletteTempoSync';

describe('Roulette pitch-locked tempo plan', () => {
  it('selects the instrumental deck as the deterministic master', () => {
    const plan = resolveRouletteTempoPlan(140, 142);
    expect(plan.masterRole).toBe('instrumental');
    expect(plan.masterBpm).toBe(142);
    expect(plan.vocal.tempoRatio).toBeCloseTo(142 / 140, 12);
    expect(plan.vocal.durationScale).toBeCloseTo(140 / 142, 12);
    expect(plan.vocal.requiresPitchLockedProcessing).toBe(true);
    expect(plan.instrumental.tempoRatio).toBe(1);
    expect(plan.instrumental.requiresPitchLockedProcessing).toBe(false);
  });

  it('keeps ratio=1.0 on the zero-processing path', () => {
    const plan = resolveRouletteTempoPlan(142, 142);
    expect(plan.vocal.tempoRatio).toBe(1);
    expect(plan.vocal.durationScale).toBe(1);
    expect(plan.vocal.requiresPitchLockedProcessing).toBe(false);
  });

  it('accepts the complete canonical ±5 BPM domain and rejects values beyond it', () => {
    expect(isRouletteTempoRatioSupported(137, 142)).toBe(true);
    expect(isRouletteTempoRatioSupported(147, 142)).toBe(true);
    expect(isRouletteTempoRatioSupported(136.99, 142)).toBe(false);
    expect(isRouletteTempoRatioSupported(147.01, 142)).toBe(false);
    expect(calculateRouletteTempoRatio(137, 142)).toBeCloseTo(142 / 137, 12);
  });

  it('maps source and target durations without accumulating long-window drift', () => {
    const plan = resolveRouletteTempoPlan(140, 142).vocal;
    const masterBarSeconds = 240 / 142;
    const acceptanceBars = 64;
    const targetDuration = masterBarSeconds * acceptanceBars;
    const requiredSourceDuration = rouletteSourceDurationSeconds(targetDuration, plan);
    const mappedOutputDuration = rouletteOutputDurationSeconds(requiredSourceDuration, plan);

    expect(mappedOutputDuration).toBeCloseTo(targetDuration, 10);
    expect(Math.abs(mappedOutputDuration - targetDuration) * 1000).toBeLessThan(0.001);
  });
});
