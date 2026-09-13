import type { BeatEntry } from './beatGridHelpers';
import type { DropPoint } from './dropPointResolver';
import {
  resolveMusicalBarWindow,
  shiftMusicalAnchorByBeats,
  type MusicalBarCount,
  type MusicalTimeWindow,
} from './musicalWindows';
import type { RekordboxTrack } from '../../types';

export type DropLabBarCount = MusicalBarCount;
export type DropLabBeatOffset = -1 | 0 | 1;

export interface TrackTiming {
  durationMs: number | null;
  usedDurationSource: 'track' | 'none';
}

export type DropLabTimeSegment = MusicalTimeWindow;

export interface DropLabSegments {
  source: DropLabTimeSegment | null;
  candidate: DropLabTimeSegment | null;
  candidateDropMs: number | null;
}

export function resolveTrackDurationMs(
  track: RekordboxTrack,
): TrackTiming {
  if (typeof track.duration_ms === 'number' && Number.isFinite(track.duration_ms) && track.duration_ms > 0) {
    return { durationMs: track.duration_ms, usedDurationSource: 'track' };
  }
  if (typeof track.duration_seconds === 'number' && Number.isFinite(track.duration_seconds) && track.duration_seconds > 0) {
    return {
      durationMs: track.duration_seconds * 1000,
      usedDurationSource: 'track',
    };
  }
  return { durationMs: null, usedDurationSource: 'none' };
}

/**
 * Drop Lab remains a feature adapter: shared musical-window helpers own the
 * beat/downbeat/BPM traversal while Drop Lab owns which side of each drop is
 * auditioned and its optional +/- one-beat candidate nudge.
 */
export function buildDropLabSegments(input: {
  sourceTrack: RekordboxTrack;
  candidateTrack: RekordboxTrack;
  sourceDrop: DropPoint | null;
  candidateDrop: DropPoint | null;
  sourceBeats: BeatEntry[];
  candidateBeats: BeatEntry[];
  barCount: DropLabBarCount;
  beatOffset: DropLabBeatOffset;
}): DropLabSegments {
  const sourceDuration = resolveTrackDurationMs(input.sourceTrack).durationMs;
  const candidateDuration = resolveTrackDurationMs(input.candidateTrack).durationMs;
  if (!input.sourceDrop || !input.candidateDrop) {
    return { source: null, candidate: null, candidateDropMs: null };
  }

  const sourceSegment = resolveMusicalBarWindow({
    beats: input.sourceBeats,
    anchorMs: input.sourceDrop.dropMs,
    barCount: input.barCount,
    direction: 'before',
    durationMs: sourceDuration,
    fallbackBpm: input.sourceTrack.bpm,
  });

  const alignedCandidateDropMs = shiftMusicalAnchorByBeats(
    input.candidateDrop.dropMs,
    input.candidateBeats,
    input.beatOffset,
    input.candidateTrack.bpm,
  );

  const candidateSegment = resolveMusicalBarWindow({
    beats: input.candidateBeats,
    anchorMs: alignedCandidateDropMs,
    barCount: input.barCount,
    direction: 'after',
    durationMs: candidateDuration,
    fallbackBpm: input.candidateTrack.bpm,
  });

  return {
    source: sourceSegment,
    candidate: candidateSegment,
    candidateDropMs: alignedCandidateDropMs,
  };
}
