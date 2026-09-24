import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const context = readFileSync('src/features/roulette/RouletteSessionContext.tsx', 'utf8');

describe('Roulette HQ promotion coherence wiring', () => {
  it('cancels stale HQ work when the selected pair identity changes', () => {
    expect(context).toMatch(/previousPairIdentityRef\.current !== pairIdentity[\s\S]*?hqController\.cancel\(\)/);
  });

  it('revalidates the selected pair after HQ preparation and before committing promoted sources', () => {
    expect(context).toContain('const pairStillCurrent = () => (');
    expect(context).toMatch(/await hqController\.preparePair[\s\S]*?if \(!pairStillCurrent\(\)\)/);
    expect(context).toMatch(/await roulettePreviewPreparationService\.prepare[\s\S]*?if \(!pairStillCurrent\(\)\)/);
    expect(context).toMatch(/if \(!pairStillCurrent\(\)\)[\s\S]*?dispatch\(\{ type: 'update-source'/);
  });

  it('preserves the existing playable pair if HQ playback preflight cannot be promoted safely', () => {
    expect(context).toMatch(/try \{[\s\S]*?audio\.prepareSources[\s\S]*?\} catch \{/);
    expect(context).toContain('The existing playable pair was preserved.');
  });
});
