import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import { quietPhaseState, quietStagePercent, type QuietPhase, type QuietProgressStatus } from './quietProgressMath';
import './quiet-progress.css';

export interface QuietProgressFigure { label: string; value: ReactNode }

interface QuietProgressProps {
  /** Names the job, for screen readers (for example "Rekordbox import"). */
  title: string;
  /** Overall progress, 0 to 100. */
  percent: number;
  /** Every phase of the job, in order. The last one is the finished state. */
  phases: readonly QuietPhase[];
  /** The phase the job is in now. */
  activeIndex: number;
  /** How far through the current phase it is, 0 to 100. Worked out from `percent` when left out. */
  stagePercent?: number;
  /** One plain sentence about what is happening now. */
  headline?: ReactNode;
  status?: QuietProgressStatus;
  /** Up to three numbers about the job, centred in their own cells under the phases. */
  figures?: readonly QuietProgressFigure[];
  /** What the right of the top line says. Defaults to "Phase 3 of 5"; use it for a state such as "Stopped". */
  caption?: ReactNode;
  /** Anything that goes under the figures: notices, buttons. */
  children?: ReactNode;
  className?: string;
}

/**
 * The app's one progress display (the Quiet Figure look): a light percentage, the job's phases as numbered hairline segments (finished
 * ones filled, the current one filling, the rest empty), one sentence about what is happening, and optional figures. Used by every
 * progress popover and panel: the Rekordbox import, the artist set search, the cloud sync, resuming analysis and the background import.
 */
export function QuietProgress({
  title, percent, phases, activeIndex, stagePercent, headline, status = 'running', figures, caption, children, className,
}: QuietProgressProps) {
  const done = status === 'done';
  const failed = status === 'failed';
  const shown = done ? 100 : Math.round(Math.max(0, Math.min(100, percent)));
  const current = stagePercent ?? quietStagePercent(activeIndex, phases.length, percent);
  const accent = done ? 'var(--qp-done)' : failed ? 'var(--qp-failed)' : 'var(--qp-accent)';

  return (
    <section className={cn('qp', className)} aria-label={`${title} progress`} data-testid="quiet-progress" data-status={status}>
      <div className="qp-head">
        <p className="qp-percent" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown} aria-label={`${title} progress`}>{shown}<span>%</span></p>
        <p className="qp-label">{caption ?? `Phase ${Math.min(activeIndex, phases.length - 1) + 1} of ${phases.length}`}</p>
      </div>
      <ol aria-label={`${title} phases`} className="qp-phases" data-testid="quiet-phases" style={{ ['--qp-bar-accent' as string]: accent }}>
        {phases.map((phase, i) => {
          const state = quietPhaseState(i, activeIndex, status);
          const fill = state === 'done' ? 100 : state === 'active' ? current : 0;
          return (
            <li key={phase.id} data-phase-state={state} aria-current={i === activeIndex ? 'step' : undefined}>
              <div className="qp-bar"><div style={{ width: `${fill}%` }} /></div>
              <p className="qp-num">{String(i + 1).padStart(2, '0')}</p>
              <p className="qp-name">{phase.label}</p>
            </li>
          );
        })}
      </ol>
      {headline != null && <p className="qp-headline">{headline}</p>}
      {figures && figures.length > 0 && (
        <div className="qp-figures">
          {figures.map(({ label, value }) => <div key={label}><p>{value}</p><small>{label}</small></div>)}
        </div>
      )}
      {children}
    </section>
  );
}
