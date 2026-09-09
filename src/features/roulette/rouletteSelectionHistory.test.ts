import { describe, expect, it } from 'vitest';
import { RouletteSelectionHistory, roulettePairKey } from './rouletteSelectionHistory';

describe('RouletteSelectionHistory', () => {
  it('keeps source and pair repeat-avoidance history bounded and most-recent-first for eviction', () => {
    const history = new RouletteSelectionHistory(2);
    history.rememberPair('vocal-a', 'inst-a');
    history.rememberPair('vocal-b', 'inst-b');
    history.rememberPair('vocal-c', 'inst-c');

    expect(history.snapshot()).toEqual({
      vocalTrackIds: ['vocal-b', 'vocal-c'],
      instrumentalTrackIds: ['inst-b', 'inst-c'],
      pairKeys: [
        roulettePairKey('vocal-b', 'inst-b'),
        roulettePairKey('vocal-c', 'inst-c'),
      ],
    });
  });

  it('refreshes an existing source/pair instead of growing duplicate history entries', () => {
    const history = new RouletteSelectionHistory(3);
    history.rememberPair('vocal-a', 'inst-a');
    history.rememberPair('vocal-b', 'inst-b');
    history.rememberPair('vocal-a', 'inst-a');

    expect(history.snapshot()).toEqual({
      vocalTrackIds: ['vocal-b', 'vocal-a'],
      instrumentalTrackIds: ['inst-b', 'inst-a'],
      pairKeys: [
        roulettePairKey('vocal-b', 'inst-b'),
        roulettePairKey('vocal-a', 'inst-a'),
      ],
    });
  });
});
