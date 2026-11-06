import { Cloud } from '@carbon/icons-react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { cn } from '../../lib/utils';

/**
 * Shown while the current track is playing from its DropDex Cloud preview, which only happens when DropDex is not
 * reading the USB. Nothing is shown when playing from the USB, so the badge always means "this is not the original file".
 */
export function PlaybackSourceBadge({ className }: { className?: string }) {
  const { source, activeTrack, status } = useAudioPlayer();
  if (source !== 'cloud' || !activeTrack || status === 'idle' || status === 'error') return null;
  return (
    <span
      role="status"
      data-testid="playback-source-badge"
      title="Streaming DropDex's compressed preview because your USB isn't connected. Connect it to play the original file."
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[#f78361]/40 bg-[#f78361]/10 px-2 py-0.5 text-[10px] font-medium text-[#f78361]',
        className,
      )}
    >
      <Cloud size={12} aria-hidden="true" />
      Streaming preview
    </span>
  );
}
