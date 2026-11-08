import { Pause, Play, Refresh } from 'iconoir-react/regular';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { cn } from '../../lib/utils';
import type { RekordboxTrack } from '../../types';

/** The small play and pause button at the start of a track listing row. It plays through the shared player. */
export function TrackRowPlayButton({ track }: { track: RekordboxTrack }) {
  const { activeTrack, status, playIntent, toggleTrack } = useAudioPlayer();
  const isActive = activeTrack?.id === track.id;
  const isPlaying = isActive && playIntent && status !== 'error';
  const isLoading = isActive && (status === 'resolving' || status === 'loading' || status === 'buffering' || status === 'seeking');
  return (
    <TrackRowPlayControl
      label={(isPlaying ? 'Pause ' : 'Play ') + track.title}
      active={isActive} playing={isPlaying} loading={isLoading}
      onToggle={() => void toggleTrack(track)}
    />
  );
}

export function TrackRowPlayControl({ label, active, playing, loading, disabled, onToggle }: {
  label: string;
  active: boolean;
  playing: boolean;
  loading: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        active ? 'text-primary' : 'text-muted-foreground hover:text-primary',
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {loading ? <Refresh aria-hidden="true" width={14} height={14} className="animate-spin" /> : playing ? <Pause aria-hidden="true" width={14} height={14} /> : <Play aria-hidden="true" width={14} height={14} />}
    </button>
  );
}
