import { useMemo, type ReactNode } from 'react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';
import type { TimelineSection } from '../../lib/music/phraseSections';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { RekordboxPreviewWaveform, type WaveformColorSegment } from '../library/RekordboxPreviewWaveform';
import { formatClock, timeRulerTicks } from './auditionTracks';
import type { RekordboxTrack } from '../../types';

interface AuditionFullSongProps {
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

const WAVEFORM_HEIGHT = 84;

export function AuditionFullSong({
  track, durationMs, waveformState, onRetryWaveform, sections, sectionsLoading, sectionsError, onRetrySections, children,
}: AuditionFullSongProps) {
  const { activeTrack, seek, getAudioElement } = useAudioPlayer();
  const progress = useWaveformProgress(track?.id);
  const isActive = Boolean(track && activeTrack?.id === track.id);

  const ticks = useMemo(() => timeRulerTicks(durationMs), [durationMs]);
  const colorSegments = useMemo<WaveformColorSegment[]>(() => {
    if (durationMs == null || durationMs <= 0) return [];
    return sections.map((section) => ({
      startFraction: section.startMs / durationMs,
      endFraction: section.endMs / durationMs,
      color: section.waveformColor,
    }));
  }, [durationMs, sections]);

  // Clicking only jumps within a track that is already loaded in the player.
  function handleSeek(fraction: number) {
    const audio = getAudioElement();
    if (!isActive || !audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    seek(fraction * audio.duration);
  }

  const hasDuration = durationMs != null && durationMs > 0;

  return (
    <section
      data-testid="audition-full-song"
      aria-label="Full song"
      className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-card)]/60"
    >
      <div className="flex items-baseline gap-2.5 px-3.5 pb-1 pt-3">
        <h3 className="text-sm font-bold uppercase tracking-wide">Full song</h3>
        <span className="font-mono text-[13px] tabular-nums text-muted-foreground">{hasDuration ? formatClock(durationMs) : '—'}</span>
      </div>

      <div className="px-3.5">
        {/* Ruler, waveform and sections share this box, so a time lines up in all three. */}
        <div className="relative h-5" aria-hidden="true">
          {hasDuration && ticks.map((tick) => (
            <span
              key={tick.ms}
              className="absolute top-0 font-mono text-[11px] tabular-nums text-muted-foreground"
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
          {hasDuration && ticks.slice(1).map((tick) => (
            <span
              key={`line-${tick.ms}`}
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-white/[0.06]"
              style={{ left: `${(tick.ms / durationMs) * 100}%` }}
            />
          ))}
        </div>

        <div className="relative mt-1.5 h-6" data-testid="audition-sections">
          {hasDuration && sections.map((section) => (
            <div
              key={section.id}
              data-testid="audition-section"
              title={`${section.label} · ${formatClock(section.startMs)}–${formatClock(section.endMs)}`}
              className="absolute top-0 flex h-full items-center justify-center overflow-hidden rounded-[3px] border px-1 text-[11px] font-medium leading-none text-white"
              style={{
                left: `${(section.startMs / durationMs) * 100}%`,
                width: `calc(${((section.endMs - section.startMs) / durationMs) * 100}% - 2px)`,
                backgroundColor: `${section.panelColor}`,
                borderColor: section.waveformColor,
              }}
            >
              <span className="truncate">{section.label}</span>
            </div>
          ))}
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

      {children ? (
        <div className="mt-3 border-t border-[var(--color-border-faint)] px-3.5 py-2.5">{children}</div>
      ) : <div className="h-3" />}
    </section>
  );
}
