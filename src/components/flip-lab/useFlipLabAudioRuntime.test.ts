import { describe, expect, it } from 'vitest';
import { roulettePreparedAssetRef, type RoulettePreparedAuditionAsset, type RoulettePreviewWindow } from '../../features/roulette/roulettePreview';
import type { FlipLabStemRoleState } from './flipLabStemLifecycle';
import {
  availableFlipLabLoopBars,
  clampFlipLabEqDb,
  flipLabBarDurationSeconds,
  formatFlipLabEqDb,
  resolveFlipLabEqualPowerMix,
  resolveFlipLabLoopEndSeconds,
  resolveFlipLabMasterBpm,
  resolveFlipLabPlaybackSources,
  resolveFlipLabPlayheadPercent,
  resolveFlipLabPreparedPlayheadPercent,
} from './useFlipLabAudioRuntime';

function windowAt(sourceTimeMs: number): RoulettePreviewWindow {
  return {
    sourceTimeMs,
    windowEndMs: sourceTimeMs + 27_000,
    durationMs: 27_000,
    sourceBar: 9,
    sourceBeatSequence: 33,
    requestedBars: 16,
    provenance: 'phrase',
  };
}

function readyState(role: 'vocal' | 'instrumental', trackId: string, sourceTimeMs: number): FlipLabStemRoleState {
  const window = windowAt(sourceTimeMs);
  const asset = {
    kind: 'preview',
    role,
    trackId,
    sourceFingerprint: `fp-${trackId}`,
    algorithmVersion: 'test',
    window,
    output: {
      locator: `preview/${trackId}/${role}.wav`,
      durationMs: window.durationMs,
      sampleRateHz: 48_000,
      channelCount: 2,
      size: 1234,
      mtimeMs: 99,
      metrics: {},
    },
    cached: true,
  } as RoulettePreparedAuditionAsset;
  return {
    role,
    trackId,
    stemType: role === 'vocal' ? 'vocals' : 'instrumental',
    status: 'ready',
    progress: 1,
    message: null,
    window,
    asset,
  };
}

describe('Flip Lab shared Roulette runtime adapter', () => {
  it('builds playback selections from the actual prepared role media rather than parent-track audio', () => {
    const vocal = readyState('vocal', 'vocal-track', 12_000);
    const instrumental = readyState('instrumental', 'instrumental-track', 8_000);
    const sources = resolveFlipLabPlaybackSources(vocal, instrumental, 'vocal-track', 'instrumental-track');

    expect(sources).not.toBeNull();
    expect(sources?.vocal).toMatchObject({
      parentTrackId: 'vocal-track',
      stemRef: roulettePreparedAssetRef(vocal.asset!),
      stemStatus: 'ready',
      window: vocal.window,
    });
    expect(sources?.instrumental).toMatchObject({
      parentTrackId: 'instrumental-track',
      stemRef: roulettePreparedAssetRef(instrumental.asset!),
      stemStatus: 'ready',
      window: instrumental.window,
    });
  });

  it('refuses playback sources until both selected role media are truly ready', () => {
    const vocal = readyState('vocal', 'vocal-track', 12_000);
    const instrumental = { ...readyState('instrumental', 'instrumental-track', 8_000), status: 'processing' as const };
    expect(resolveFlipLabPlaybackSources(vocal, instrumental, 'vocal-track', 'instrumental-track')).toBeNull();
  });

  it('derives the displayed master BPM from the same instrumental-master Roulette policy', () => {
    expect(resolveFlipLabMasterBpm(140, 142, true)).toBe(142);
    expect(resolveFlipLabMasterBpm(140, 142, false)).toBe(142);
    expect(flipLabBarDurationSeconds(142)).toBeCloseTo(240 / 142, 12);
  });


  it('uses equal-power mix gains with a balanced center and role attenuation at each edge', () => {
    const center = resolveFlipLabEqualPowerMix(0.5);
    expect(center.vocal.gain).toBeCloseTo(Math.SQRT1_2, 10);
    expect(center.instrumental.gain).toBeCloseTo(Math.SQRT1_2, 10);

    const vocalEdge = resolveFlipLabEqualPowerMix(0);
    expect(vocalEdge.vocal.gain).toBeCloseTo(1, 10);
    expect(vocalEdge.instrumental.gain).toBeCloseTo(0, 10);

    const instrumentalEdge = resolveFlipLabEqualPowerMix(1);
    expect(instrumentalEdge.vocal.gain).toBeCloseTo(0, 10);
    expect(instrumentalEdge.instrumental.gain).toBeCloseTo(1, 10);
  });

  it('keeps displayed EQ dB values bounded and derived from the same control state', () => {
    expect(clampFlipLabEqDb(3.26)).toBe(3.5);
    expect(clampFlipLabEqDb(-30)).toBe(-12);
    expect(formatFlipLabEqDb(3.26)).toBe('+3.5 dB');
    expect(formatFlipLabEqDb(0)).toBe('0.0 dB');
  });

  it('derives shared loop bounds from the prepared beat-aligned master BPM without exceeding the window', () => {
    const result = { masterBpm: 120, durationSeconds: 32 };
    expect(resolveFlipLabLoopEndSeconds(result, 4)).toBe(8);
    expect(resolveFlipLabLoopEndSeconds(result, 8)).toBe(16);
    expect(resolveFlipLabLoopEndSeconds(result, 16)).toBe(32);
    expect(resolveFlipLabLoopEndSeconds(result, 32)).toBeNull();
    expect(resolveFlipLabLoopEndSeconds(result, 'off')).toBeNull();
    expect(availableFlipLabLoopBars(result)).toEqual([4, 8, 16, 'off']);
  });

  it('maps the prepared-stem waveform playhead to the audition window rather than the parent track timeline', () => {
    expect(resolveFlipLabPreparedPlayheadPercent(8, 32)).toBe(25);
    expect(resolveFlipLabPreparedPlayheadPercent(40, 32)).toBe(100);
  });

  it('maps one shared runtime position into each source timeline for truthful playheads', () => {
    const compatibility = {
      originalBpm: { vocal: 140, instrumental: 142 },
      masterBpm: 142,
      bpmDifference: 2,
      camelotKey: { vocal: '9A', instrumental: '9A' },
      keyRelationship: 'exact' as const,
      tempoAdjustmentPercent: { vocal: (142 / 140 - 1) * 100, instrumental: 0 },
    };

    const vocalPercent = resolveFlipLabPlayheadPercent({
      role: 'vocal',
      positionSeconds: 7,
      durationSeconds: 27,
      trackDurationMs: 60_000,
      window: windowAt(12_000),
      compatibility,
      syncEnabled: true,
    });
    const instrumentalPercent = resolveFlipLabPlayheadPercent({
      role: 'instrumental',
      positionSeconds: 7,
      durationSeconds: 27,
      trackDurationMs: 60_000,
      window: windowAt(8_000),
      compatibility,
      syncEnabled: true,
    });

    expect(vocalPercent).toBeCloseTo(((12_000 + 7_000 * (142 / 140)) / 60_000) * 100, 10);
    expect(instrumentalPercent).toBeCloseTo(((8_000 + 7_000) / 60_000) * 100, 10);
  });
});
