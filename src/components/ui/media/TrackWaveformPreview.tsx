import { cn } from '../../../lib/utils';
import type { TrackCueMarker } from './trackCueMarkers';
import type { WaveformLoadState } from '../../../lib/queries/waveformValidation';
import { RekordboxPreviewWaveform } from '../../library/RekordboxPreviewWaveform';
import { WaveformCueMarker } from './WaveformCueMarker';

/**
 * Compact track-row waveform with cue markers above it, matching the Cue
 * Points track table. The marker row is always reserved so rows line up
 * whether or not a track has cues.
 */
export function TrackWaveformPreview({
  waveformState,
  durationMs,
  cues = [],
  height = 26,
  ariaLabel,
  className,
}: {
  waveformState: WaveformLoadState;
  durationMs: number | null;
  cues?: TrackCueMarker[];
  height?: number;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div className="relative h-3" aria-hidden="true">
        {durationMs != null && durationMs > 0 && cues.map((cue) => (
          <WaveformCueMarker
            key={cue.id}
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
        showCenterLine={false}
        surface={false}
        ariaLabel={ariaLabel}
      />
    </div>
  );
}
