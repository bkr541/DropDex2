import { Pause, Play, SkipBack, SkipForward } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';
import { TransportButton } from './TransportButton';

export interface MediaTransportControlGroupProps {
  playing: boolean;
  onTogglePlay: () => void;
  onPrevious?: () => void;
  onRewind?: () => void;
  onForward?: () => void;
  onNext?: () => void;
  disabled?: boolean;
  previousDisabled?: boolean;
  rewindDisabled?: boolean;
  playDisabled?: boolean;
  forwardDisabled?: boolean;
  nextDisabled?: boolean;
  compact?: boolean;
  ariaLabel?: string;
}

export function MediaTransportControlGroup({
  playing,
  onTogglePlay,
  onPrevious,
  onRewind,
  onForward,
  onNext,
  disabled = false,
  previousDisabled = false,
  rewindDisabled = false,
  playDisabled = false,
  forwardDisabled = false,
  nextDisabled = false,
  compact = false,
  ariaLabel = 'Media transport controls',
}: MediaTransportControlGroupProps) {
  const size = compact ? 'compact' : 'standard';
  const iconSize = compact ? 14 : 18;
  return (
    <div className={cn('dd-media-transport-group', compact && 'dd-media-transport-group--compact')} role="group" aria-label={ariaLabel}>
      <TransportButton label="Previous track" size={size} disabled={disabled || previousDisabled} onClick={onPrevious}>
        <SkipBack size={iconSize} fill="currentColor" />
      </TransportButton>
      <TransportButton label="Rewind" size={size} disabled={disabled || rewindDisabled} onClick={onRewind}>
        <SkipBack size={iconSize} fill="currentColor" />
      </TransportButton>
      <TransportButton
        label={playing ? 'Pause' : 'Play'}
        tone="play"
        size={compact ? 'standard' : 'hero'}
        active={playing}
        disabled={disabled || playDisabled}
        onClick={onTogglePlay}
      >
        {playing ? <Pause size={compact ? 17 : 22} fill="currentColor" /> : <Play size={compact ? 17 : 22} fill="currentColor" />}
      </TransportButton>
      <TransportButton label="Fast forward" size={size} disabled={disabled || forwardDisabled} onClick={onForward}>
        <SkipForward size={iconSize} fill="currentColor" />
      </TransportButton>
      <TransportButton label="Next track" size={size} disabled={disabled || nextDisabled} onClick={onNext}>
        <SkipForward size={iconSize} fill="currentColor" />
      </TransportButton>
    </div>
  );
}
