import { CheckmarkFilled, DataBase, Document, Usb, Waveform } from '@carbon/icons-react';
import { StageStepper, type StageStep } from './StageStepper';

export type ImportUiStep = 'source' | 'database' | 'analysis-files' | 'analyze' | 'complete';

export const STEP_ORDER: ImportUiStep[] = [
  'source',
  'database',
  'analysis-files',
  'analyze',
  'complete',
];

const STEPS: readonly StageStep[] = [
  { id: 'source', label: 'SOURCE', Icon: Usb },
  { id: 'database', label: 'DATABASE', Icon: DataBase },
  { id: 'analysis-files', label: 'ANALYSIS FILES', Icon: Document },
  { id: 'analyze', label: 'ANALYZE', Icon: Waveform },
  { id: 'complete', label: 'COMPLETE', Icon: CheckmarkFilled },
];

export function ImportStageProgress({ currentStep }: { currentStep: ImportUiStep }) {
  return <StageStepper steps={STEPS} activeIndex={STEP_ORDER.indexOf(currentStep)} ariaLabel="Rekordbox import progress" />;
}
