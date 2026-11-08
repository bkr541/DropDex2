import { segmentWaveformState } from '../../components/drop-lab/segmentWaveformState';
import { sliceWaveformSegment } from '../../lib/music/waveformSegments';
import { formatTime } from '../../lib/music/trackTiming';
import type { BeatGridRow, CueRow } from '../../lib/queries/analysisData';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import type { TimelineBeatLabel, TimelineBeatTick } from '../../components/ui/media';
import { isExactSetLabGrid } from './sectionResolver';
import type { SetLabFiveSlots, SetLabSection, SetLabSlot } from './session';

const MIN_CLIP_WIDTH = 224;

export function layoutSetLabTimeline(slots: SetLabFiveSlots) {
  let totalMs = 0;
  const clips = slots.map((slot) => {
    const durationMs = slot.section.endMs - slot.section.startMs;
    const offsetMs = totalMs;
    totalMs += durationMs;
    return { slot, durationMs, offsetMs };
  });
  const shortestMs = Math.min(...clips.map((clip) => clip.durationMs));
  return {
    clips, totalMs, minWidthPx: Math.ceil(totalMs / shortestMs * MIN_CLIP_WIDTH),
    columns: clips.map(({ durationMs }) => `minmax(0, ${durationMs}fr)`).join(' '),
  };
}

function clipPercent(ms: number, section: Pick<SetLabSection, 'startMs' | 'endMs'>): number {
  return (ms - section.startMs) / (section.endMs - section.startMs) * 100;
}

export function setLabBeatMarkers(slot: SetLabSlot, grid: BeatGridRow | null):
  { ticks: TimelineBeatTick[]; labels: TimelineBeatLabel[]; bpm: string } | null {
  if (!grid || grid.source_tag === 'PQT2' || !Array.isArray(grid.beats) || !isExactSetLabGrid(grid.beats)) return null;
  const { section, barCount } = slot;
  const start = grid.beats.find((beat) => beat.seq === section.startBeat && beat.isDownbeat && beat.ms === section.startMs);
  const end = grid.beats.find((beat) => beat.seq === section.endBeatExclusive && beat.isDownbeat && beat.ms === section.endMs);
  if (!start || !end || end.bar - start.bar !== barCount) return null;

  const beats = grid.beats.filter((beat) => beat.seq >= start.seq && beat.seq < end.seq);
  const tempos = beats.map((beat) => beat.bpm);
  const minBpm = Math.min(...tempos);
  const maxBpm = Math.max(...tempos);
  return {
    ticks: beats.map((beat) => ({
      key: `beat-${beat.seq}`, leftPercent: clipPercent(beat.ms, section), downbeat: beat.isDownbeat,
      title: `Bar ${beat.bar}, beat ${beat.beatInBar} · ${formatTime(beat.ms)}`,
    })),
    labels: beats.flatMap((beat) => {
      const localBar = beat.bar - start.bar + 1;
      return beat.isDownbeat && (barCount <= 8 || localBar % 2 === 1)
        ? [{ key: `bar-${beat.bar}`, leftPercent: clipPercent(beat.ms, section), text: localBar }]
        : [];
    }),
    bpm: minBpm.toFixed(1) === maxBpm.toFixed(1) ? minBpm.toFixed(1) : `${minBpm.toFixed(1)}–${maxBpm.toFixed(1)}`,
  };
}

export function setLabCueMarkers(cues: readonly CueRow[], section: Pick<SetLabSection, 'startMs' | 'endMs'>) {
  let memoryIndex = 0;
  return [...cues].sort((a, b) => (a.start_ms ?? Infinity) - (b.start_ms ?? Infinity) || a.id.localeCompare(b.id))
    .flatMap((cue) => {
      const hot = cue.cue_family === 'hot';
      const label = hot ? (cue.hot_cue_slot && cue.hot_cue_slot >= 1 && cue.hot_cue_slot <= 8
        ? String.fromCharCode(64 + cue.hot_cue_slot) : 'H') : String(++memoryIndex);
      const ms = cue.start_ms;
      if (ms == null || !Number.isFinite(ms) || ms < section.startMs || ms >= section.endMs) return [];
      return [{
        id: cue.id, hot, label, leftPercent: clipPercent(ms, section),
        color: cue.color_hex ?? (hot ? 'var(--color-primary)' : 'var(--color-muted-foreground)'),
        description: `${hot ? 'Hot cue' : 'Memory cue'} ${label} · ${formatTime(ms)}${cue.comment ? ` · ${cue.comment}` : ''}`,
      }];
    });
}

export function sliceSetLabClipWaveform(state: WaveformLoadState, section: Pick<SetLabSection, 'startMs' | 'endMs'>, sourceDurationMs: number | null): WaveformLoadState {
  if (state.status !== 'loaded') return state;
  // A clipped or unknown source duration would misalign the waveform with the ruler.
  if (sourceDurationMs == null || section.endMs > sourceDurationMs) return { status: 'unavailable', trackId: state.trackId };
  return segmentWaveformState(sliceWaveformSegment(state.waveform, section.startMs, section.endMs, sourceDurationMs))
    ?? { status: 'unavailable', trackId: state.trackId };
}
