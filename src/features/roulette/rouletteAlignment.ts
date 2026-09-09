import type { RekordboxTrack } from '../../types';
import { isUsableBeatGrid, type BeatEntry } from '../../lib/music/beatGridHelpers';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import { isRouletteDirectTempoCompatible } from './rouletteMatching';

export interface RouletteAlignmentSource {
  track: Pick<RekordboxTrack, 'id' | 'bpm'>;
  beatGrid: BeatGridRow | null;
}

export interface RouletteDeckAlignment {
  anchorBeat: BeatEntry;
  sourceOffsetSeconds: number;
}

export interface RouletteAlignment {
  vocal: RouletteDeckAlignment;
  instrumental: RouletteDeckAlignment;
  masterBpm: number;
  barDurationSeconds: number;
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
    throw new Error('Roulette playback requires an exact or nearly exact direct-tempo pair.');
  }

  const vocalAnchor = firstRouletteDownbeat(vocal.beatGrid);
  const instrumentalAnchor = firstRouletteDownbeat(instrumental.beatGrid);
  if (!vocalAnchor || !instrumentalAnchor) {
    throw new Error('Roulette playback requires a usable downbeat grid for both parent tracks.');
  }

  // The instrumental deck is the underlying mix bed and therefore owns the
  // virtual transport BPM until the later pitch-preserving tempo stage exists.
  const masterBpm = instrumental.track.bpm;
  return {
    vocal: {
      anchorBeat: vocalAnchor,
      sourceOffsetSeconds: vocalAnchor.ms / 1000,
    },
    instrumental: {
      anchorBeat: instrumentalAnchor,
      sourceOffsetSeconds: instrumentalAnchor.ms / 1000,
    },
    masterBpm,
    barDurationSeconds: 240 / masterBpm,
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
