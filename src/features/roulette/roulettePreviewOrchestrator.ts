import { rouletteCandidateIndex, type RouletteInitialPairSelection } from './rouletteCandidateIndex';
import { roulettePreviewPreparationService } from './roulettePreviewPreparationService';
import type { RoulettePreviewPreparationState } from './roulettePreview';

export interface RouletteInitialPreviewResult {
  pair: RouletteInitialPairSelection | null;
  vocal: RoulettePreviewPreparationState | null;
  instrumental: RoulettePreviewPreparationState | null;
  reason: string | null;
}

export interface RoulettePreviewOrchestratorDependencies {
  selectInitialPair: typeof rouletteCandidateIndex.selectInitialPair;
  prepare: typeof roulettePreviewPreparationService.prepare;
}

export function createRoulettePreviewOrchestrator(
  dependencies: RoulettePreviewOrchestratorDependencies = {
    selectInitialPair: rouletteCandidateIndex.selectInitialPair,
    prepare: roulettePreviewPreparationService.prepare,
  },
) {
  const prepareInitialPair = async (importId?: string): Promise<RouletteInitialPreviewResult> => {
    const selection = await dependencies.selectInitialPair(importId ? { importId } : {});
    if (selection.status !== 'selected' || !selection.pair) {
      return { pair: null, vocal: null, instrumental: null, reason: 'No eligible Roulette pair is available.' };
    }

    // Intentionally serial. Stage 3 allows only one active separation job and
    // the preparation service also enforces this invariant for retries/resumes.
    const vocal = await dependencies.prepare(selection.pair.vocal.track, 'vocal');
    const instrumental = await dependencies.prepare(selection.pair.instrumental.track, 'instrumental');
    return { pair: selection.pair, vocal, instrumental, reason: null };
  };

  return { prepareInitialPair };
}

export const roulettePreviewOrchestrator = createRoulettePreviewOrchestrator();
