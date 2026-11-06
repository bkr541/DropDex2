import type { CSSProperties } from 'react';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { RekordboxPreviewWaveform } from '../library/RekordboxPreviewWaveform';
import type { AuditionCueMarker } from './useAuditionTrackAnalysis';
import { cn } from '../../lib/utils';

/** The gray the full-song waveform uses for its non-drop sections. */
const ROW_WAVEFORM_GRAY = '#8997AE';

/**
 * A track row's waveform, drawn as bars in the same gray as the full-song waveform at the top of the page, with a dot in each cue's
 * colour above it. The dot row is always reserved so rows line up whether or not a track has cues.
 */
export function AuditionRowWaveform({
  waveformState, durationMs, cues = [], height = 18, ariaLabel, className,
}: {
  waveformState: WaveformLoadState;
  durationMs: number | null;
  cues?: AuditionCueMarker[];
  height?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const hasDuration = durationMs != null && durationMs > 0;
  return (
    <div className={cn('audition-row-wave flex min-w-0 flex-col', className)}>
      <div className="audition-row-cues relative" aria-hidden="true" data-testid="audition-row-cues">
        {hasDuration && cues.map((cue) => (
          <span
            key={cue.id}
            data-testid="audition-row-cue"
            className="audition-row-cue-dot"
            style={{ left: `${Math.min(100, Math.max(0, (cue.startMs / durationMs) * 100))}%`, '--audition-cue-ink': cue.color } as CSSProperties}
          />
        ))}
      </div>
      <RekordboxPreviewWaveform
        state={waveformState}
        height={height}
        variant="compact"
        appearance="dropdex"
        tint={ROW_WAVEFORM_GRAY}
        showCenterLine={false}
        surface={false}
        ariaLabel={ariaLabel}
      />
    </div>
  );
}
