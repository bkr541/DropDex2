import { Add, Subtract } from '@carbon/icons-react';
import { cn } from '../../../lib/utils';

const BUTTON = 'pointer-events-auto flex h-[22px] w-[22px] items-center justify-center rounded-full text-foreground/90 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50';

/**
 * Zoom in / out as one rounded capsule that fades in when the waveform's
 * `group/waveform` parent is hovered. Position it by placing it inside that parent.
 */
export function WaveformZoomControls({
  onZoomIn,
  onZoomOut,
  canZoomIn,
  canZoomOut,
  className,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn('pointer-events-none absolute right-2 top-1/2 z-20 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/waveform:opacity-100', className)}
      aria-label="Waveform zoom controls"
    >
      <div className="flex flex-col rounded-full border border-[var(--color-border-faint)] bg-[var(--color-card)]/80 p-px backdrop-blur-sm">
        <button type="button" className={BUTTON} onClick={onZoomIn} disabled={!canZoomIn} aria-label="Zoom in" title="Zoom in">
          <Add size={16} />
        </button>
        <button type="button" className={BUTTON} onClick={onZoomOut} disabled={!canZoomOut} aria-label="Zoom out" title="Zoom out">
          <Subtract size={16} />
        </button>
      </div>
    </div>
  );
}
