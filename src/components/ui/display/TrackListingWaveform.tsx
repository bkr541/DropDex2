import type { CSSProperties } from 'react';
import type { WaveformLoadState } from '../../../lib/queries/waveformValidation';
import { cn } from '../../../lib/utils';
import { RekordboxPreviewWaveform } from '../../library/RekordboxPreviewWaveform';
import './track-listing.css';

/** The gray the full-song waveform uses. */
const WAVEFORM_GRAY = '#8997AE';

export interface TrackListingCue { id: string; startMs: number; color: string }

/**
 * A track's waveform for a listing row: thin gray bars, and on every cue a line in the cue's colour with an upside-down triangle sitting on top.
 * The space for the triangles is always kept, so rows line up whether or not a track has cues.
 */
export function TrackListingWaveform({
  waveformState, durationMs, cues = [], height = 18, ariaLabel, className, onSeek, onRetry, activeProgress,
}: {
  waveformState: WaveformLoadState;
  durationMs: number | null;
  cues?: readonly TrackListingCue[];
  height?: number;
  ariaLabel?: string;
  className?: string;
  onSeek?: (fraction: number) => void;
  /** Called by the retry button shown when the waveform failed to load. */
  onRetry?: () => void;
  /** 0 to 1: how much of the track has played, when this row's track is the one playing. */
  activeProgress?: number;
}) {
  const hasDuration = durationMs != null && durationMs > 0;
  return (
    <div className={cn('track-listing__wave flex min-w-0 flex-col', className)} data-testid="track-listing-wave">
      <div className="relative">
        <RekordboxPreviewWaveform
          state={waveformState}
          height={height}
          variant="compact"
          appearance="dropdex"
          tint={WAVEFORM_GRAY}
          showCenterLine={false}
          surface={false}
          ariaLabel={ariaLabel}
          onSeek={onSeek}
          onRetry={onRetry}
          activeProgress={activeProgress}
        />
        {hasDuration && cues.map((cue) => (
          <span
            key={cue.id}
            aria-hidden="true"
            data-testid="track-listing-cue"
            className="track-listing__cue"
            style={{ left: `${Math.min(100, Math.max(0, (cue.startMs / durationMs) * 100))}%`, '--cue-ink': cue.color } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
