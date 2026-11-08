import type { ReactNode } from 'react';
import { Forward, Pause, Play, Rewind, SkipNext, SkipPrev } from 'iconoir-react/regular';
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
  /** Show only the play button, in the same capsule. For screens with nothing to skip to. */
  playOnly?: boolean;
  /** Replaces the Play / Pause label. */
  playLabel?: string;
  /** Replaces the Play / Pause icon, e.g. a stop square. */
  playIcon?: ReactNode;
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
  playOnly = false,
  playLabel,
  playIcon,
}: MediaTransportControlGroupProps) {
  const size = compact ? 'compact' : 'standard';
  const iconSize = compact ? 14 : 18;
  return (
    <div className={cn('dd-media-transport-group', compact && 'dd-media-transport-group--compact')} role="group" aria-label={ariaLabel}>
      {!playOnly && (
        <>
          <TransportButton label="Previous track" size={size} disabled={disabled || previousDisabled} onClick={onPrevious}>
            <SkipPrev aria-hidden="true" width={iconSize} height={iconSize} />
          </TransportButton>
          <TransportButton label="Rewind" size={size} disabled={disabled || rewindDisabled} onClick={onRewind}>
            <Rewind aria-hidden="true" width={iconSize} height={iconSize} />
          </TransportButton>
        </>
      )}
      <TransportButton
        label={playLabel ?? (playing ? 'Pause' : 'Play')}
        tone="play"
        size={compact ? 'standard' : 'hero'}
        active={playing}
        disabled={disabled || playDisabled}
        onClick={onTogglePlay}
      >
        {playIcon ?? (playing ? <Pause aria-hidden="true" width={compact ? 17 : 22} height={compact ? 17 : 22} /> : <Play aria-hidden="true" width={compact ? 17 : 22} height={compact ? 17 : 22} />)}
      </TransportButton>
      {!playOnly && (
        <>
          <TransportButton label="Fast forward" size={size} disabled={disabled || forwardDisabled} onClick={onForward}>
            <Forward aria-hidden="true" width={iconSize} height={iconSize} />
          </TransportButton>
          <TransportButton label="Next track" size={size} disabled={disabled || nextDisabled} onClick={onNext}>
            <SkipNext aria-hidden="true" width={iconSize} height={iconSize} />
          </TransportButton>
        </>
      )}
    </div>
  );
}
