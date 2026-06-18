import { Search, Loader2, Play, Pause, Usb } from 'lucide-react';
import { useCallback } from 'react';
import { cn, formatKey } from '../../lib/utils';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';
import { RekordboxPreviewWaveform } from './RekordboxPreviewWaveform';
import type { RekordboxTrack } from '../../types';
import type { TrackPreviewWaveform } from '../../lib/queries/waveformValidation';

interface LibrarySearchResultsProps {
  query: string;
  results: RekordboxTrack[];
  loading: boolean;
  importId: string | null;
  onTrackClick: (track: RekordboxTrack) => void;
  waveforms: Map<string, TrackPreviewWaveform>;
  waveformUnavailable: Set<string>;
  waveformsLoading: boolean;
}

const HEADERS = ['', 'Title', 'Artist', 'BPM', 'Key'] as const;

function TrackRowSearch({
  track,
  waveform,
  waveformUnavailable,
  waveformLoading,
  onOpen,
}: {
  track: RekordboxTrack;
  waveform: TrackPreviewWaveform | null;
  waveformUnavailable: boolean;
  waveformLoading: boolean;
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
      <div className="hidden sm:grid grid-cols-[36px_1fr_1fr_56px_56px] items-center gap-x-2">
        {/* Play button */}
        <div className="flex items-center justify-center">
          <button
            onClick={handlePlayClick}
            aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
            disabled={!usbConnected && !isActiveTrack}
            title={!usbConnected && !isActiveTrack ? 'Connect a USB drive to play' : undefined}
            className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center transition-all shrink-0',
              'opacity-0 group-hover:opacity-100 focus:opacity-100',
              isActiveRow && 'opacity-100',
              isLoadingThis && 'opacity-100 cursor-wait',
              !usbConnected && !isActiveTrack
                ? 'text-muted-foreground/30 cursor-not-allowed'
                : isPlaying
                ? 'bg-primary text-white hover:bg-primary/90'
                : 'bg-[var(--color-surface)] text-foreground hover:bg-primary hover:text-white',
            )}
          >
            {isLoadingThis ? (
              <Loader2 size={13} className="animate-spin" />
            ) : !usbConnected && !isActiveTrack ? (
              <Usb size={12} />
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
              waveform={waveform}
              height={22}
              loading={waveformLoading}
              unavailable={waveformUnavailable}
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
      </div>

      {/* Mobile */}
      <div className="sm:hidden">
        <div className="flex items-start gap-2">
          <button
            onClick={handlePlayClick}
            aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
            disabled={!usbConnected && !isActiveTrack}
            className={cn(
              'mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all',
              !usbConnected && !isActiveTrack
                ? 'text-muted-foreground/30 cursor-not-allowed'
                : isPlaying
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
            waveform={waveform}
            height={20}
            loading={waveformLoading}
            unavailable={waveformUnavailable}
            activeProgress={progress}
            onSeek={canSeek ? handleWaveformSeek : undefined}
            ariaLabel=""
          />
        </div>
      </div>
    </div>
  );
}

export function LibrarySearchResults({
  query,
  results,
  loading,
  importId,
  onTrackClick,
  waveforms,
  waveformUnavailable,
  waveformsLoading,
}: LibrarySearchResultsProps) {
  const label = loading
    ? 'Searching…'
    : results.length > 0
    ? `${results.length} result${results.length !== 1 ? 's' : ''} for "${query}"`
    : `No results for "${query}"`;

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
        <Search size={13} />
        {label}
      </h2>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-primary" size={26} />
        </div>
      )}

      {!loading && !importId && (
        <p className="text-center py-12 text-muted-foreground italic text-sm">
          Import a library to search your tracks.
        </p>
      )}

      {!loading && importId && results.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-[var(--color-border-subtle)] rounded-3xl">
          <Search size={28} className="mx-auto text-muted-foreground opacity-30 mb-2" />
          <p className="text-sm text-muted-foreground italic">No tracks matching your search.</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="glass rounded-2xl overflow-hidden border border-[var(--color-border-subtle)]">
          <div className="hidden sm:grid grid-cols-[36px_1fr_1fr_56px_56px] px-4 py-2.5 border-b border-[var(--color-border-faint)] gap-x-2">
            {HEADERS.map((col, i) => (
              <p
                key={i}
                className={cn(
                  'text-[9px] uppercase tracking-widest text-muted-foreground font-bold',
                  i >= 3 && 'text-center',
                )}
              >
                {col}
              </p>
            ))}
          </div>

          <div className="divide-y divide-[var(--color-border-faint)]">
            {results.map((track) => (
              <TrackRowSearch
                key={track.id}
                track={track}
                waveform={waveforms.get(track.id) ?? null}
                waveformUnavailable={waveformUnavailable.has(track.id)}
                waveformLoading={
                  !waveforms.has(track.id) &&
                  !waveformUnavailable.has(track.id) &&
                  waveformsLoading
                }
                onOpen={onTrackClick}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
