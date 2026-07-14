import type { BeatEntry } from './beatGridHelpers';
import type { DropPoint } from './dropPointResolver';
import type { RekordboxTrack } from '../../types';

export type DropLabBarCount = 4 | 8 | 16;
export type DropLabBeatOffset = -1 | 0 | 1;

export interface TrackTiming {
  durationMs: number | null;
  usedDurationSource: 'track' | 'beat-grid' | 'none';
}

export interface DropLabTimeSegment {
  startMs: number;
  endMs: number;
  durationMs: number;
  timingSource: 'beat-grid' | 'bpm';
}

export interface DropLabSegments {
  source: DropLabTimeSegment | null;
  candidate: DropLabTimeSegment | null;
  candidateDropMs: number | null;
}

export function resolveTrackDurationMs(
  track: RekordboxTrack,
  beats: BeatEntry[] = [],
): TrackTiming {
  if (track.duration_ms != null && track.duration_ms > 0) {
    return { durationMs: track.duration_ms, usedDurationSource: 'track' };
  }
  if (track.duration_seconds != null && track.duration_seconds > 0) {
    return {
      durationMs: track.duration_seconds * 1000,
      usedDurationSource: 'track',
    };
  }
  const lastBeatMs = beats.at(-1)?.ms;
  if (lastBeatMs != null && lastBeatMs > 0) {
    return { durationMs: lastBeatMs, usedDurationSource: 'beat-grid' };
  }
  return { durationMs: null, usedDurationSource: 'none' };
}

function downbeats(beats: BeatEntry[]): BeatEntry[] {
  return beats.filter((beat) => beat.isDownbeat);
}

function findDownbeatIndexAtOrBefore(beats: BeatEntry[], ms: number): number {
  let result = -1;
  for (let i = 0; i < beats.length; i++) {
    if (beats[i].ms <= ms) result = i;
    else break;
  }
  return result;
}

function averageBeatMs(
  beats: BeatEntry[],
  fallbackBpm: number | null,
): number | null {
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    const delta = beats[i].ms - beats[i - 1].ms;
    if (delta > 0 && delta < 3000) intervals.push(delta);
  }
  if (intervals.length > 0) {
    return intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  }
  if (fallbackBpm != null && fallbackBpm > 0) return 60_000 / fallbackBpm;
  return null;
}

function shiftByBeats(
  ms: number,
  beats: BeatEntry[],
  beatOffset: DropLabBeatOffset,
  fallbackBpm: number | null,
): number {
  if (beatOffset === 0) return ms;
  const nearestIndex = beats.findIndex((beat) => beat.ms >= ms);
  const index = nearestIndex >= 0 ? nearestIndex : beats.length - 1;
  const shifted = beats[index + beatOffset];
  if (shifted) return shifted.ms;
  const beatMs = averageBeatMs(beats, fallbackBpm);
  return beatMs == null ? ms : Math.max(0, ms + beatOffset * beatMs);
}

function bpmWindowMs(
  bpm: number | null,
  barCount: DropLabBarCount,
): number | null {
  if (bpm == null || bpm <= 0) return null;
  return (60_000 / bpm) * 4 * barCount;
}

function segment(
  startMs: number,
  endMs: number,
  durationMs: number | null,
  timingSource: 'beat-grid' | 'bpm',
): DropLabTimeSegment | null {
  const safeStart = Math.max(0, startMs);
  const safeEnd = durationMs != null ? Math.min(durationMs, endMs) : endMs;
  if (
    !Number.isFinite(safeStart) ||
    !Number.isFinite(safeEnd) ||
    safeEnd <= safeStart
  )
    return null;
  return {
    startMs: safeStart,
    endMs: safeEnd,
    durationMs: safeEnd - safeStart,
    timingSource,
  };
}

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
  const sourceDuration = resolveTrackDurationMs(
    input.sourceTrack,
    input.sourceBeats,
  ).durationMs;
  const candidateDuration = resolveTrackDurationMs(
    input.candidateTrack,
    input.candidateBeats,
  ).durationMs;
  if (!input.sourceDrop || !input.candidateDrop) {
    return { source: null, candidate: null, candidateDropMs: null };
  }

  const sourceDownbeats = downbeats(input.sourceBeats);
  const candidateDownbeats = downbeats(input.candidateBeats);

  let sourceSegment: DropLabTimeSegment | null = null;
  const sourceDropIndex = findDownbeatIndexAtOrBefore(
    sourceDownbeats,
    input.sourceDrop.dropMs,
  );
  if (sourceDropIndex >= 0) {
    const start =
      sourceDownbeats[Math.max(0, sourceDropIndex - input.barCount)]?.ms ?? 0;
    sourceSegment = segment(
      start,
      input.sourceDrop.dropMs,
      sourceDuration,
      'beat-grid',
    );
  } else {
    const windowMs = bpmWindowMs(input.sourceTrack.bpm, input.barCount);
    if (windowMs != null) {
      sourceSegment = segment(
        input.sourceDrop.dropMs - windowMs,
        input.sourceDrop.dropMs,
        sourceDuration,
        'bpm',
      );
    }
  }

  const alignedCandidateDropMs = shiftByBeats(
    input.candidateDrop.dropMs,
    input.candidateBeats,
    input.beatOffset,
    input.candidateTrack.bpm,
  );

  let candidateSegment: DropLabTimeSegment | null = null;
  const candidateDropIndex = candidateDownbeats.findIndex(
    (beat) => beat.ms >= alignedCandidateDropMs,
  );
  if (candidateDropIndex >= 0) {
    const end =
      candidateDownbeats[candidateDropIndex + input.barCount]?.ms ??
      candidateDuration ??
      alignedCandidateDropMs;
    candidateSegment = segment(
      alignedCandidateDropMs,
      end,
      candidateDuration,
      'beat-grid',
    );
  } else {
    const windowMs = bpmWindowMs(input.candidateTrack.bpm, input.barCount);
    if (windowMs != null) {
      candidateSegment = segment(
        alignedCandidateDropMs,
        alignedCandidateDropMs + windowMs,
        candidateDuration,
        'bpm',
      );
    }
  }

  return {
    source: sourceSegment,
    candidate: candidateSegment,
    candidateDropMs: alignedCandidateDropMs,
  };
}
