import { parseCamelotKey } from '../../lib/music/camelot';
import { ROULETTE_DIRECT_BPM_TOLERANCE } from '../../features/roulette/rouletteMatching';

export const FLIP_LAB_MAX_BPM_DIFFERENCE = ROULETTE_DIRECT_BPM_TOLERANCE;

export interface FlipLabTimelineInput {
  vocalDurationSec: number;
  instrumentalDurationSec: number;
  vocalFirstDownbeatSec: number;
  instrumentalFirstDownbeatSec: number;
  vocalBpm: number;
  instrumentalBpm: number;
}

/**
 * One shared transport clock. The instrumental plays at its original tempo;
 * the vocal is stretched by `tempoRatio` so both first downbeats land on the
 * same timeline instant (`downbeatSec`).
 */
export interface FlipLabTimeline {
  tempoRatio: number;
  downbeatSec: number;
  vocalStartSec: number;
  vocalSpanSec: number;
  instrumentalStartSec: number;
  instrumentalSpanSec: number;
  totalSec: number;
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function flipLabBpmDifference(vocalBpm: number | null | undefined, instrumentalBpm: number | null | undefined): number | null {
  if (vocalBpm == null || instrumentalBpm == null || !positive(vocalBpm) || !positive(instrumentalBpm)) return null;
  return Math.abs(vocalBpm - instrumentalBpm);
}

export function computeFlipLabTimeline(input: FlipLabTimelineInput): FlipLabTimeline {
  if (!positive(input.vocalBpm) || !positive(input.instrumentalBpm)) {
    throw new Error('Both tracks need a BPM to be flipped.');
  }
  if (!positive(input.vocalDurationSec) || !positive(input.instrumentalDurationSec)) {
    throw new Error('Both tracks need a length to be flipped.');
  }
  const tempoRatio = input.instrumentalBpm / input.vocalBpm;
  const vocalDownbeat = Math.max(0, input.vocalFirstDownbeatSec) / tempoRatio;
  const instrumentalDownbeat = Math.max(0, input.instrumentalFirstDownbeatSec);
  const downbeatSec = Math.max(vocalDownbeat, instrumentalDownbeat);
  const vocalStartSec = downbeatSec - vocalDownbeat;
  const instrumentalStartSec = downbeatSec - instrumentalDownbeat;
  const vocalSpanSec = input.vocalDurationSec / tempoRatio;
  const instrumentalSpanSec = input.instrumentalDurationSec;
  return {
    tempoRatio,
    downbeatSec,
    vocalStartSec,
    vocalSpanSec,
    instrumentalStartSec,
    instrumentalSpanSec,
    totalSec: Math.max(vocalStartSec + vocalSpanSec, instrumentalStartSec + instrumentalSpanSec),
  };
}

/**
 * Smallest pitch move (−6…+5 semitones) that puts the vocal on the
 * instrumental's Camelot number. One semitone moves 7 steps around the wheel,
 * and a pitch shift never changes major/minor, so a letter mismatch lands on
 * the relative key, which is harmonically compatible.
 */
export function flipLabKeyShiftSemitones(
  vocalCamelot: string | null | undefined,
  instrumentalCamelot: string | null | undefined,
): number | null {
  const vocal = parseCamelotKey(vocalCamelot);
  const instrumental = parseCamelotKey(instrumentalCamelot);
  if (!vocal || !instrumental) return null;
  const steps = (((instrumental.number - vocal.number) % 12) + 12) % 12;
  const semitones = (steps * 7) % 12;
  return semitones > 5 ? semitones - 12 : semitones;
}

export function formatFlipLabTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
