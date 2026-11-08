import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';
import { RekordboxPreviewWaveform, type RekordboxPreviewWaveformProps } from '../../library/RekordboxPreviewWaveform';
import { WaveformSectionRow, type WaveformSection } from './WaveformSectionRow';
import { WaveformTimeRuler } from './WaveformTimeRuler';
import type { TimelineBeatLabel, TimelineBeatTick } from './TimelineLanes';
import { cueFlagColor } from './WaveformCueMarker';
import { waveformSectionInk } from './waveformPresentation';
import './track-timeline.css';

/** Library geometry. Workflow adapters may position audio, but cannot change its presentation. */
export const TRACK_TIMELINE_WAVEFORM_HEIGHT = 72;
// An explicit segment prevents the Rekordbox area renderer from using spectral source colors.
const STANDARD_COLOR_SEGMENTS = [{ startFraction: 0, endFraction: 1, color: '#8997AE' }];
export interface TrackTimelineWaveform extends Pick<RekordboxPreviewWaveformProps,
  'state' | 'colorSegments' | 'activeProgress' | 'onSeek' | 'onRetry' | 'ariaLabel'> {
  id: string;
  leftPercent?: number;
  widthPercent?: number;
  /** Used by Flip Lab's separation progress and solo controls. */
  fill?: number;
  muted?: boolean;
}

export interface TrackTimelineProps {
  sections: readonly WaveformSection[];
  /** Audition-only phrase and waveform highlighting. Other workspaces stay slate. */
  highlightDrops?: boolean;
  sectionMessage?: ReactNode;
  start: number;
  end: number;
  timeTicks: readonly { ms: number; label: string }[];
  /** Cue editing/selection handlers belong to the screen; marker visuals remain shared. */
  cues?: ReactNode;
  waveforms: readonly TrackTimelineWaveform[];
  waveformMessage?: ReactNode;
  cueLines?: readonly { id: string; leftPercent: number; label: string; color: string }[];
  waveformOverlay?: ReactNode;
  waveformControls?: ReactNode;
  waveformRef?: Ref<HTMLDivElement>;
  waveformProps?: HTMLAttributes<HTMLDivElement>;
  beatTicks: TimelineBeatTick[];
  beatLabels: TimelineBeatLabel[];
  beatMessage?: ReactNode;
  /** Overlays use the same content width as all five rows, including the lead-in. */
  overlay?: ReactNode;
  testIds?: { sections?: string; section?: string; blank?: string; cues?: string; beats?: string; beatLead?: string };
}

