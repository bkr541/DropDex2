import type { ReactNode, Ref } from 'react';
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

/**
 * The colored section names above a waveform: mono caps with a 2px underline.
 * `trailing` draws the gray bar that continues after the last section.
 */
export function TimelineSectionLane({
  sections, trailing, message,
}: {
  sections: TimelineSectionItem[];
  trailing?: { leftPercent: number; widthPercent: number } | null;
  /** Shown in place of the sections while loading or when there are none. */
  message?: ReactNode;
}) {
  return (
    <TimelineLane heightClass="h-[28px]">
      {message ?? (
        <>
          {sections.map((section) => (
            <div
              key={section.id}
              data-testid="timeline-section"
              className="absolute top-0 flex h-[22px] items-center justify-center overflow-hidden"
              style={{
                left: `${section.leftPercent}%`,
                width: `${section.widthPercent}%`,
                backgroundColor: 'transparent',
                borderBottom: `2px solid ${section.color}`,
              }}
              title={section.title}
            >
              <span
                className="whitespace-nowrap font-mono text-[9px] font-bold leading-none tracking-wide"
                style={{ color: section.color, textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}
              >
                {section.label.toUpperCase()}
              </span>
            </div>
          ))}
          {trailing && trailing.widthPercent > 0 ? (
            <div
              className="absolute top-0 h-[22px]"
              style={{ left: `${trailing.leftPercent}%`, width: `${trailing.widthPercent}%`, backgroundColor: 'transparent', borderBottom: '2px solid rgba(255,255,255,0.28)' }}
            />
          ) : null}
        </>
      )}
    </TimelineLane>
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
  ticks, labels, message,
}: {
  ticks: TimelineBeatTick[];
  labels: TimelineBeatLabel[];
  message?: ReactNode;
}) {
  return (
    <TimelineLane heightClass="h-[34px]">
      {message ?? (
        <>
          {ticks.map((tick) => (
            <span
              key={tick.key}
              className={cn(
                'absolute -translate-x-1/2 rounded-full',
                tick.downbeat ? 'top-[2px] h-[14px] w-[2px] bg-[#f87171]' : 'top-[3px] h-[8px] w-[1.5px] bg-[#4ade80] opacity-90',
              )}
              style={{ left: `${tick.leftPercent}%` }}
              title={tick.title}
            />
          ))}
          {labels.map((label) => (
            <span
              key={label.key}
              className={cn(
                'absolute bottom-[3px] font-mono text-[10px] font-medium tabular-nums text-[#9ca5ae]',
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
