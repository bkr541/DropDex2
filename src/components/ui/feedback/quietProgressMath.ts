/** One phase of a long job. */
export interface QuietPhase { id: string; label: string }

export type QuietProgressStatus = 'running' | 'done' | 'failed';

export type QuietPhaseState = 'done' | 'active' | 'todo';

const clamp = (value: number, low = 0, high = 100) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));

/**
 * The overall percentage of a job from its phase. The last phase is "complete", so the working phases share 0 to 100 equally and a job
 * only reads 100 once it is done. `stagePercent` (0 to 100) is how far through the current phase it is; leave it out for 0.
 */
export function quietOverallPercent(activeIndex: number, phaseCount: number, stagePercent = 0, done = false): number {
  if (done) return 100;
  const working = Math.max(1, phaseCount - 1);
  return clamp(Math.round(((Math.min(activeIndex, working - 1) + clamp(stagePercent) / 100) / working) * 100), 0, 99);
}

/** How far through the current phase a job is, worked back from its overall percentage. */
export function quietStagePercent(activeIndex: number, phaseCount: number, percent: number): number {
  const working = Math.max(1, phaseCount - 1);
  return clamp(Math.round((percent / 100 * working - activeIndex) * 100));
}

export function quietPhaseState(index: number, activeIndex: number, status: QuietProgressStatus): QuietPhaseState {
  if (status === 'done' || index < activeIndex) return 'done';
  return index === activeIndex ? 'active' : 'todo';
}
