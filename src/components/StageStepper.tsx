import { CheckmarkFilled } from '@carbon/icons-react';
import { motion } from 'motion/react';
import type React from 'react';
import { cn } from '../lib/utils';

export interface StageStep {
  id: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}

/**
 * The stage row used by long-running workflows (the Rekordbox import, the Discovery set search): an icon and label
 * for every stage, the active one in blue with an underline, finished ones in green with a tick, and a rail with
 * a dot per stage underneath. `failed` turns the active stage red.
 */
export function StageStepper({ steps, activeIndex, ariaLabel, failed = false }: {
  steps: readonly StageStep[];
  activeIndex: number;
  ariaLabel: string;
  failed?: boolean;
}) {
  const count = steps.length;
  const column = 100 / count;
  const edge = column / 2;
  const lastIndex = count - 1;

  return (
    <div className="w-full">
      <ol aria-label={ariaLabel} className="grid w-full mb-2" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
        {steps.map(({ id, label, Icon }, index) => {
          const isCompleted = index < activeIndex;
          const isActive = index === activeIndex;
          // The last stage being active means the workflow finished, so it shows as done (green).
          const isEffectivelyDone = isActive && index === lastIndex && !failed;
          const showGreen = isCompleted || isEffectivelyDone;
          const showRed = isActive && failed;
          const showBlue = isActive && !isEffectivelyDone && !failed;
          const tone = showRed ? 'text-red-400' : showBlue ? 'text-[#168cff]' : showGreen ? 'text-emerald-400' : 'text-[#3a4251]';

          return (
            <li key={id} className="flex flex-col items-center gap-1" aria-current={isActive ? 'step' : undefined}>
              {/* Icon — remounts when activated; bounces 1 → 1.2 → 1 */}
              <motion.div
                key={`${id}-${isActive}`}
                className="relative flex items-center justify-center shrink-0"
                initial={{ scale: 1 }}
                animate={isActive ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                transition={{ duration: 0.38, ease: [0.34, 1.56, 0.64, 1] }}
              >
                <Icon size={20} className={cn('transition-colors duration-200', tone)} aria-hidden />
                {showGreen && (
                  <motion.span
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                    className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 flex items-center justify-center"
                    aria-hidden
                  >
                    <CheckmarkFilled size={7} className="text-white" aria-hidden />
                  </motion.span>
                )}
              </motion.div>

              <span className={cn('text-[9px] font-bold tracking-widest uppercase text-center leading-none whitespace-nowrap transition-colors duration-200', tone)}>
                {label}
              </span>

              {/* Active underline — grows from the centre; green when done, red when failed, blue otherwise */}
              <motion.div
                className={cn('h-px w-6 rounded-full', showRed ? 'bg-red-400' : showBlue ? 'bg-[#168cff]' : 'bg-emerald-400')}
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
        <div className="absolute top-1/2 -translate-y-1/2 bg-[var(--color-border-subtle)]" style={{ left: `${edge}%`, right: `${edge}%`, height: 1 }} />
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 bg-emerald-400"
          style={{ left: `${edge}%`, height: 1 }}
          animate={{ width: `${activeIndex * column}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
        {steps.map(({ id }, index) => {
          const isCompleted = index < activeIndex;
          const isActive = index === activeIndex;
          const isEffectivelyDone = isActive && index === lastIndex && !failed;
          const showGreen = isCompleted || isEffectivelyDone;
          return (
            <motion.div
              key={id}
              className={cn(
                'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full',
                showGreen ? 'bg-emerald-400' : isActive ? (failed ? 'bg-red-400' : 'bg-[#168cff]') : 'bg-[var(--color-panel)] border border-[var(--color-border-subtle)]',
              )}
              style={{ left: `${edge + index * column}%` }}
              animate={{ scale: isCompleted || isActive ? 1 : 0.7 }}
              transition={{ type: 'spring', stiffness: 450, damping: 24 }}
            />
          );
        })}
      </div>
    </div>
  );
}