/** The complete Library red-box region. Always reserve all five rows, even without metadata. */
export function TrackTimeline({
  sections, highlightDrops = false, sectionMessage, start, end, timeTicks, cues, waveforms, waveformMessage,
  cueLines = [], waveformOverlay, waveformControls, waveformRef, waveformProps, beatTicks, beatLabels,
  beatMessage, overlay, testIds,
}: TrackTimelineProps) {
  const first = beatTicks[0];
  const period = beatTicks[1]?.leftPercent - (first?.leftPercent ?? 0);
  return (
    <div className="track-timeline" data-testid="track-timeline">
      <div className="track-timeline__content">
        <div className="track-timeline__sections" data-timeline-row="sections">
          <WaveformSectionRow sections={sections.map((section) => ({ ...section, color: waveformSectionInk(section.label, highlightDrops) }))} message={sectionMessage} testId={testIds?.sections}
            sectionTestId={testIds?.section} blankTestId={testIds?.blank} />
        </div>
        <div data-timeline-row="timestamps">
          <WaveformTimeRuler ticks={timeTicks} startMs={start} endMs={end} />
        </div>
        <div className="track-timeline__cues" data-timeline-row="cues" data-testid={testIds?.cues} aria-label="Cue points">
          {cues}
        </div>
        <div className="track-timeline__waveform group/waveform" data-timeline-row="waveform">
          <div {...waveformProps} ref={waveformRef}
            className={`track-timeline__audio ${waveformProps?.className ?? ''}`}>
            {waveformMessage ?? waveforms.map(({ id, leftPercent = 0, widthPercent = 100, fill = 1, muted, ...props }) => (
              <div key={id} className="track-timeline__audio-layer" style={{
                left: `${leftPercent}%`, width: `${widthPercent}%`,
                filter: muted ? 'grayscale(1) brightness(1.6)' : undefined, opacity: muted ? 0.45 : undefined,
              }} data-testid={muted ? 'flip-lab-waveform-muted' : undefined}>
                {fill < 1 && <div className="track-timeline__unfilled" aria-hidden="true">
                  <RekordboxPreviewWaveform {...props} colorSegments={highlightDrops && props.colorSegments?.length ? props.colorSegments : STANDARD_COLOR_SEGMENTS} height={TRACK_TIMELINE_WAVEFORM_HEIGHT} variant="detail"
                    appearance="rekordbox" renderMode="area" surface={false} showCenterLine={false} tint="#8997AE" />
                </div>}
                <div className="track-timeline__fill" data-testid={fill < 1 ? 'flip-lab-waveform-fill' : undefined}
                  style={{ clipPath: fill < 1 ? `inset(0 ${(1 - Math.max(0, Math.min(1, fill))) * 100}% 0 0)` : undefined }}>
                  <RekordboxPreviewWaveform {...props} colorSegments={highlightDrops && props.colorSegments?.length ? props.colorSegments : STANDARD_COLOR_SEGMENTS} height={TRACK_TIMELINE_WAVEFORM_HEIGHT} variant="detail"
                    appearance="rekordbox" renderMode="area" surface={false} showCenterLine={false} tint="#8997AE" />
                </div>
              </div>
            ))}
            {end > start && timeTicks.slice(1).filter((tick) => tick.ms >= start && tick.ms <= end).map((tick) => (
              <span key={`time-grid-${tick.ms}`} aria-hidden="true" className="track-timeline__time-line"
                style={{ left: `${(tick.ms - start) / (end - start) * 100}%` }} />
            ))}
            {cueLines.filter((cue) => cue.leftPercent >= 0 && cue.leftPercent <= 100).map((cue) => (
              <span key={cue.id} aria-hidden="true" className="track-timeline__cue-line"
                style={{ left: `${cue.leftPercent}%`, '--waveform-cue-ink': cueFlagColor(cue.label, cue.color) } as CSSProperties} />
            ))}
            {waveformOverlay}
          </div>
          {waveformControls}
        </div>
        <div className="track-timeline__beats" data-timeline-row="beats" data-testid={testIds?.beats}>
          {beatMessage ?? <>
            {period > 0 && <span className="track-timeline__beat-lead" data-testid={testIds?.beatLead} aria-hidden="true"
              style={{ width: `calc(var(--waveform-timeline-lead) + ${first.leftPercent}%)`,
                '--timeline-beat-gap': `${period}cqw` } as CSSProperties} />}
            {beatTicks.filter((tick) => tick.leftPercent >= 0 && tick.leftPercent <= 100).map((tick) => <span key={tick.key} title={tick.title} aria-hidden="true"
              className={`track-timeline__beat-tick${tick.downbeat ? ' track-timeline__beat-tick--bar' : ''}`}
              style={{ left: `${tick.leftPercent}%` }} />)}
            {beatLabels.filter((label) => label.leftPercent >= 0 && label.leftPercent <= 100).map((label) => <span key={label.key} className="track-timeline__beat-label"
              style={{ left: `${label.leftPercent}%`, transform: label.leftPercent <= 0.01 ? 'none' : label.leftPercent >= 99.99 ? 'translateX(-100%)' : undefined }}>{label.text}</span>)}
          </>}
        </div>
        {overlay}
      </div>
    </div>
  );
}
