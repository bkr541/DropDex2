import { WaveformSectionRow } from './WaveformSectionRow';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { cn } from '../../../lib/utils';
import '../dropdex-media.css';

/** One horizontal strip of a timeline. All lanes share the same side inset, so times line up. */
export function TimelineLane({
  heightClass, children, className, overlay, contentRef,
}: {
  heightClass: string;
  children: ReactNode;
  className?: string;
  /** Drawn over the lane's edge, outside the clipped content, e.g. the hover zoom buttons. */
  overlay?: ReactNode;
  /** The clipped content box, for attaching wheel or pointer handlers. */
  contentRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div className={cn('cue-timeline__data-lane', overlay && 'relative', heightClass, className)}>
      <div ref={contentRef} className="relative h-full overflow-hidden">{children}</div>
      {overlay}
    </div>
  );
}

export interface TimelineSectionItem {
  id: string;
  label: string;
  color: string;
  leftPercent: number;
  widthPercent: number;
  title?: string;
}

/** Section labels and the trailing blank use the Audition waveform standard. */
export function TimelineSectionLane({
  sections, trailing, message, leadIn = true,
}: {
  sections: TimelineSectionItem[];
  trailing?: { leftPercent: number; widthPercent: number } | null;
  message?: ReactNode;
  leadIn?: boolean;
}) {
  return (
    <div className="cue-timeline__data-lane h-[28px]">
      <WaveformSectionRow sections={sections} trailing={trailing} message={message} leadIn={leadIn} />
    </div>
  );
}

export interface TimelineBeatTick {
  key: string;
  leftPercent: number;
  /** The first beat of a bar: a tall red tick. Other beats are short green ticks. */
  downbeat: boolean;
  title?: string;
}

export interface TimelineBeatLabel {
  key: string;
  leftPercent: number;
  text: ReactNode;
}

/** The beat ruler under a waveform: red bar ticks, green beat ticks and numbers beneath. */
export function TimelineBeatLane({
  ticks, labels, message, className, extendLeft = false,
}: {
  ticks: TimelineBeatTick[];
  labels: TimelineBeatLabel[];
  message?: ReactNode;
  className?: string;
  extendLeft?: boolean;
}) {
  const first = ticks[0];
  const period = ticks[1]?.leftPercent - (first?.leftPercent ?? 0);
  const bars = ticks.filter((tick) => tick.downbeat);
  const barPeriod = bars[1]?.leftPercent - (bars[0]?.leftPercent ?? 0);
  const lead = extendLeft && !message && period > 0 ? (
    <span className="timeline-beat-lead" aria-hidden="true">
      <span className="timeline-beat-lead__ticks" style={{
        width: `calc(var(--waveform-timeline-lead, 32px) + ${first.leftPercent}cqw)`,
        '--beat-lead-gap': `${period}cqw`,
      } as CSSProperties} />
      {barPeriod > 0 && <span className="timeline-beat-lead__ticks timeline-beat-lead__ticks--bar" style={{
        width: `calc(var(--waveform-timeline-lead, 32px) + ${bars[0].leftPercent}cqw)`,
        '--beat-lead-gap': `${barPeriod}cqw`,
      } as CSSProperties} />}
    </span>
  ) : undefined;
  return (
    <TimelineLane heightClass="h-[34px]" className={cn(className, extendLeft && 'timeline-beat-lane--extend')} overlay={lead}>
      {message ?? (
        <>
          {ticks.map((tick) => (
            <span
              key={tick.key}
              className={cn(
                'absolute -translate-x-1/2 rounded-full',
                tick.downbeat ? 'timeline-beat-tick timeline-beat-tick--bar top-[2px] h-[14px] w-[2px] bg-[#f87171]' : 'timeline-beat-tick top-[3px] h-[8px] w-[1.5px] bg-[#4ade80] opacity-90',
              )}
              style={{ left: `${tick.leftPercent}%` }}
              title={tick.title}
            />
          ))}
          {labels.map((label) => (
            <span
              key={label.key}
              className={cn(
                'timeline-beat-label absolute bottom-[3px] font-mono text-[10px] font-medium tabular-nums text-[#9ca5ae]',
                // Keep the first and last numbers inside the lane instead of half cut off.
                label.leftPercent <= 0.01 ? '' : label.leftPercent >= 99.99 ? '-translate-x-full' : '-translate-x-1/2',
              )}
              style={{ left: `${label.leftPercent}%` }}
            >
              {label.text}
            </span>
          ))}
        </>
      )}
    </TimelineLane>
  );
}
