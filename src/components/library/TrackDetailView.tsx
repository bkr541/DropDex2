import {
  Info,
  Clock,
  Tag,
  Disc3,
  FolderOpen,
  ListMusic,
  Calendar,
} from 'lucide-react';
import { useCallback } from 'react';
import { cn, formatDuration, formatKey, formatPosition } from '../../lib/utils';
import { WaveformDisplay } from './WaveformDisplay';
import { RekordboxPreviewWaveform } from './RekordboxPreviewWaveform';
import { SimilarVibesSection } from './SimilarVibesSection';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';
import type { RekordboxTrack } from '../../types';
import type { TrackPlaylistMembership } from '../../lib/queries/rekordbox';
import type { TrackPreviewWaveform } from '../../lib/queries/waveformValidation';

interface TrackDetailViewProps {
  track: RekordboxTrack;
  importId: string | null;
  /** Authentic Rekordbox preview waveform data. When provided, replaces the unavailable state. */
  waveform?: TrackPreviewWaveform | null;
  /** True while the waveform is being fetched for this track. */
  waveformLoading?: boolean;
  /** Set when the waveform fetch failed with a transient error (distinct from confirmed absence). */
  waveformError?: string | null;
  /** Called to retry a failed waveform fetch. Only relevant when waveformError is set. */
  onRetryWaveform?: () => void;
  memberships: TrackPlaylistMembership[];
  membershipsLoading: boolean;
  onTrackClick: (t: RekordboxTrack) => void;
  onPlaylistClick: (playlistId: string) => void;
}

function StatBadge({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={cn(
          'text-4xl font-mono font-black tracking-tighter',
          accent ? 'text-secondary' : 'text-foreground',
        )}
      >
        {value}
      </span>
      <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
        {label}
      </span>
    </div>
  );
}

