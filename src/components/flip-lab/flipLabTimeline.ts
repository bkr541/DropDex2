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

export interface FlipLabCombinedBeat {
  timeSec: number;
  downbeat: boolean;
  /** Bar number of the new combined track; bar 1 starts at the shared first downbeat. */
  bar: number;
}

const BEATS_PER_BAR = 4;

/**
 * One beat grid for the flipped track. The instrumental is the tempo master and
 * plays unstretched, so its Rekordbox beats are used where it plays; before and
 * after it, beats continue at the instrumental BPM so the grid covers the whole
 * combined timeline.
 */
export function flipLabCombinedBeatGrid(
  timeline: FlipLabTimeline,
  instrumentalBeats: ReadonlyArray<{ ms: number; beatInBar: number }>,
  instrumentalBpm: number,
): FlipLabCombinedBeat[] {
  if (!positive(instrumentalBpm) || !positive(timeline.totalSec)) return [];
  const beatSec = 60 / instrumentalBpm;
  const wrap = (value: number) => ((((value - 1) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR) + 1;

  let beats = instrumentalBeats
    .filter((beat) => Number.isFinite(beat.ms))
    .map((beat) => ({ timeSec: timeline.instrumentalStartSec + beat.ms / 1000, beatInBar: wrap(beat.beatInBar || 1) }))
    .sort((a, b) => a.timeSec - b.timeSec);
  if (beats.length === 0) beats = [{ timeSec: timeline.downbeatSec, beatInBar: 1 }];

  const before: typeof beats = [];
  for (let t = beats[0].timeSec - beatSec, b = wrap(beats[0].beatInBar - 1); t >= -1e-6; t -= beatSec, b = wrap(b - 1)) {
    before.unshift({ timeSec: Math.max(0, t), beatInBar: b });
  }
  const after: typeof beats = [];
  const last = beats[beats.length - 1];
  for (let t = last.timeSec + beatSec, b = wrap(last.beatInBar + 1); t <= timeline.totalSec + 1e-6; t += beatSec, b = wrap(b + 1)) {
    after.push({ timeSec: t, beatInBar: b });
  }
  const all = [...before, ...beats, ...after].filter((beat) => beat.timeSec >= 0 && beat.timeSec <= timeline.totalSec + 1e-6);

  const downbeatIndexes = all.flatMap((beat, index) => (beat.beatInBar === 1 ? [index] : []));
  let anchor = downbeatIndexes[0] ?? -1;
  for (const index of downbeatIndexes) {
    if (Math.abs(all[index].timeSec - timeline.downbeatSec) < Math.abs(all[anchor].timeSec - timeline.downbeatSec)) anchor = index;
  }
  const anchorOrder = downbeatIndexes.indexOf(anchor);
  let barCursor = 0;
  let downbeatOrder = -1;
  return all.map((beat) => {
    if (beat.beatInBar === 1) {
      downbeatOrder += 1;
      barCursor = downbeatOrder - anchorOrder + 1;
    }
    return { timeSec: beat.timeSec, downbeat: beat.beatInBar === 1, bar: barCursor };
  });
}
