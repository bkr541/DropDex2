import { CheckmarkFilled, DataBase, Document, Usb, Waveform } from '@carbon/icons-react';
import { motion } from 'motion/react';
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
              {/* Icon — remounts when activated; bounces 1 → 1.2 → 1 */}
              <motion.div
                key={`${stepId}-${isActive}`}
                className="relative flex items-center justify-center shrink-0"
                initial={{ scale: 1 }}
                animate={isActive ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                transition={{ duration: 0.38, ease: [0.34, 1.56, 0.64, 1] }}
              >
                <Icon
                  size={20}
                  className={cn(
                    'transition-colors duration-200',
                    isActive
                      ? 'text-[#168cff]'
                      : isCompleted
                        ? 'text-green-500'
                        : 'text-[#3a4251]',
                  )}
                  aria-hidden
                />
                {isCompleted && (
                  <motion.span
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                    className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 flex items-center justify-center"
                    aria-hidden
                  >
                    <CheckmarkFilled size={7} className="text-white" aria-hidden />
                  </motion.span>
                )}
              </motion.div>

              {/* Label */}
              <span
                className={cn(
                  'text-[9px] font-bold tracking-widest uppercase text-center leading-none whitespace-nowrap transition-colors duration-200',
                  isActive
                    ? 'text-[#168cff]'
                    : isCompleted
                      ? 'text-green-500'
                      : 'text-[#3a4251]',
                )}
              >
                {label}
              </span>

              {/* Active underline — grows from center */}
              <motion.div
                className="h-px w-6 rounded-full bg-[#168cff]"
                animate={{ scaleX: isActive ? 1 : 0, opacity: isActive ? 1 : 0 }}
                style={{ originX: 0.5 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
                aria-hidden
              />
            </li>
          );
        })}
      </ol>

      {/* Progress rail */}
      <div className="relative w-full" style={{ height: 12 }} aria-hidden>
        {/* Track */}
        <div
          className="absolute top-1/2 -translate-y-1/2 bg-[var(--color-border-subtle)]"
          style={{ left: '10%', right: '10%', height: 1 }}
        />
        {/* Fill — animated width, green for completed progress */}
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 bg-green-500"
          style={{ left: '10%', height: 1 }}
          animate={{ width: `${activeIdx * 20}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
        {/* Dots */}
        {STEP_ORDER.map((stepId, index) => {
          const isCompleted = index < activeIdx;
          const isActive = index === activeIdx;
          return (
            <motion.div
              key={stepId}
              className={cn(
                'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full',
                isCompleted
                  ? 'bg-green-500'
                  : isActive
                    ? 'bg-[#168cff]'
                    : 'bg-[var(--color-panel)] border border-[var(--color-border-subtle)]',
              )}
              style={{ left: `${10 + index * 20}%` }}
              animate={{ scale: isCompleted || isActive ? 1 : 0.7 }}
              transition={{ type: 'spring', stiffness: 450, damping: 24 }}
            />
          );
        })}
      </div>
    </div>
  );
}
