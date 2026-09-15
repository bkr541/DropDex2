import type { RouletteSourceRole } from './rouletteSession';
import { isRouletteDirectTempoCompatible } from './rouletteMatching';

/**
 * WSOLA is only entered after the canonical Stage 2 direct-tempo filter passes.
 * These broad sanity bounds protect DSP from corrupt metadata; they are not a
 * second musical matching rule.
 */
export const ROULETTE_MIN_TEMPO_RATIO = 0.5;
export const ROULETTE_MAX_TEMPO_RATIO = 2;
export const ROULETTE_TEMPO_RATIO_EPSILON = 1e-6;

export interface RouletteDeckTempoPlan {
  role: RouletteSourceRole;
  sourceBpm: number;
  targetBpm: number;
  /** Source playback tempo multiplier needed to reach the target BPM. */
  tempoRatio: number;
  /** Processed duration divided by source duration. */
  durationScale: number;
  requiresPitchLockedProcessing: boolean;
}

export interface RouletteTempoPlan {
  masterRole: RouletteSourceRole;
  masterBpm: number;
  vocal: RouletteDeckTempoPlan;
  instrumental: RouletteDeckTempoPlan;
}

function validBpm(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function calculateRouletteTempoRatio(
  sourceBpm: number | null | undefined,
  targetBpm: number | null | undefined,
): number | null {
  if (!validBpm(sourceBpm) || !validBpm(targetBpm)) return null;
  return targetBpm / sourceBpm;
}

export function isRouletteTempoRatioSupported(
  sourceBpm: number | null | undefined,
  targetBpm: number | null | undefined,
): boolean {
  const ratio = calculateRouletteTempoRatio(sourceBpm, targetBpm);
  return ratio != null
    && ratio >= ROULETTE_MIN_TEMPO_RATIO - ROULETTE_TEMPO_RATIO_EPSILON
    && ratio <= ROULETTE_MAX_TEMPO_RATIO + ROULETTE_TEMPO_RATIO_EPSILON
    && isRouletteDirectTempoCompatible(sourceBpm, targetBpm);
}

function deckPlan(
  role: RouletteSourceRole,
  sourceBpm: number,
  targetBpm: number,
): RouletteDeckTempoPlan {
  const tempoRatio = calculateRouletteTempoRatio(sourceBpm, targetBpm);
  if (tempoRatio == null || !isRouletteTempoRatioSupported(sourceBpm, targetBpm)) {
    throw new Error(`Roulette cannot pitch-lock ${sourceBpm} BPM to ${targetBpm} BPM outside the canonical ±5 BPM domain.`);
  }

  return {
    role,
    sourceBpm,
    targetBpm,
    tempoRatio,
    durationScale: 1 / tempoRatio,
    requiresPitchLockedProcessing: Math.abs(tempoRatio - 1) > ROULETTE_TEMPO_RATIO_EPSILON,
  };
}

/**
 * The instrumental is the stable underlying mix bed and owns Roulette's
 * transport BPM. The vocal deck is pitch-preserving time-stretched to it.
 */
export function resolveRouletteTempoPlan(
  vocalBpm: number | null | undefined,
  instrumentalBpm: number | null | undefined,
): RouletteTempoPlan {
  if (!validBpm(vocalBpm) || !validBpm(instrumentalBpm)) {
    throw new Error('Roulette tempo sync requires BPM metadata for both parent tracks.');
  }

  const masterRole: RouletteSourceRole = 'instrumental';
  const masterBpm = instrumentalBpm;
  return {
    masterRole,
    masterBpm,
    vocal: deckPlan('vocal', vocalBpm, masterBpm),
    instrumental: deckPlan('instrumental', instrumentalBpm, masterBpm),
  };
}

export function rouletteOutputDurationSeconds(
  sourceDurationSeconds: number,
  plan: Pick<RouletteDeckTempoPlan, 'durationScale'>,
): number {
  if (!Number.isFinite(sourceDurationSeconds) || sourceDurationSeconds < 0) return 0;
  return sourceDurationSeconds * plan.durationScale;
}

export function rouletteSourceDurationSeconds(
  outputDurationSeconds: number,
  plan: Pick<RouletteDeckTempoPlan, 'tempoRatio'>,
): number {
  if (!Number.isFinite(outputDurationSeconds) || outputDurationSeconds < 0) return 0;
  return outputDurationSeconds * plan.tempoRatio;
}
