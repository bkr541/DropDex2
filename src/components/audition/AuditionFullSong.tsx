import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';
import { barLabelBeats, beatRulerTicks } from '../../lib/cues/beatRuler';
import { isUsableBeatGrid } from '../../lib/music/beatGridHelpers';
import type { TimelineSection } from '../../lib/music/phraseSections';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { RekordboxPreviewWaveform, type WaveformColorSegment } from '../library/RekordboxPreviewWaveform';
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
  /** Playback controls, shown along the bottom of the panel. */
  children?: ReactNode;
}

const WAVEFORM_HEIGHT = 72;

function sectionInk(label: string) {
  return /drop|chorus/i.test(label) ? '#F78361' : '#8997AE';
}

export function AuditionFullSong({
  track, durationMs, waveformState, onRetryWaveform, sections, sectionsLoading, sectionsError, onRetrySections, cues = [], beatGrid = null, children,
}: AuditionFullSongProps) {
  const { activeTrack, seek, getAudioElement } = useAudioPlayer();
  const progress = useWaveformProgress(track?.id);
  const isActive = Boolean(track && activeTrack?.id === track.id);

  const ticks = useMemo(() => timeRulerTicks(durationMs), [durationMs]);
  const beats = useMemo(() => (beatGrid && isUsableBeatGrid(beatGrid.beats) ? beatGrid.beats : []), [beatGrid]);
  const beatTicks = useMemo(() => beatRulerTicks(beats), [beats]);
  const barLabels = useMemo(() => barLabelBeats(beats), [beats]);
  // The space between the first two beats, used to carry the beat ticks back into the lead-in space.
  const beatPeriodMs = beats.length >= 2 && beats[1].ms > beats[0].ms ? beats[1].ms - beats[0].ms : null;
  const colorSegments = useMemo<WaveformColorSegment[]>(() => {
    if (durationMs == null || durationMs <= 0) return [];
    return sections.map((section) => ({
      startFraction: section.startMs / durationMs,
      endFraction: section.endMs / durationMs,
      color: sectionInk(section.label),
    }));
  }, [durationMs, sections]);

  // Clicking only jumps within a track that is already loaded in the player.
  function handleSeek(fraction: number) {
    const audio = getAudioElement();
    if (!isActive || !audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    seek(fraction * audio.duration);
  }

  const hasDuration = durationMs != null && durationMs > 0;
  // Where the last section stops. The rest of the song is drawn as a blank section so the row always spans the full width.
  const lastSectionEndMs = sections.reduce((latest, section) => Math.max(latest, section.endMs), 0);
  const blankStartPercent = hasDuration && sections.length > 0 && lastSectionEndMs < durationMs ? (lastSectionEndMs / durationMs) * 100 : null;

  return (
    <section
      data-testid="audition-full-song"
      aria-label="Full song"
      className="audition-song"
    >
      <div className="audition-song-timeline">
        <h3 className="sr-only">Full song</h3>
        {hasDuration && cues.length > 0 && (
          <div className="audition-song-cues relative h-[22px]" data-testid="audition-cues" aria-label="Cue points">
            {cues.map((cue) => (
              <span
                key={cue.id}
                data-testid="audition-cue"
                title={`${cue.label ? `Cue ${cue.label}` : 'Memory cue'} · ${formatClock(cue.startMs)}`}
                className={cue.label ? 'audition-cue-marker' : 'audition-cue-marker audition-cue-marker--memory'}
                style={{ left: `${Math.min(100, Math.max(0, (cue.startMs / durationMs) * 100))}%`, '--audition-cue-ink': cue.color } as CSSProperties}
              >
                {cue.label}
              </span>
            ))}
          </div>
        )}

        {/* Sections sit under the cue points, so each section lines up with the waveform below it. */}
        <div className="audition-lane">
        <div className="audition-song-sections relative h-7" data-testid="audition-sections">
          {hasDuration && sections.map((section, index) => {
            // A section that opens the song also takes the lead-in space, so a short first section can still show its name.
            const opensSong = index === 0 && section.startMs / durationMs < 0.02;
            const left = (section.startMs / durationMs) * 100;
            const width = ((section.endMs - section.startMs) / durationMs) * 100;
            return (
            <div
              key={section.id}
              data-testid="audition-section"
              title={`${section.label} · ${formatClock(section.startMs)}–${formatClock(section.endMs)}`}
              className="audition-section absolute top-0 flex h-full items-center justify-center overflow-hidden px-1"
              style={{
                left: opensSong ? `calc(${left}% - var(--audition-lead))` : `${left}%`,
                width: opensSong ? `calc(${width}% - 2px + var(--audition-lead))` : `calc(${width}% - 2px)`,
                '--audition-section-ink': sectionInk(section.label),
              } as CSSProperties}
            >
              <span className="truncate">{section.label}</span>
            </div>
            );
          })}
          {blankStartPercent != null && (
            <div
              data-testid="audition-section-blank"
              aria-hidden="true"
              className="audition-section audition-section--blank absolute top-0 h-full"
              style={{ left: `${blankStartPercent}%`, width: `${100 - blankStartPercent}%` }}
            />
          )}
          {track && !sectionsLoading && sections.length === 0 ? (
            <p className="absolute inset-0 flex items-center text-xs text-muted-foreground" role={sectionsError ? 'alert' : 'status'}>
              {sectionsError ?? 'No sections were found for this track.'}
              {sectionsError ? (
                <button type="button" className="ml-2 font-medium text-primary underline underline-offset-2" onClick={onRetrySections}>
                  Try again
                </button>
              ) : null}
            </p>
          ) : null}
          {sectionsLoading ? (
            <p className="absolute inset-0 flex items-center text-xs text-muted-foreground" role="status">Loading sections…</p>
          ) : null}
        </div>
        </div>

        {/* Cue points, sections, ruler and waveform share this width, so a time lines up in all three. */}
        <div className="audition-song-ruler relative h-4" aria-hidden="true">
          {hasDuration && ticks.map((tick) => (
            <span
              key={tick.ms}
              className="absolute top-0 font-mono text-[10px] tabular-nums text-muted-foreground"
              style={tick.ms === 0 ? { left: 0 } : { left: `${(tick.ms / durationMs) * 100}%`, transform: 'translateX(-50%)' }}
            >
              {tick.label}
            </span>
          ))}
        </div>

        <div className="relative">
          <RekordboxPreviewWaveform
            state={waveformState}
            height={WAVEFORM_HEIGHT}
            variant="detail"
            appearance="rekordbox"
            renderMode="area"
            showCenterLine={false}
            surface={false}
            colorSegments={colorSegments}
            activeProgress={isActive ? progress : undefined}
            onSeek={isActive ? handleSeek : undefined}
            onRetry={onRetryWaveform}
            ariaLabel={track ? `Full waveform for ${track.title}` : 'Full waveform'}
            className="w-full"
          />
          {hasDuration && cues.map((cue) => (
            <span
              key={`cue-line-${cue.id}`}
              aria-hidden="true"
              className="audition-cue-line pointer-events-none absolute bottom-0 top-0 w-px"
              style={{ left: `${Math.min(100, Math.max(0, (cue.startMs / durationMs) * 100))}%`, '--audition-cue-ink': cue.color } as CSSProperties}
            />
          ))}
          {hasDuration && ticks.slice(1).map((tick) => (
            <span
              key={`line-${tick.ms}`}
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-white/[0.06]"
              style={{ left: `${(tick.ms / durationMs) * 100}%` }}
            />
          ))}
        </div>

        <div className="audition-lane audition-lane--clip">
        <div data-testid="audition-beat-grid" className="audition-song-beats">
          {sectionsLoading ? (
            <p className="audition-beat-message" role="status">Loading beat grid…</p>
          ) : !hasDuration || beatTicks.length === 0 ? (
            <p className="audition-beat-message">No beat grid</p>
          ) : (
            <>
              {beatPeriodMs != null && (
                <span
                  data-testid="audition-beat-lead"
                  aria-hidden="true"
                  className="audition-beat-lead"
                  style={{
                    width: `calc(var(--audition-lead) + ${(beats[0].ms / durationMs) * 100}%)`,
                    '--audition-beat-gap': `calc(${beatPeriodMs / durationMs} * 100cqw)`,
                  } as CSSProperties}
                />
              )}
              {beatTicks.map((beat) => (
                <span
                  key={`beat-${beat.seq}`}
                  className={beat.isDownbeat || beat.beatInBar === 1 ? 'audition-beat-tick audition-beat-tick--bar' : 'audition-beat-tick'}
                  style={{ left: `${(beat.ms / durationMs) * 100}%` }}
                  title={`Bar ${beat.bar}, beat ${beat.beatInBar} · ${formatClock(beat.ms)}`}
                />
              ))}
              {barLabels.map((beat) => (
                <span key={`bar-${beat.seq}`} className="audition-beat-label" aria-hidden="true" style={beat.ms / durationMs < 0.005 ? { left: 0, transform: 'none' } : { left: `${(beat.ms / durationMs) * 100}%` }}>{beat.bar}</span>
              ))}
            </>
          )}
        </div>
        </div>
      </div>

      {children ? (
        <div className="audition-song-transport">{children}</div>
      ) : <div className="h-3" />}
    </section>
  );
}
