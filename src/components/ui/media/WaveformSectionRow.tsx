import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import './waveform-sections.css';

export interface WaveformSection {
  id: string;
  label: string;
  color: string;
  leftPercent: number;
  widthPercent: number;
  title?: string;
}

/** Phrase blocks share the waveform's time scale, with room before its first column. */
export function WaveformSectionRow({
  sections, message, leadIn = true, className, testId, sectionTestId = 'timeline-section',
  blankTestId = 'timeline-section-blank', trailing,
}: {
  sections: readonly WaveformSection[];
  message?: ReactNode;
  leadIn?: boolean;
  className?: string;
  testId?: string;
  sectionTestId?: string;
  blankTestId?: string;
  trailing?: { leftPercent: number; widthPercent: number } | null;
}) {
  const visible = sections
    .filter((section) => Number.isFinite(section.leftPercent) && Number.isFinite(section.widthPercent) && section.widthPercent > 0)
    .map((section) => {
      const left = Math.max(0, section.leftPercent);
      const right = Math.min(100, section.leftPercent + section.widthPercent);
      return { ...section, leftPercent: left, widthPercent: right - left };
    })
    .filter((section) => section.widthPercent > 0)
    .sort((a, b) => a.leftPercent - b.leftPercent);
  const lastEnd = visible.reduce((end, section) => Math.max(end, section.leftPercent + section.widthPercent), 0);
  const blank = trailing ?? (visible.length > 0 && lastEnd < 100 ? { leftPercent: lastEnd, widthPercent: 100 - lastEnd } : null);

  return (
    <div
      className={cn('waveform-section-row relative h-7', className)}
      data-testid={testId}
      style={{ '--waveform-section-lead': leadIn ? 'var(--waveform-timeline-lead, 32px)' : '0px' } as CSSProperties}
    >
      {message ?? (
        <>
          {visible.map((section, index) => {
            const opensView = index === 0 && section.leftPercent < 2;
            return (
              <div
                key={section.id}
                data-testid={sectionTestId}
                className="waveform-section absolute top-0 flex h-full items-center justify-center overflow-hidden px-1"
                title={section.title}
                style={{
                  left: opensView ? `calc(${section.leftPercent}% - var(--waveform-section-lead))` : `${section.leftPercent}%`,
                  width: opensView ? `calc(${section.widthPercent}% - 2px + var(--waveform-section-lead))` : `calc(${section.widthPercent}% - 2px)`,
                  '--section-ink': section.color,
                } as CSSProperties}
              >
                <span className="truncate">{section.label}</span>
              </div>
            );
          })}
          {blank && blank.widthPercent > 0 && (
            <div
              data-testid={blankTestId}
              aria-hidden="true"
              className="waveform-section waveform-section--blank absolute top-0 h-full"
              style={{ left: `${blank.leftPercent}%`, width: `${blank.widthPercent}%` }}
            />
          )}
        </>
      )}
    </div>
  );
}
