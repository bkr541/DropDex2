import type { BeatEntry } from '../queries/analysisData';

const MAX_TIMELINE_GRID_LINES = 640;
const MAX_BEAT_RULER_TICKS = 640;
const MAX_BAR_LABELS = 24;

export function timelineGridLines(beats: BeatEntry[]): BeatEntry[] {
  if (beats.length <= MAX_TIMELINE_GRID_LINES) return beats;
  const step = Math.ceil(beats.length / MAX_TIMELINE_GRID_LINES);
  const sampled = new Map<number, BeatEntry>();
  beats.forEach((beat, index) => {
    if (beat.isDownbeat || beat.beatInBar === 1 || index % step === 0) sampled.set(beat.seq, beat);
  });
  return [...sampled.values()].sort((a, b) => a.ms - b.ms);
}

export function beatRulerTicks(beats: BeatEntry[]): BeatEntry[] {
  if (beats.length <= MAX_BEAT_RULER_TICKS) return beats;
  const step = Math.ceil(beats.length / MAX_BEAT_RULER_TICKS);
  const sampled = new Map<number, BeatEntry>();
  beats.forEach((beat, index) => {
    if (beat.isDownbeat || beat.beatInBar === 1 || index % step === 0) sampled.set(beat.seq, beat);
  });
  return [...sampled.values()].sort((a, b) => a.ms - b.ms);
}

export function barLabelBeats(beats: BeatEntry[]): BeatEntry[] {
  const downbeats = beats.filter((beat) => beat.isDownbeat || beat.beatInBar === 1);
  if (downbeats.length <= MAX_BAR_LABELS) return downbeats;
  const step = Math.ceil(downbeats.length / MAX_BAR_LABELS);
  return downbeats.filter((_, index) => index % step === 0 || index === downbeats.length - 1);
}
