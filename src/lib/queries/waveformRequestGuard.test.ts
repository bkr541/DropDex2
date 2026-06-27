import { describe, expect, it } from 'vitest';
import {
  shouldAcceptWaveformResult,
  shouldExposeWaveformResult,
} from './waveformRequestGuard';

describe('waveform request invalidation', () => {
  it('switching from Track A to Track B while A is loading hides A completion', () => {
    const activeTrackIds = new Set(['track-b']);

    expect(shouldExposeWaveformResult('import-1', 'import-1', activeTrackIds, 'track-a')).toBe(false);
    expect(shouldExposeWaveformResult('import-1', 'import-1', activeTrackIds, 'track-b')).toBe(true);
  });

  it('Track A completing after Track B is ignored by the active selection', () => {
    const activeTrackIds = new Set(['track-b']);
    const trackARequestToken = 1;
    const trackBRequestToken = 2;

    expect(shouldAcceptWaveformResult(trackARequestToken, trackARequestToken)).toBe(true);
    expect(shouldAcceptWaveformResult(trackBRequestToken, trackBRequestToken)).toBe(true);
    expect(shouldExposeWaveformResult('import-1', 'import-1', activeTrackIds, 'track-a')).toBe(false);
    expect(shouldExposeWaveformResult('import-1', 'import-1', activeTrackIds, 'track-b')).toBe(true);
  });

  it('an older request for the same track cannot overwrite its retry', () => {
    const currentToken = 3;
    expect(shouldAcceptWaveformResult(currentToken, 2)).toBe(false);
    expect(shouldAcceptWaveformResult(currentToken, 3)).toBe(true);
  });

  it('a response from a previous import cannot be exposed', () => {
    expect(
      shouldExposeWaveformResult('import-new', 'import-old', new Set(['track-a']), 'track-a'),
    ).toBe(false);
  });
});
