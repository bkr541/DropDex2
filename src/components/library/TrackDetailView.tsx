import { Suspense, useMemo } from 'react';
import { useAudioDockTracks } from '../../contexts/AudioDockWorkspaceContext';
import { cn, formatDuration, formatPosition } from '../../lib/utils';
import { TrackAnalysisStatusBadge } from './TrackAnalysisStatusBadge';
import { SimilarVibesSection } from './SimilarVibesSection';
import type { RekordboxTrack } from '../../types';
import type { TrackPlaylistMembership } from '../../lib/queries/rekordbox';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { Flask, Folder, InfoCircle, Label, MusicNote, NavArrowRight, Refresh } from 'iconoir-react/regular';
import { ControlButton } from '../ui/controls';
import { lazyWithRecovery } from '../../navigation/lazyWithRecovery';

const CuePointsTrackPanel = lazyWithRecovery('track-timeline', () => import('../cues/CuePointsView').then((module) => ({ default: module.CuePointsTrackPanel })));

interface TrackDetailViewProps {
  track: RekordboxTrack;
  importId: string | null;
  waveformState: WaveformLoadState;
  onRetryWaveform?: () => void;
  memberships: TrackPlaylistMembership[];
  membershipsLoading: boolean;
  onTrackClick: (track: RekordboxTrack) => void;
  onPlaylistClick: (playlistId: string) => void;
  onOpenDropLab: (track: RekordboxTrack) => void;
}

export function TrackDetailView({ track, importId, waveformState, onRetryWaveform, memberships, membershipsLoading, onTrackClick, onPlaylistClick, onOpenDropLab }: TrackDetailViewProps) {
  const dockTracks = useMemo(() => [track], [track]);
  useAudioDockTracks(dockTracks, track);
  const metadata = [
    { label: 'Album', value: track.album },
    { label: 'Genre', value: track.genre },
    { label: 'Label', value: track.label },
    { label: 'Format', value: track.file_format },
    { label: 'Sample rate', value: track.sample_rate_hz ? `${track.sample_rate_hz / 1000} kHz` : null },
    { label: 'Bit rate', value: track.bitrate_kbps ? `${track.bitrate_kbps} kbps` : null },
    { label: 'Duration', value: formatDuration(track.duration_seconds) },
    { label: 'Added', value: track.date_added },
  ];

  return (
    <div className="min-w-0 space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground"><MusicNote width={13} height={13} aria-hidden="true" /> Track overview</h2>
          <TrackAnalysisStatusBadge status={track.analysis_parse_status} />
        </div>
        <ControlButton variant="neutral" onClick={() => onOpenDropLab(track)} aria-label={`Open ${track.title} in Drop Lab`}>
          <Flask width={15} height={15} aria-hidden="true" /> Open in Drop Lab
        </ControlButton>
      </div>

      <Suspense fallback={<div className="glass flex min-h-[280px] items-center justify-center gap-2 rounded-2xl border border-[var(--color-border-subtle)] text-sm text-muted-foreground" role="status"><Refresh width={18} height={18} aria-hidden="true" className="animate-spin" /> Loading track timeline…</div>}>
        <CuePointsTrackPanel key={track.id} track={track} waveformState={waveformState} onRetryWaveform={onRetryWaveform} />
      </Suspense>

      <div className="grid items-start gap-5 lg:grid-cols-[268px_minmax(0,1fr)]">
        <aside className="glass min-w-0 overflow-hidden rounded-2xl border border-[var(--color-border-subtle)]">
          <h3 className="flex items-center gap-2 border-b border-[var(--color-border-faint)] px-5 py-4 text-xs font-bold uppercase tracking-widest text-muted-foreground"><Label width={13} height={13} aria-hidden="true" /> Track information</h3>
          <dl className="divide-y divide-[var(--color-border-faint)]">
            {metadata.map(({ label, value }) => (
              <div key={label} className="flex items-start justify-between gap-4 px-5 py-3">
                <dt className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
                <dd className={cn('min-w-0 break-words text-right text-xs font-medium', !value && 'text-muted-foreground')}>{value || 'Not stored'}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 px-5 py-3">
              <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Energy</dt>
              <dd className="flex gap-1" aria-label={`Energy ${track.rating ?? 0} out of 5`}>
                {Array.from({ length: 5 }, (_, index) => <span key={index} className={cn('h-1.5 w-3 rounded-full', index < (track.rating ?? 0) ? 'bg-primary' : 'bg-muted')} />)}
              </dd>
            </div>
            <div className="space-y-2 px-5 py-4">
              <dt className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"><Folder width={12} height={12} aria-hidden="true" /> File path</dt>
              <dd className="select-all break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{track.file_path || 'Not stored'}</dd>
            </div>
          </dl>
        </aside>

        <div className="min-w-0 space-y-5">
          <section className="glass rounded-2xl border border-[var(--color-border-subtle)] p-5">
            <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground"><InfoCircle width={13} height={13} aria-hidden="true" /> DJ comments</h3>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85">{track.comments || 'No DJ notes stored for this track.'}</p>
          </section>

          <section className="glass overflow-hidden rounded-2xl border border-[var(--color-border-subtle)]">
            <h3 className="flex items-center gap-2 border-b border-[var(--color-border-faint)] px-5 py-4 text-xs font-bold uppercase tracking-widest text-muted-foreground"><MusicNote width={13} height={13} aria-hidden="true" /> Appears in</h3>
            {membershipsLoading ? (
              <p className="flex items-center gap-2 px-5 py-4 text-xs text-muted-foreground" role="status"><Refresh width={14} height={14} aria-hidden="true" className="animate-spin" /> Loading playlists…</p>
            ) : memberships.length === 0 ? (
              <p className="px-5 py-4 text-xs text-muted-foreground">Not found in any playlists.</p>
            ) : (
              <div className="divide-y divide-[var(--color-border-faint)]">
                {memberships.map(({ playlist, position }) => (
                  <button key={playlist.id} type="button" onClick={() => onPlaylistClick(playlist.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50">
                    <MusicNote width={14} height={14} aria-hidden="true" className="shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-sm font-bold">{playlist.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">#{formatPosition(position)}</span>
                    <NavArrowRight width={14} height={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="glass rounded-2xl border border-[var(--color-border-subtle)] p-5">
            <SimilarVibesSection track={track} importId={importId} onTrackClick={onTrackClick} />
          </div>
        </div>
      </div>
    </div>
  );
}
