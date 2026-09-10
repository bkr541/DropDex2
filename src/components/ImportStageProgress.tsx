<title>ImportStageProgress</title>
import { CheckmarkFilled, DataBase, Document, Usb, Waveform } from '@carbon/icons-react';
import type React from 'react';
import { cn } from '../lib/utils';

export type ImportUiStep = 'source' | 'database' | 'analysis-files' | 'analyze' | 'complete';

export const STEP_ORDER: ImportUiStep[] = [
  'source',
  'database',
  'analysis-files',
  'analyze',
  'complete',
];

const STEP_CONFIG: Record<
  ImportUiStep,
  { label: string; Icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  source: { label: 'SOURCE', Icon: Usb },
  database: { label: 'DATABASE', Icon: DataBase },
  'analysis-files': { label: 'ANALYSIS FILES', Icon: Document },
  analyze: { label: 'ANALYZE', Icon: Waveform },
  complete: { label: 'COMPLETE', Icon: CheckmarkFilled },
};

export function ImportStageProgress({ currentStep }: { currentStep: ImportUiStep }) {
  const activeIdx = STEP_ORDER.indexOf(currentStep);

  return (
    <div className="w-full">
      <ol aria-label="Rekordbox import progress" className="grid grid-cols-5 w-full mb-2">
        {STEP_ORDER.map((stepId, index) => {
          const { label, Icon } = STEP_CONFIG[stepId];
          const isCompleted = index < activeIdx;
          const isActive = index === activeIdx;

          return (
            <li
              key={stepId}
              className="flex flex-col items-center gap-1"
              aria-current={isActive ? 'step' : undefined}
            >
              <div className="relative flex items-center justify-center shrink-0">
                <Icon
                  size={20}
                  className={cn(
                    isActive
                      ? 'text-[#168cff]'
                      : isCompleted
                        ? 'text-[#168cff]/55'
                        : 'text-[#3a4251]',
                  )}
                  aria-hidden
                />
                {isCompleted && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#168cff] flex items-center justify-center"
                    aria-hidden
                  >
                    <CheckmarkFilled size={7} className="text-white" aria-hidden />
                  </span>
                )}
              </div>

              <span
                className={cn(
                  'text-[9px] font-bold tracking-widest uppercase text-center leading-none whitespace-nowrap',
                  isActive
                    ? 'text-[#168cff]'
                    : isCompleted
                      ? 'text-[#168cff]/55'
                      : 'text-[#3a4251]',
                )}
              >
                {label}
              </span>

              <div
                className={cn(
                  'h-px w-6 rounded-full transition-colors duration-200',
                  isActive ? 'bg-[#168cff]' : 'bg-transparent',
                )}
                aria-hidden
              />
            </li>
          );
        })}
      </ol>

      {/* Progress rail with segment dots */}
      <div className="relative w-full" style={{ height: 12 }} aria-hidden>
        <div
          className="absolute top-1/2 -translate-y-1/2 bg-[var(--color-border-subtle)]"
          style={{ left: '10%', right: '10%', height: 1 }}
        />
        {activeIdx > 0 && (
          <div
            className="absolute top-1/2 -translate-y-1/2 bg-[#168cff] transition-all duration-300"
            style={{ left: '10%', width: `${activeIdx * 20}%`, height: 1 }}
          />
        )}
        {STEP_ORDER.map((stepId, index) => {
          const isCompleted = index < activeIdx;
          const isActive = index === activeIdx;
          return (
            <div
              key={stepId}
              className={cn(
                'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full transition-colors duration-200',
                isCompleted || isActive
                  ? 'bg-[#168cff]'
                  : 'bg-[var(--color-panel)] border border-[var(--color-border-subtle)]',
              )}
              style={{ left: `${10 + index * 20}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}
