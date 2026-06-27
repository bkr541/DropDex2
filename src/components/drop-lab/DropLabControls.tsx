import { FileText, Play, Square } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import type { DropLabBarCount, DropLabBeatOffset } from '../../lib/music/dropLabSegments';

interface DropLabControlsProps {
  beatOffset: DropLabBeatOffset;
  barCount: DropLabBarCount;
  previewLabel: string;
  previewDisabled: boolean;
  previewPlaying: boolean;
  disabledReason: string | null;
  onBeatOffsetChange: (offset: DropLabBeatOffset) => void;
  onBarCountChange: (count: DropLabBarCount) => void;
  onPreview: () => void;
  onTrackDetails: () => void;
  trackDetailsDisabled: boolean;
}

function ToggleButton({ active, children, onClick, ariaLabel }: { active: boolean; children: ReactNode; onClick: () => void; ariaLabel?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'px-3 py-2 rounded-lg border text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-primary/50',
        active
          ? 'bg-primary/20 border-primary/50 text-primary'
          : 'bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export function DropLabControls({
  beatOffset,
  barCount,
  previewLabel,
  previewDisabled,
  previewPlaying,
  disabledReason,
  onBeatOffsetChange,
  onBarCountChange,
  onPreview,
  onTrackDetails,
  trackDetailsDisabled,
}: DropLabControlsProps) {
  return (
    <div className="sticky bottom-3 z-20 mt-5 glass rounded-2xl border border-[var(--color-border-subtle)] p-3 shadow-2xl">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" aria-label="Beat alignment">
          <ToggleButton active={beatOffset === -1} onClick={() => onBeatOffsetChange(-1)}>- 1 Beat</ToggleButton>
          <ToggleButton active={beatOffset === 0} onClick={() => onBeatOffsetChange(0)}>Aligned</ToggleButton>
          <ToggleButton active={beatOffset === 1} onClick={() => onBeatOffsetChange(1)}>+ 1 Beat</ToggleButton>
        </div>
        <div className="h-8 w-px bg-[var(--color-border-subtle)] hidden sm:block" />
        <div className="flex flex-wrap gap-1" aria-label="Comparison window">
          {[4, 8, 16].map((count) => (
            <ToggleButton
              key={count}
              active={barCount === count}
              onClick={() => onBarCountChange(count as DropLabBarCount)}
            >
              {count} Bars
            </ToggleButton>
          ))}
        </div>
        <div className="flex-1 min-w-0" />
        <button
          type="button"
          onClick={onPreview}
          disabled={previewDisabled}
          title={disabledReason ?? undefined}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-xs font-black uppercase tracking-widest transition-all focus:outline-none focus:ring-2 focus:ring-primary/50',
            previewDisabled
              ? 'bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-muted-foreground cursor-not-allowed'
              : 'bg-primary text-white border-primary hover:opacity-90',
          )}
        >
          {previewPlaying ? <Square size={14} /> : <Play size={14} />}
          {previewLabel}
        </button>
        <button
          type="button"
          onClick={onTrackDetails}
          disabled={trackDetailsDisabled}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-xs font-bold text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <FileText size={14} />
          Track Details
        </button>
      </div>
    </div>
  );
}
