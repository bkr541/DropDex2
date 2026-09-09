import { describe, expect, it } from 'vitest';
import { wsolaTimeStretch } from './wsolaTimeStretch';

function sine(sampleRate: number, durationSeconds: number, frequencyHz: number): Float32Array {
  const samples = new Float32Array(Math.round(sampleRate * durationSeconds));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate);
  }
  return samples;
}

function estimateFrequency(samples: Float32Array, sampleRate: number): number {
  const trim = Math.min(Math.floor(sampleRate * 0.1), Math.floor(samples.length / 8));
  let crossings = 0;
  for (let index = Math.max(1, trim); index < samples.length - trim; index += 1) {
    if (samples[index - 1] <= 0 && samples[index] > 0) crossings += 1;
  }
  const durationSeconds = (samples.length - trim * 2) / sampleRate;
  return crossings / durationSeconds;
}

describe('Roulette WSOLA time stretch', () => {
  it('changes duration while preserving a stable test tone pitch', () => {
    const sampleRate = 12000;
    const source = sine(sampleRate, 4, 440);
    const tempoRatio = 142 / 140;
    const result = wsolaTimeStretch({ channels: [source], sampleRate, tempoRatio });

    expect(result.channels[0].length).toBe(Math.round(source.length / tempoRatio));
    expect(estimateFrequency(result.channels[0], sampleRate)).toBeCloseTo(440, 0);
  });

  it('supports slower direct-tempo correction without resampling pitch', () => {
    const sampleRate = 12000;
    const source = sine(sampleRate, 4, 330);
    const tempoRatio = 140 / 142;
    const result = wsolaTimeStretch({ channels: [source], sampleRate, tempoRatio });

    expect(result.channels[0].length).toBe(Math.round(source.length / tempoRatio));
    expect(estimateFrequency(result.channels[0], sampleRate)).toBeCloseTo(330, 0);
  });

  it('keeps synthetic downbeats aligned across a 64-bar direct-tempo stretch', () => {
    const sampleRate = 4000;
    const sourceBpm = 140;
    const targetBpm = 142;
    const bars = 64;
    const sourceBarSeconds = 240 / sourceBpm;
    const targetBarSeconds = 240 / targetBpm;
    const sourceDurationSeconds = bars * sourceBarSeconds;
    const source = new Float32Array(Math.round(sourceDurationSeconds * sampleRate));

    // A quiet carrier keeps WSOLA correlation deterministic between the stronger
    // synthetic downbeat bursts. The bursts let this test measure musical drift.
    for (let index = 0; index < source.length; index += 1) {
      source[index] = 0.035 * Math.sin((2 * Math.PI * 200 * index) / sampleRate);
    }
    const burstFrames = Math.round(sampleRate * 0.012);
    for (let bar = 0; bar < bars; bar += 1) {
      const start = Math.round(bar * sourceBarSeconds * sampleRate);
      for (let index = 0; index < burstFrames && start + index < source.length; index += 1) {
        const envelope = 1 - index / burstFrames;
        source[start + index] += 0.9 * envelope
          * Math.sin((2 * Math.PI * 700 * index) / sampleRate);
      }
    }

    const result = wsolaTimeStretch({
      channels: [source],
      sampleRate,
      tempoRatio: targetBpm / sourceBpm,
    }).channels[0];

    expect(result.length / sampleRate).toBeCloseTo(bars * targetBarSeconds, 3);
    let worstDownbeatErrorMs = 0;
    const searchFrames = Math.round(sampleRate * 0.03);
    for (let bar = 1; bar < bars; bar += 1) {
      const expectedFrame = Math.round(bar * targetBarSeconds * sampleRate);
      let bestFrame = expectedFrame;
      let bestMagnitude = -1;
      for (
        let frame = Math.max(0, expectedFrame - searchFrames);
        frame < Math.min(result.length, expectedFrame + searchFrames);
        frame += 1
      ) {
        const magnitude = Math.abs(result[frame]);
        if (magnitude > bestMagnitude) {
          bestMagnitude = magnitude;
          bestFrame = frame;
        }
      }
      const errorMs = Math.abs(bestFrame / sampleRate - bar * targetBarSeconds) * 1000;
      worstDownbeatErrorMs = Math.max(worstDownbeatErrorMs, errorMs);
    }

    expect(worstDownbeatErrorMs).toBeLessThan(20);
  });

});
