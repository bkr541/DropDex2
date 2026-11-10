import { TrackTimeline } from '../ui/media/TrackTimeline';
import { waveformSectionInk as sectionInk } from '../ui/media/waveformPresentation';
import { WaveformCueMarker } from '../ui/media/WaveformCueMarker';
import { useMemo, type ReactNode } from 'react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';
import { barLabelBeats, beatRulerTicks } from '../../lib/cues/beatRuler';
import { isUsableBeatGrid } from '../../lib/music/beatGridHelpers';
import type { TimelineSection } from '../../lib/music/phraseSections';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { type WaveformColorSegment } from '../library/RekordboxPreviewWaveform';
import { formatClock, timeRulerTicks } from './auditionTracks';
import type { AuditionCueMarker } from './useAuditionTrackAnalysis';
import type { RekordboxTrack } from '../../types';

interface AuditionFullSongProps {
  /** Cue points for the selected track, drawn above the waveform. */
  cues?: AuditionCueMarker[];
  /** The track's beat grid, drawn as a ruler under the waveform. */
  beatGrid?: BeatGridRow | null;
  track: RekordboxTrack | null;
  durationMs: number | null;
  waveformState: WaveformLoadState;
  onRetryWaveform: () => void;
  sections: TimelineSection[];
  sectionsLoading: boolean;
  /** Plain-language reason the sections could not be loaded, if that happened. */
  sectionsError: string | null;
  onRetrySections: () => void;
  /** A ToolbarRow above the timeline (Keep, Maybe and Remove). */
  toolbar?: ReactNode;
  /** Playback controls, shown along the bottom of the panel. */
  children?: ReactNode;
}


export function AuditionFullSong({
  track, durationMs, waveformState, onRetryWaveform, sections, sectionsLoading, sectionsError, onRetrySections, cues = [], beatGrid = null, toolbar, children,
}: AuditionFullSongProps) {
  const { activeTrack, seek, getAudioElement } = useAudioPlayer();
  const progress = useWaveformProgress(track?.id);
  const isActive = Boolean(track && activeTrack?.id === track.id);

  const ticks = useMemo(() => timeRulerTicks(durationMs), [durationMs]);
  const beats = useMemo(() => (beatGrid && isUsableBeatGrid(beatGrid.beats) ? beatGrid.beats : []), [beatGrid]);
  const beatTicks = useMemo(() => beatRulerTicks(beats), [beats]);
  const barLabels = useMemo(() => barLabelBeats(beats), [beats]);
  const colorSegments = useMemo<WaveformColorSegment[]>(() => {
    if (durationMs == null || durationMs <= 0) return [];
    return sections.map((section) => ({
      startFraction: section.startMs / durationMs,
      endFraction: section.endMs / durationMs,
      color: sectionInk(section.label, true),
    }));
  }, [durationMs, sections]);

  // Clicking only jumps within a track that is already loaded in the player.
  function handleSeek(fraction: number) {
    const audio = getAudioElement();
    if (!isActive || !audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    seek(fraction * audio.duration);
  }

  const hasDuration = durationMs != null && durationMs > 0;
  let memoryCueNumber = 0;
  const cueFlags = hasDuration ? cues.map((cue) => ({ ...cue, markerLabel: cue.label ?? String(++memoryCueNumber) })) : [];
  return (
    <section
      data-testid="audition-full-song"
      aria-label="Full song"
      className="audition-song"
    >
      {toolbar}
      <TrackTimeline
        highlightDrops
        start={0} end={durationMs ?? 0} timeTicks={hasDuration ? ticks : []}
        testIds={{ sections: 'audition-sections', section: 'audition-section', blank: 'audition-section-blank', cues: 'audition-cues', beats: 'audition-beat-grid', beatLead: 'audition-beat-lead' }}
        sections={hasDuration ? sections.map((section) => ({
          id: section.id, label: section.label, color: sectionInk(section.label, true),
          leftPercent: section.startMs / durationMs * 100,
          widthPercent: (section.endMs - section.startMs) / durationMs * 100,
          title: section.label + ' · ' + formatClock(section.startMs) + '–' + formatClock(section.endMs),
        })) : []}
        sectionMessage={sectionsLoading ? (
          <p className="absolute inset-0 flex items-center text-xs text-muted-foreground" role="status">Loading sections…</p>
        ) : track && sections.length === 0 ? (
          <p className="absolute inset-0 flex items-center text-xs text-muted-foreground" role={sectionsError ? 'alert' : 'status'}>
            {sectionsError ?? 'No sections were found for this track.'}
            {sectionsError ? <button type="button" className="ml-2 font-medium text-primary underline underline-offset-2" onClick={onRetrySections}>Try again</button> : null}
          </p>
        ) : undefined}
        cues={cueFlags.map((cue) => (
          <WaveformCueMarker key={cue.id} data-testid="audition-cue"
            title={`${cue.label ? `Cue ${cue.label}` : 'Memory cue'} · ${formatClock(cue.startMs)}`}
            label={cue.markerLabel} color={cue.color} memory={!cue.label} role="img"
            aria-label={`${cue.label ? `Cue ${cue.label}` : 'Memory cue'} · ${formatClock(cue.startMs)}`}
            style={{ left: `${Math.min(100, Math.max(0, (cue.startMs / durationMs) * 100))}%` }} />
        ))}
        waveforms={[{ id: track?.id ?? 'empty', state: waveformState, colorSegments,
          activeProgress: isActive ? progress : undefined, onSeek: isActive ? handleSeek : undefined,
          onRetry: onRetryWaveform, ariaLabel: track ? `Full waveform for ${track.title}` : 'Full waveform' }]}
        cueLines={cueFlags.map((cue) => ({ id: cue.id, leftPercent: cue.startMs / durationMs * 100, label: cue.markerLabel, color: cue.color }))}
        beatTicks={hasDuration ? beatTicks.map((beat) => ({ key: String(beat.seq), leftPercent: beat.ms / durationMs * 100,
          downbeat: beat.isDownbeat || beat.beatInBar === 1, title: `Bar ${beat.bar}, beat ${beat.beatInBar} · ${formatClock(beat.ms)}` })) : []}
        beatLabels={hasDuration ? barLabels.map((beat) => ({ key: String(beat.seq), leftPercent: beat.ms / durationMs * 100, text: beat.bar })) : []}
        beatMessage={sectionsLoading ? 'Loading beat grid…' : !hasDuration || beatTicks.length === 0 ? 'No beat grid' : undefined}
      />

      {children ? (
        <div className="audition-song-transport">{children}</div>
      ) : <div className="h-3" />}
    </section>
  );
}
