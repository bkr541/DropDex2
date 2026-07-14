import { describe, expect, it } from 'vitest';
import { nextWaveformSeekFraction } from './waveformKeyboard';

describe('nextWaveformSeekFraction', () => {
  it('moves by the configured arrow-key step', () => {
    expect(nextWaveformSeekFraction('ArrowRight', 0.4, 0.025)).toBeCloseTo(
      0.425,
    );
    expect(nextWaveformSeekFraction('ArrowLeft', 0.4, 0.025)).toBeCloseTo(
      0.375,
    );
  });

  it('uses a larger page step and clamps at the track edges', () => {
    expect(nextWaveformSeekFraction('PageUp', 0.95)).toBe(1);
    expect(nextWaveformSeekFraction('PageDown', 0.05)).toBe(0);
  });

  it('supports Home and End and ignores unrelated keys', () => {
    expect(nextWaveformSeekFraction('Home', 0.4)).toBe(0);
    expect(nextWaveformSeekFraction('End', 0.4)).toBe(1);
    expect(nextWaveformSeekFraction('Enter', 0.4)).toBeNull();
  });
});
