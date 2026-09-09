import type { RekordboxTrack } from '../../types';
import type { RouletteMusicalAnchor } from './rouletteAnchors';
import { isUsableBeatGrid, type BeatEntry } from '../../lib/music/beatGridHelpers';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import { isRouletteDirectTempoCompatible } from './rouletteMatching';
import { resolveRouletteTempoPlan, type RouletteTempoPlan } from './rouletteTempoSync';

export interface RouletteAlignmentSource {
  track: Pick<RekordboxTrack, 'id' | 'bpm'>;
  beatGrid: BeatGridRow | null;
  musicalAnchor?: RouletteMusicalAnchor | null;
}

export interface RouletteDeckAlignment {
  anchorBeat: BeatEntry | null;
  sourceOffsetSeconds: number;
}

export interface RouletteAlignment {
  vocal: RouletteDeckAlignment;
  instrumental: RouletteDeckAlignment;
  masterBpm: number;
  barDurationSeconds: number;
  tempo: RouletteTempoPlan;
}

function validBpm(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Pick the first exact stored downbeat that can act as virtual Roulette bar 1.
 * Rekordbox grids can include pre-roll beats marked bar 0, so prefer a positive
 * source bar and fail closed instead of inventing an average-BPM timestamp.
 */
export function firstRouletteDownbeat(beatGrid: BeatGridRow | null): BeatEntry | null {
  if (!beatGrid || !isUsableBeatGrid(beatGrid.beats)) return null;
  return beatGrid.beats.find((beat) => (
    beat.isDownbeat && beat.beatInBar === 1 && beat.bar > 0
  )) ?? beatGrid.beats.find((beat) => beat.isDownbeat && beat.beatInBar === 1) ?? null;
}

/**
 * Resolve two parent-track timelines onto one virtual Roulette bar origin.
 * Stems preserve parent time zero, so the returned offsets can be applied
 * directly to their decoded stem buffers.
 */
export function resolveRouletteAlignment(
  vocal: RouletteAlignmentSource,
  instrumental: RouletteAlignmentSource,
): RouletteAlignment {
  if (!validBpm(vocal.track.bpm) || !validBpm(instrumental.track.bpm)) {
    throw new Error('Roulette playback requires BPM metadata for both parent tracks.');
  }
  if (!isRouletteDirectTempoCompatible(vocal.track.bpm, instrumental.track.bpm)) {
    throw new Error('Roulette playback requires a direct-tempo pair inside the supported BPM range.');
  }

  if (vocal.beatGrid?.is_variable_tempo === true || instrumental.beatGrid?.is_variable_tempo === true) {
    throw new Error('Roulette pitch-locked playback does not support variable-tempo beat grids.');
  }

  const vocalAnchor = vocal.musicalAnchor?.anchorBeat ?? firstRouletteDownbeat(vocal.beatGrid);
  const instrumentalAnchor = instrumental.musicalAnchor?.anchorBeat ?? firstRouletteDownbeat(instrumental.beatGrid);
  const vocalOffsetMs = vocal.musicalAnchor?.sourceTimeMs ?? vocalAnchor?.ms ?? null;
  const instrumentalOffsetMs = instrumental.musicalAnchor?.sourceTimeMs ?? instrumentalAnchor?.ms ?? null;
  if (vocalOffsetMs == null || instrumentalOffsetMs == null) {
    throw new Error('Roulette playback requires a resolved musical anchor for both parent tracks.');
  }

  const tempo = resolveRouletteTempoPlan(vocal.track.bpm, instrumental.track.bpm);
  const masterBpm = tempo.masterBpm;
  return {
    vocal: {
      anchorBeat: vocalAnchor,
      sourceOffsetSeconds: vocalOffsetMs / 1000,
    },
    instrumental: {
      anchorBeat: instrumentalAnchor,
      sourceOffsetSeconds: instrumentalOffsetMs / 1000,
    },
    masterBpm,
    barDurationSeconds: 240 / masterBpm,
    tempo,
  };
}

export function buildRouletteBarFractions(
  durationSeconds: number,
  barDurationSeconds: number,
  maximumMarkers = 96,
): number[] {
  if (
    !Number.isFinite(durationSeconds) || durationSeconds <= 0
    || !Number.isFinite(barDurationSeconds) || barDurationSeconds <= 0
    || !Number.isInteger(maximumMarkers) || maximumMarkers <= 0
  ) return [];

  const barCount = Math.min(maximumMarkers, Math.floor(durationSeconds / barDurationSeconds) + 1);
  return Array.from({ length: barCount }, (_, index) => Math.min(1, (index * barDurationSeconds) / durationSeconds));
}
