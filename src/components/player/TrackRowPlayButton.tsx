import { CircleDash, Pause, Play } from '@carbon/icons-react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { cn } from '../../lib/utils';
import type { RekordboxTrack } from '../../types';

/** The small play and pause button at the start of a track listing row. It plays through the shared player. */
export function TrackRowPlayButton({ track }: { track: RekordboxTrack }) {
  const { activeTrack, status, playIntent, toggleTrack } = useAudioPlayer();
  const isActive = activeTrack?.id === track.id;
  const isPlaying = isActive && playIntent && status !== 'error';
  const isLoading = isActive && (status === 'resolving' || status === 'loading' || status === 'buffering' || status === 'seeking');
  const label = `${isPlaying ? 'Pause' : 'Play'} ${track.title}`;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        isActive ? 'text-primary' : 'text-muted-foreground hover:text-primary',
      )}
      onClick={(event) => {
        event.stopPropagation();
        void toggleTrack(track);
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {isLoading ? <CircleDash size={14} className="animate-spin" /> : isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
    </button>
  );
}
