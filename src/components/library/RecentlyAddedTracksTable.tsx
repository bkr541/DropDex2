import { History, Loader2, Play, Pause } from 'lucide-react';
import { useCallback } from 'react';
import { cn, formatKey } from '../../lib/utils';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';
import { RekordboxPreviewWaveform } from './RekordboxPreviewWaveform';
import type { RekordboxTrack } from '../../types';
import { waveformStateForTrack, type WaveformLoadState } from '../../lib/queries/waveformValidation';

interface RecentlyAddedTracksTableProps {
  tracks: RekordboxTrack[];
  loading: boolean;
  onTrackClick: (track: RekordboxTrack) => void;
  waveformStates: Map<string, WaveformLoadState>;
  onRetryWaveform: (trackId: string) => void;
  showHeader?: boolean;
}

const HEADERS = ['', 'Title', 'Artist', 'BPM', 'Key', 'Added'] as const;

function TrackRowRecent({
  track,
  waveformState,
  onRetryWaveform,
  onOpen,
}: {
  track: RekordboxTrack;
  waveformState: WaveformLoadState;
  onRetryWaveform: () => void;
  onOpen: (track: RekordboxTrack) => void;
}) {
  const { activeTrack, status: playerStatus, toggleTrack, seek, getAudioElement } = useAudioPlayer();
  const { status: usbStatus } = useUsbConnection();
  const usbConnected = usbStatus === 'connected';

  const isActiveTrack = activeTrack?.id === track.id;
  const isPlaying = isActiveTrack && playerStatus === 'playing';
  const isLoadingThis = isActiveTrack && (playerStatus === 'resolving' || playerStatus === 'loading');
  const isActiveRow = isActiveTrack && (playerStatus === 'playing' || playerStatus === 'paused' || playerStatus === 'ended');
  const canSeek = isActiveTrack && (playerStatus === 'playing' || playerStatus === 'paused');

  const progress = useWaveformProgress(track.id);

  const handlePlayClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void toggleTrack(track);
    },
    [toggleTrack, track],
  );

  const handleWaveformSeek = useCallback(
    (fraction: number) => {
      const audio = getAudioElement();
      if (!audio || !isFinite(audio.duration) || audio.duration <= 0) return;
      seek(fraction * audio.duration);
    },
    [seek, getAudioElement],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(track)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(track); } }}
      aria-label={`Open ${track.title}${track.artist ? ` by ${track.artist}` : ''}`}
      className={cn(
        'group w-full px-4 py-2.5 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset',
        isActiveRow && 'border-l-2 border-l-primary bg-primary/5 hover:bg-primary/10',
      )}
    >
      {/* Desktop */}
      <div className="hidden sm:grid grid-cols-[36px_1fr_1fr_56px_56px_88px] items-center gap-x-2">
        {/* Play button */}
        <div className="flex items-center justify-center">
          <button
            onClick={handlePlayClick}
            aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
            title={!usbConnected ? 'Connect a USB drive to play' : undefined}
            className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center transition-all shrink-0',
              'opacity-0 group-hover:opacity-100 focus:opacity-100',
              isActiveRow && 'opacity-100',
              isLoadingThis && 'opacity-100 cursor-wait',
              isPlaying
                ? 'bg-primary text-white hover:bg-primary/90'
                : 'bg-[var(--color-surface)] text-foreground hover:bg-primary hover:text-white',
            )}
          >
            {isLoadingThis ? (
              <Loader2 size={13} className="animate-spin" />
            ) : isPlaying ? (
              <Pause size={13} />
            ) : (
              <Play size={13} />
            )}
          </button>
        </div>

        {/* Title + waveform */}
        <div className="min-w-0 pr-2">
          <p className={cn(
            'text-sm font-semibold truncate transition-colors leading-tight',
            isActiveRow ? 'text-primary' : 'group-hover:text-primary',
          )}>
            {track.title}
          </p>
          <div className="mt-1.5">
            <RekordboxPreviewWaveform
              state={waveformState}
              height={22}
              onRetry={onRetryWaveform}
              activeProgress={progress}
              onSeek={canSeek ? handleWaveformSeek : undefined}
              ariaLabel=""
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground truncate pr-4">{track.artist ?? '—'}</p>
        <p className="text-xs font-mono text-primary text-center tabular-nums">
          {track.bpm != null ? track.bpm.toFixed(1) : '—'}
        </p>
        <p className="text-xs font-mono text-secondary text-center">{formatKey(track.musical_key)}</p>
        <p className="text-[10px] text-muted-foreground text-right tabular-nums">
          {track.date_added?.slice(0, 10) ?? '—'}
        </p>
      </div>

      {/* Mobile */}
      <div className="sm:hidden">
        <div className="flex items-start gap-2">
          <button
            onClick={handlePlayClick}
            aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
            className={cn(
              'mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all',
              isPlaying
                ? 'bg-primary text-white'
                : 'bg-[var(--color-surface)] text-foreground hover:bg-primary hover:text-white',
            )}
          >
            {isLoadingThis ? <Loader2 size={11} className="animate-spin" /> : isPlaying ? <Pause size={11} /> : <Play size={11} />}
          </button>
          <div className="flex-1 min-w-0">
            <p className={cn(
              'text-sm font-semibold truncate transition-colors leading-tight',
              isActiveRow ? 'text-primary' : 'group-hover:text-primary',
            )}>
              {track.title}
            </p>
            <div className="flex items-center gap-3 mt-0.5">
              <p className="text-[11px] text-muted-foreground truncate flex-1 leading-tight">{track.artist ?? '—'}</p>
              {track.bpm != null && (
                <p className="text-[10px] font-mono text-primary shrink-0 tabular-nums">{track.bpm.toFixed(1)}</p>
              )}
              <p className="text-[10px] font-mono text-secondary shrink-0">{formatKey(track.musical_key)}</p>
            </div>
          </div>
        </div>
        <div className="mt-1.5">
          <RekordboxPreviewWaveform
            state={waveformState}
            height={20}
            onRetry={onRetryWaveform}
            activeProgress={progress}
            onSeek={canSeek ? handleWaveformSeek : undefined}
            ariaLabel=""
          />
        </div>
      </div>
    </div>
  );
}

