import { describe, expect, it } from 'vitest';
import { analyzeAudioFeatures, barAtTime, detectKey, fftMagnitudes, indexAt } from './audioFeatures';

const sampleRate = 22050;
const tone = (hz: number, seconds: number, amp = 0.5) => Float32Array.from({ length: Math.floor(seconds * sampleRate) }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / sampleRate));

describe('audio features', () => {
  it('puts a pure tone in the right FFT bin', () => {
    const mags = fftMagnitudes(tone(1000, 0.2), 2048, 0);
    const peak = mags.indexOf(Math.max(...mags));
    expect(peak * sampleRate / 2048).toBeGreaterThan(980);
    expect(peak * sampleRate / 2048).toBeLessThan(1030);
  });

  it('shows a bass tone in the bass band and not the air band', async () => {
    const analysis = await analyzeAudioFeatures(tone(100, 3), sampleRate);
    const bass = analysis.bands[1]; const air = analysis.bands[5];
    const mid = Math.floor(bass.length / 2);
    expect(bass[mid]).toBeGreaterThan(air[mid]);
    expect(analysis.durationSec).toBeCloseTo(3, 1);
  });

  it('measures each bar of the grid it is given', async () => {
    const analysis = await analyzeAudioFeatures(tone(440, 4), sampleRate, { bars: [{ barIndex: 1, startSec: 0, endSec: 2 }, { barIndex: 2, startSec: 2, endSec: 4 }] });
    expect(analysis.bars).toHaveLength(2);
    expect(barAtTime(analysis, 2.5)?.barIndex).toBe(2);
    expect(analysis.bars[0].chromaSummary).toHaveLength(12);
  });

  it('finds the key from the notes in a chord', () => {
    const chroma = new Array(12).fill(0.05);
    [0, 4, 7].forEach((pc) => { chroma[pc] = 1; }); // C major triad
    const key = detectKey(chroma);
    expect(key.tonic).toBe('C');
    expect(key.mode).toBe('major');
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    const run = analyzeAudioFeatures(tone(440, 60), sampleRate, { signal: controller.signal });
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('finds the stored point for a time', async () => {
    const analysis = await analyzeAudioFeatures(tone(440, 2), sampleRate);
    expect(indexAt(analysis, 1)).toBeGreaterThan(0);
    expect(analysis.times[indexAt(analysis, 1)]).toBeLessThanOrEqual(1);
  });
});
