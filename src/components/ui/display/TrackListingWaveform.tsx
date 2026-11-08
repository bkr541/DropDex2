import type { WaveformLoadState } from '../../../lib/queries/waveformValidation';
import { cn } from '../../../lib/utils';
import { RekordboxPreviewWaveform } from '../../library/RekordboxPreviewWaveform';
import { WaveformCueMarker } from '../media/WaveformCueMarker';
import type { TrackCueMarker } from '../media/trackCueMarkers';
import './track-listing.css';

/** The gray the full-song waveform uses. */
const WAVEFORM_GRAY = '#8997AE';

export type TrackListingCue = TrackCueMarker;

/**
 * A listing row waveform with thin gray bars and a compact Fine Outline flag at each cue.
 * Reserved marker space keeps the waveforms aligned across rows.
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
      <div className="track-listing__cues" data-testid="track-listing-cue-lane" aria-hidden="true">
        {hasDuration && cues.map((cue) => (
          <WaveformCueMarker
            key={cue.id}
            aria-hidden="true"
            data-testid="track-listing-cue"
            label={cue.label ?? ''}
            color={cue.color}
            compact
            style={{ left: `${Math.min(100, Math.max(0, (cue.startMs / durationMs) * 100))}%` }}
          />
        ))}
      </div>
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
    </div>
  );
}
