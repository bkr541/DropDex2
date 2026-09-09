import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRouletteTimeStretchProcessor } from './rouletteTimeStretch';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Roulette time-stretch processor lifecycle', () => {
  it('surfaces unsupported runtimes instead of falling back to pitch-shifting playback', async () => {
    vi.stubGlobal('Worker', undefined);
    const processor = createRouletteTimeStretchProcessor();

    await expect(processor.prepare({
      context: {} as AudioContext,
      buffer: {} as AudioBuffer,
      offsetSeconds: 0,
      sourceDurationSeconds: 1,
      tempoRatio: 142 / 140,
    })).rejects.toThrow(/unavailable in this runtime/);
  });
});