export function TrackDetailView({
  track,
  importId,
  waveform,
  waveformLoading,
  waveformError,
  onRetryWaveform,
  memberships,
  membershipsLoading,
  onTrackClick,
  onPlaylistClick,
}: TrackDetailViewProps) {
  const bpmDisplay = track.bpm != null ? track.bpm.toFixed(1) : '—';
  const keyDisplay = formatKey(track.musical_key);
  const artistDisplay = track.artist ?? 'Artist not stored';

  // Live waveform progress — active only when this track is currently playing/paused.
  const progress = useWaveformProgress(track.id);
  const { activeTrack, status: playerStatus, seek, getAudioElement } = useAudioPlayer();
  const isActiveTrack = activeTrack?.id === track.id;
  const canSeek = isActiveTrack && (playerStatus === 'playing' || playerStatus === 'paused');

  const handleWaveformSeek = useCallback(
    (fraction: number) => {
      const audio = getAudioElement();
      if (!audio || !isFinite(audio.duration) || audio.duration <= 0) return;
      seek(fraction * audio.duration);
    },
    [seek, getAudioElement],
  );

  return (
    <div className="flex flex-col gap-6 md:grid md:grid-cols-[300px_1fr] md:gap-8">

      {/* ── Left column: visualizer + core stats ── */}
      <div className="flex flex-col gap-5">

        {/* Visualizer area */}
        <div className="relative aspect-video w-full glass rounded-2xl overflow-hidden border border-[var(--color-border-subtle)] group">
          <div className="absolute inset-0 brand-gradient opacity-10 group-hover:opacity-20 transition-opacity" />

          {/* Waveform — idle/loading/available/unavailable/error states */}
          <div className="absolute bottom-0 left-0 right-0 px-3 pb-2" style={{ height: 80 }}>
            {waveform != null ? (
              <RekordboxPreviewWaveform
                waveform={waveform}
                height={78}
                activeProgress={progress}
                onSeek={canSeek ? handleWaveformSeek : undefined}
                ariaLabel={`Waveform for ${track.title}`}
              />
            ) : waveformLoading ? (
              /* Loading skeleton — neutral bars, no label */
              <div className="w-full h-full flex items-end gap-0.5 opacity-20">
                {Array.from({ length: 60 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-primary animate-pulse"
                    style={{ height: `${30 + Math.sin(i * 0.4) * 20}%` }}
                  />
                ))}
              </div>
            ) : waveformError ? (
              <div className="flex items-center justify-center h-full gap-2 text-xs text-muted-foreground/60">
                <span>Waveform unavailable</span>
                {onRetryWaveform && (
                  <button
                    onClick={onRetryWaveform}
                    className="text-primary/70 hover:text-primary underline text-xs"
                  >
                    Retry
                  </button>
                )}
              </div>
            ) : (
              /* Confirmed absent — waveform not stored for this track */
              <WaveformDisplay
                peaks={null}
                seed={track.id}
                barCount={60}
                color="primary"
                showFallbackLabel
              />
            )}
          </div>

          {/* Track identity overlay */}
          <div className="absolute bottom-4 left-4 right-4 z-10">
            <h2 className="text-xl font-black italic uppercase leading-tight line-clamp-2">
              {track.title}
            </h2>
            <p className="text-sm font-bold text-primary uppercase tracking-widest truncate">
              {artistDisplay}
            </p>
          </div>

          {/* Key badge */}
          <div className="absolute top-4 right-4 bg-background/80 backdrop-blur-md px-3 py-1 rounded-lg border border-[var(--color-border-subtle)] text-xs font-mono font-black text-secondary italic">
            {keyDisplay}
          </div>
        </div>

        {/* BPM + Key */}
        <div className="flex justify-around items-center bg-[var(--color-surface)] py-5 rounded-2xl border border-[var(--color-border-faint)] shadow-inner">
          <StatBadge label="BPM" value={bpmDisplay} />
          <div className="h-12 w-px bg-[var(--color-border-subtle)]" />
          <StatBadge label="Key" value={keyDisplay} accent />
        </div>

        {/* Duration + Energy */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border-subtle)] p-4 rounded-xl">
            <p className="text-[8px] uppercase font-bold text-muted-foreground tracking-widest mb-1">
              Duration
            </p>
            <p className="text-sm font-mono font-bold text-[var(--color-text-subdued)]">
              {formatDuration(track.duration_seconds)}
            </p>
          </div>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border-subtle)] p-4 rounded-xl">
            <p className="text-[8px] uppercase font-bold text-muted-foreground tracking-widest mb-1">
              Energy
            </p>
            <div className="flex gap-0.5 mt-1">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'w-3 h-1.5 rounded-[1px]',
                    i < (track.rating ?? 0) ? 'bg-primary' : 'bg-muted',
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Right column: metadata ── */}
      <div className="flex flex-col gap-6 pb-8">

        {/* DJ Comments */}
        <section className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-1">
            <Info size={14} /> DJ Comments
          </h3>
          <div className="glass p-4 rounded-2xl text-sm leading-relaxed border-l-4 border-l-secondary">
            {track.comments ||
              'No DJ notes for this track. Use this field in Rekordbox to store energy level, transition tips, or set context.'}
          </div>
        </section>

        {/* Library Metadata */}
        <section className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-1">
            <Tag size={14} /> Library Metadata
          </h3>
          <div className="glass rounded-2xl divide-y divide-[var(--color-border-faint)]">
            {[
              { icon: Disc3, label: 'Album', value: track.album },
              { icon: Tag, label: 'Genre', value: track.genre },
              { icon: Tag, label: 'Label', value: track.label },
              { icon: Clock, label: 'Format', value: track.file_format },
              { icon: Calendar, label: 'Added', value: track.date_added },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="px-4 py-2.5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                  <Icon size={12} />
                  <p className="text-[10px] uppercase font-bold tracking-widest">{label}</p>
                </div>
                <p className={cn('text-xs font-mono text-right truncate', !value && 'text-muted-foreground italic')}>
                  {value ?? 'Not stored'}
                </p>
              </div>
            ))}

            {/* File path gets its own row since it can be long */}
            <div className="px-4 py-2.5">
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

        {/* Appears In */}
        <section className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 px-1">
            <ListMusic size={14} /> Appears In
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
                    className="w-full px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-[var(--color-surface-hover)] transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ListMusic size={11} className="text-muted-foreground shrink-0" />
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

        {/* Similar Vibes */}
        <SimilarVibesSection
          track={track}
          importId={importId}
          onTrackClick={onTrackClick}
        />
      </div>
    </div>
  );
}

