import { cn } from '../../../lib/utils';
import { formatTime } from '../../../lib/music/trackTiming';

export interface PlaybackSeekBarProps {
  currentSeconds: number;
  durationSeconds: number;
  /** When false the bar is dimmed and sits at the start. */
  seekable: boolean;
  /** Shows progress but cannot be dragged, e.g. a preview that plays straight through. */
  readOnly?: boolean;
  onSeek?: (seconds: number) => void;
  ariaLabel: string;
  className?: string;
}

/** Elapsed time, a position slider and total time: the progress control in the Cue Points audio dock. */
export function PlaybackSeekBar({ currentSeconds, durationSeconds, seekable, readOnly = false, onSeek, ariaLabel, className }: PlaybackSeekBarProps) {
  const showsPosition = seekable || readOnly;
  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-2', className)}>
      <span className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatTime(currentSeconds * 1000)}
      </span>
      <input
        type="range"
        min={0}
        max={durationSeconds > 0 ? durationSeconds : 1}
        step={0.1}
        value={showsPosition ? Math.min(durationSeconds, Math.max(0, currentSeconds)) : 0}
        disabled={!seekable}
        readOnly={readOnly}
        onChange={(event) => onSeek?.(Number(event.target.value))}
        aria-label={ariaLabel}
        className={cn('h-1.5 min-w-[120px] flex-1 accent-primary', readOnly ? 'pointer-events-none' : 'cursor-pointer disabled:cursor-not-allowed disabled:opacity-40')}
      />
      <span className="w-9 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatTime(durationSeconds > 0 ? durationSeconds * 1000 : null)}
      </span>
    </div>
  );
}