export function RecentlyAddedTracksTable({
  tracks,
  loading,
  onTrackClick,
  waveformStates,
  onRetryWaveform,
  showHeader = true,
}: RecentlyAddedTracksTableProps) {
  return (
    <section className="space-y-3">
      {showHeader && (
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <History size={13} /> Recently Added
        </h2>
      )}

      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="animate-spin text-muted-foreground" size={20} />
        </div>
      )}

      {!loading && tracks.length === 0 && (
        <p className="text-center py-8 text-muted-foreground text-sm italic">
          No recently dated tracks found.
        </p>
      )}

      {!loading && tracks.length > 0 && (
        <div className="glass rounded-2xl overflow-hidden border border-[var(--color-border-subtle)]">
          <div className="hidden sm:grid grid-cols-[36px_1fr_1fr_56px_56px_88px] px-4 py-2.5 border-b border-[var(--color-border-faint)] gap-x-2">
            {HEADERS.map((col, i) => (
              <p
                key={i}
                className={cn(
                  'text-[9px] uppercase tracking-widest text-muted-foreground font-bold',
                  i === 3 || i === 4 ? 'text-center' : '',
                  i === 5 ? 'text-right' : '',
                )}
              >
                {col}
              </p>
            ))}
          </div>

          <div className="divide-y divide-[var(--color-border-faint)]">
            {tracks.map((track) => (
              <TrackRowRecent
                key={track.id}
                track={track}
                waveformState={waveformStateForTrack(waveformStates, track.id)}
                onRetryWaveform={() => onRetryWaveform(track.id)}
                onOpen={onTrackClick}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
