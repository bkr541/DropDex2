import { describe, expect, it } from 'vitest';
import { extractRouletteStemPeaks } from './rouletteWaveform';

function fakeBuffer(channels: Float32Array[], sampleRate = 100) {
  return {
    duration: channels[0].length / sampleRate,
    length: channels[0].length,
    numberOfChannels: channels.length,
    sampleRate,
    getChannelData: (index: number) => channels[index],
  };
}

describe('Roulette stem waveform extraction', () => {
  it('derives normalized display peaks only from the requested decoded stem window', () => {
    const channel = new Float32Array(1000);
    channel[50] = 1; // outside requested window
    channel[250] = 0.25;
    channel[450] = 0.5;
    const peaks = extractRouletteStemPeaks(fakeBuffer([channel]), 2, 4, 4);

    expect(peaks).toHaveLength(4);
    expect(Math.max(...peaks)).toBe(1);
    expect(peaks[0]).toBeCloseTo(0.5, 5);
    expect(peaks[2]).toBeCloseTo(1, 5);
  });

  it('returns silence without fabricating visual energy', () => {
    const peaks = extractRouletteStemPeaks(fakeBuffer([new Float32Array(400)]), 0, 4, 8);
    expect(peaks).toEqual(new Array(8).fill(0));
  });
});
