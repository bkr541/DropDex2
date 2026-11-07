import { describe, expect, it } from 'vitest';
import { waveformStateForTrack, type WaveformLoadState } from '../../lib/queries/waveformValidation';

const loadedA: WaveformLoadState = {
  status: 'loaded',
  trackId: 'track-a',
  waveform: {
    trackId: 'track-a',
    previewFormat: 'color',
    previewColumnCount: 1,
    previewColumns: [{ h: 20, r: 1, g: 2, b: 3 }],
    previewColumnsValid: true,
    inferredFormat: 'color',
    validationError: null,
    invalidReason: null,
    detailFormat: null,
    detailColumnCount: null,
    detailStorageBucket: null,
    detailStoragePath: null,
  },
};

describe('Review waveform state contract', () => {
  it('keeps each card scoped to its own track ID', () => {
    const states = new Map<string, WaveformLoadState>([['track-a', loadedA]]);
    expect(waveformStateForTrack(states, 'track-a')).toBe(loadedA);
    expect(waveformStateForTrack(states, 'track-b')).toEqual({ status: 'idle', trackId: 'track-b' });
  });

  it('represents unavailable, retryable failure, and invalid data distinctly', () => {
    const statuses: WaveformLoadState[] = [
      { status: 'unavailable', trackId: 'track-a' },
      { status: 'error', trackId: 'track-b', error: 'offline', retryable: true },
      { status: 'invalid', trackId: 'track-c', error: 'bad schema', reason: 'invalid', retryable: false },
    ];

    expect(statuses.map((state) => state.status)).toEqual(['unavailable', 'error', 'invalid']);
  });
});
