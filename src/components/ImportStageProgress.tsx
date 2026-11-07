import { QuietProgress, quietOverallPercent, type QuietPhase, type QuietProgressStatus } from './ui/feedback';

export type ImportUiStep = 'source' | 'database' | 'analysis-files' | 'analyze' | 'complete';

export const STEP_ORDER: ImportUiStep[] = [
  'source',
  'database',
  'analysis-files',
  'analyze',
  'complete',
];

const PHASES: readonly QuietPhase[] = [
  { id: 'source', label: 'Source' },
  { id: 'database', label: 'Database' },
  { id: 'analysis-files', label: 'Analysis files' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'complete', label: 'Complete' },
];

const HEADLINES: Record<ImportUiStep, string> = {
  source: 'Choose where your Rekordbox library is.',
  database: 'Saving your library to DropDex.',
  'analysis-files': 'Uploading your analysis files.',
  analyze: 'Analysing your tracks.',
  complete: 'Your library is ready.',
};

/**
 * The Rekordbox import's progress display: the shared Quiet Figure look with the import's five phases. `stagePercent` is how far through
 * the current phase it is (the upload or the analysis), which gives the overall percentage.
 */
export function ImportStageProgress({ currentStep, stagePercent = 0, status = 'running' }: { currentStep: ImportUiStep; stagePercent?: number; status?: QuietProgressStatus }) {
  const activeIndex = STEP_ORDER.indexOf(currentStep);
  const done = currentStep === 'complete' && status !== 'failed';
  return (
    <QuietProgress
      title="Rekordbox import"
      phases={PHASES}
      activeIndex={activeIndex}
      percent={quietOverallPercent(activeIndex, PHASES.length, stagePercent, done)}
      stagePercent={stagePercent}
      status={done ? 'done' : status}
      headline={status === 'failed' ? 'The import stopped before it finished.' : HEADLINES[currentStep]}
      caption={status === 'failed' ? 'Stopped' : undefined}
    />
  );
}
