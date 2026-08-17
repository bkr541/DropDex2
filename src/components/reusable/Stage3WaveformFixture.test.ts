import { describe, expect, it } from 'vitest';
import { buildDisplayBuckets, normalizeWaveform } from '../../lib/rekordbox/waveformRenderer';
import { createStage3WaveformState } from './stage3WaveformFixture';

describe('Stage 3 deterministic waveform fixture', () => {
  it('creates stable, valid PWV4 color columns without DOM bars', () => {
    const first = createStage3WaveformState('stage3-test');
    const second = createStage3WaveformState('stage3-test');
    expect(first).toEqual(second);
    expect(first.status).toBe('loaded');
    if (first.status !== 'loaded') throw new Error('fixture did not load');

    expect(first.waveform.previewFormat).toBe('PWV4');
    expect(first.waveform.previewColumnCount).toBe(420);
    expect(first.waveform.previewColumnsValid).toBe(true);
    expect(first.waveform.previewColumns).toHaveLength(420);
    for (const column of first.waveform.previewColumns) {
      expect('r' in column).toBe(true);
      expect(column.h).toBeGreaterThanOrEqual(0);
      expect(column.h).toBeLessThanOrEqual(127);
      if ('r' in column) {
        for (const channel of [column.r, column.g, column.b]) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it('flows through the production normalization and peak-preserving bucket renderer', () => {
    const state = createStage3WaveformState('stage3-buckets');
    if (state.status !== 'loaded') throw new Error('fixture did not load');
    const normalized = normalizeWaveform(state.waveform);
    if (!normalized) throw new Error('fixture did not normalize');
    const buckets = buildDisplayBuckets(normalized.cols, 96);

    expect(normalized.cols).toHaveLength(420);
    expect(buckets).toHaveLength(96);
    expect(Math.max(...buckets.map((column) => column.h))).toBeGreaterThan(0.5);
  });
});
