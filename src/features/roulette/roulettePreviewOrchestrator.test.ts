import { describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { RouletteCandidateAnalysis } from './rouletteMatching';
import type { RoulettePreviewPreparationState } from './roulettePreview';
import { createRoulettePreviewOrchestrator } from './roulettePreviewOrchestrator';

function candidate(id: string): RouletteCandidateAnalysis {
  return {
    track: { id } as RekordboxTrack,
    stemAsset: null,
    beatGrid: null,
    phraseCount: 0,
    vocalAnalysisAvailable: false,
  };
}

function ready(trackId: string, role: 'vocal' | 'instrumental'): RoulettePreviewPreparationState {
  return {
    trackId,
    role,
    status: 'ready',
    progress: 1,
    message: null,
    recoveryAction: 'none',
    requiredVolumeName: null,
    connectedVolumeName: null,
    window: null,
    asset: null,
  };
}

describe('Roulette preview orchestrator', () => {
  it('prepares only the two tracks in the selected initial pair and does so in top-then-bottom order', async () => {
    const prepare = vi.fn(async (track: RekordboxTrack, role: 'vocal' | 'instrumental') => ready(track.id, role));
    const selectInitialPair = vi.fn(async () => ({
      status: 'selected' as const,
      pair: {
        vocal: candidate('top'),
        instrumental: candidate('bottom'),
        score: 1,
        bpmDifference: 0,
      },
      diagnostics: {} as never,
    }));
    const orchestrator = createRoulettePreviewOrchestrator({ selectInitialPair, prepare });

    const result = await orchestrator.prepareInitialPair('import-1');
    expect(result.reason).toBeNull();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'top' }), 'vocal');
    expect(prepare).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'bottom' }), 'instrumental');
  });
});
