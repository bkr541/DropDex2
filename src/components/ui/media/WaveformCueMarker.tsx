import type { CSSProperties, HTMLAttributes } from 'react';
import { Label, Shield } from 'iconoir-react/regular';
import { cn } from '../../../lib/utils';
import './waveform-cue-marker.css';

export const CUE_FLAG_PALETTE = {
  A: '#d86c7d',
  B: '#5aa9d1',
  C: '#71b47b',
  D: '#a087d8',
  '1': '#d2a35b',
  '2': '#cd7fa9',
} as const;

export function cueFlagColor(label: string, fallback: string): string {
  return Object.hasOwn(CUE_FLAG_PALETTE, label)
    ? CUE_FLAG_PALETTE[label as keyof typeof CUE_FLAG_PALETTE]
    : fallback;
}

export function CueFlag({ label, rounded = false, fine = false }: { label: string; rounded?: boolean; fine?: boolean }) {
  const Icon = rounded ? Shield : Label;
  return (
    <span className={cn('cue-flag', fine && 'cue-flag--fine')} aria-hidden="true">
      <Icon className={cn('cue-flag__icon', rounded && 'cue-flag__icon--rounded')} width="100%" height="100%" preserveAspectRatio="none" />
      {label && <span className="cue-flag__label">{label}</span>}
    </span>
  );
}

interface WaveformCueMarkerProps extends HTMLAttributes<HTMLSpanElement> {
  label: string;
  color: string;
  memory?: boolean;
  selected?: boolean;
  compact?: boolean;
}

/** Fine Outline flags centered at the cue time on timelines and thumbnails. */
export function WaveformCueMarker({
  label, color, memory = false, selected = false, compact = false, className, style, ...props
}: WaveformCueMarkerProps) {
  return (
    <span
      {...props}
      className={cn('waveform-cue-marker', memory && 'waveform-cue-marker--memory', compact && 'waveform-cue-marker--compact', className)}
      data-selected={selected || undefined}
      style={{ '--waveform-cue-ink': cueFlagColor(label, color), ...style } as CSSProperties}
    >
      <CueFlag label={compact ? '' : label} fine />
    </span>
  );
}
