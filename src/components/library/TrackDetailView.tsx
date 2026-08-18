import { useCallback } from 'react';
import { cn, formatDuration, formatKey, formatPosition } from '../../lib/utils';
import { RekordboxPreviewWaveform } from './RekordboxPreviewWaveform';
import { TrackAnalysisStatusBadge } from './TrackAnalysisStatusBadge';
import { SimilarVibesSection } from './SimilarVibesSection';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';
import type { RekordboxTrack } from '../../types';
import type { TrackPlaylistMembership } from '../../lib/queries/rekordbox';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { Calendar, Chemistry, FolderOpen, Information, Music, RecordingFilled, Tag, Time } from '@carbon/icons-react';
import { ControlButton } from '../ui/controls';

interface TrackDetailViewProps {
  track: RekordboxTrack;
  importId: string | null;
  waveformState: WaveformLoadState;
  /** Called to retry a retryable waveform request failure. */
  onRetryWaveform?: () => void;
  memberships: TrackPlaylistMembership[];
  membershipsLoading: boolean;
  onTrackClick: (t: RekordboxTrack) => void;
  onPlaylistClick: (playlistId: string) => void;
  onOpenDropLab: (track: RekordboxTrack) => void;
}

function StatBadge({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-4 text-center shadow-inner">
      <span
        className={cn(
          'block text-3xl font-mono font-black tracking-tighter tabular-nums',
          accent ? 'text-secondary' : 'text-foreground',
        )}
      >
        {value}
      </span>
      <span className="mt-1 block text-[9px] text-muted-foreground uppercase font-bold tracking-[0.2em]">
        {label}
      </span>
    </div>
  );
}

export function TrackDetailView({
  track,
  importId,
  waveformState,
  onRetryWaveform,
  memberships,
  membershipsLoading,
  onTrackClick,
  onPlaylistClick,
  onOpenDropLab,
}: TrackDetailViewProps) {
  const bpmDisplay = track.bpm != null ? track.bpm.toFixed(1) : '—';
  const keyDisplay = formatKey(track.musical_key);
  const artistDisplay = track.artist ?? 'Artist not stored';

  const progress = useWaveformProgress(track.id);
  const { activeTrack, status: playerStatus, seek, getAudioElement } = useAudioPlayer();
  const isActiveTrack = activeTrack?.id === track.id;
  const canSeek = isActiveTrack && !['idle', 'resolving', 'loading', 'error'].includes(playerStatus);

  const handleWaveformSeek = useCallback(
    (fraction: number) => {
      const audio = getAudioElement();
      if (!audio || !isFinite(audio.duration) || audio.duration <= 0) return;
      seek(fraction * audio.duration);
    },
    [seek, getAudioElement],
  );

  return (
    <div className="flex flex-col gap-6 pb-8">
      {/* Full-width track identity and waveform hero. */}
      <section className="relative overflow-hidden glass rounded-2xl border border-[var(--color-border-subtle)]">
        <div className="pointer-events-none absolute inset-0 brand-gradient opacity-[0.06]" />
        <div className="relative p-5 md:p-6">
          <div className="min-w-0">
            <h2 className="text-2xl md:text-3xl font-black leading-tight tracking-tight break-words">
              {track.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2.5">
              <p className="text-sm md:text-base font-bold text-primary tracking-wide">
                {artistDisplay}
              </p>
              <TrackAnalysisStatusBadge status={track.analysis_parse_status} />
            </div>
          </div>

          <div className="mt-5 md:mt-6">
            <RekordboxPreviewWaveform
              state={waveformState}
              height={92}
              variant="detail"
              activeProgress={progress}
              onSeek={canSeek ? handleWaveformSeek : undefined}
              onRetry={onRetryWaveform}
              ariaLabel={`Waveform for ${track.title}`}
            />
          </div>
        </div>
      </section>

      {/* Stats and all secondary information live below the hero. */}
      <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatBadge label="BPM" value={bpmDisplay} />
            <StatBadge label="Key" value={keyDisplay} accent />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
              <p className="text-[9px] uppercase font-bold text-muted-foreground tracking-[0.18em] mb-1.5">
                Duration
              </p>
              <p className="text-sm font-mono font-bold text-[var(--color-text-subdued)] tabular-nums">
                {formatDuration(track.duration_seconds)}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
              <p className="text-[9px] uppercase font-bold text-muted-foreground tracking-[0.18em] mb-2">
                Energy
              </p>
              <div className="flex gap-1">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-1.5 flex-1 rounded-full',
                      i < (track.rating ?? 0) ? 'bg-primary' : 'bg-muted',
                    )}
                  />
                ))}
              </div>
            </div>
          </div>

          <ControlButton
            type="button"
            variant="primary"
            onClick={() => onOpenDropLab(track)}
            className="w-full"
            aria-label={`Open ${track.title} in Drop Lab`}
          >
            <Chemistry size={16} /> Open in Drop Lab
          </ControlButton>
        </aside>

        <div className="min-w-0 space-y-6">
          <section className="space-y-2">
            <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-1">
              <Information size={14} /> DJ Comments
            </h3>
            <div className="glass rounded-2xl border border-[var(--color-border-subtle)] p-4 text-sm leading-relaxed">
              {track.comments ||
                'No DJ notes for this track. Use this field in Rekordbox to store energy level, transition tips, or set context.'}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-1">
              <Tag size={14} /> Book Metadata
            </h3>
            <div className="glass rounded-2xl overflow-hidden divide-y divide-[var(--color-border-faint)]">
              {[
                { icon: RecordingFilled, label: 'Album', value: track.album },
                { icon: Tag, label: 'Genre', value: track.genre },
                { icon: Tag, label: 'Label', value: track.label },
                { icon: Time, label: 'Format', value: track.file_format },
                { icon: Calendar, label: 'Added', value: track.date_added },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="px-4 py-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                    <Icon size={12} />
                    <p className="text-[10px] uppercase font-bold tracking-widest">{label}</p>
                  </div>
                  <p className={cn('min-w-0 text-xs font-mono text-right truncate', !value && 'text-muted-foreground italic')}>
                    {value ?? 'Not stored'}
                  </p>
                </div>
              ))}

              <div className="px-4 py-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
                  <FolderOpen size={12} />
                  <p className="text-[10px] uppercase font-bold tracking-widest">File Path</p>
                </div>
                <p
                  className={cn(
                    'text-xs font-mono leading-relaxed break-all select-all',
                    track.file_path ? 'text-primary/80' : 'text-muted-foreground italic',
                  )}
                >
                  {track.file_path ?? 'Not stored'}
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-1">
              <Music size={14} /> Appears In
            </h3>
            {membershipsLoading ? (
              <div className="glass rounded-2xl px-4 py-3 text-xs text-muted-foreground">Loading…</div>
            ) : (
              <div className="glass rounded-2xl overflow-hidden divide-y divide-[var(--color-border-faint)]">
                {memberships.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-muted-foreground italic">
                    Not found in any playlists.
                  </p>
                ) : (
                  memberships.map(({ playlist, position }) => (
                    <button
                      key={playlist.id}
                      onClick={() => onPlaylistClick(playlist.id)}
                      className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-[var(--color-surface-hover)] transition-colors text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Music size={11} className="text-muted-foreground shrink-0" />
                        <p className="text-xs font-bold truncate">{playlist.name}</p>
                      </div>
                      <span className="text-[10px] font-mono text-primary shrink-0">
                        #{formatPosition(position)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </section>

          <SimilarVibesSection
            track={track}
            importId={importId}
            onTrackClick={onTrackClick}
          />
        </div>
      </div>
    </div>
  );
}
