import { describe, expect, it } from 'vitest';
import { formatRouletteCompatiblePairCount } from './useRouletteMatchingAvailability';

describe('Roulette compatible-pair count presentation', () => {
  it('renders an exact pair count without a plus sign', () => {
    expect(formatRouletteCompatiblePairCount(12, false)).toBe('12 compatible pairs');
    expect(formatRouletteCompatiblePairCount(1, false)).toBe('1 compatible pair');
  });

  it('renders a bounded pair count as a lower bound', () => {
    expect(formatRouletteCompatiblePairCount(512, true)).toBe('512+ compatible pairs');
  });
});
