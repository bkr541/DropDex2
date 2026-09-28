import { describe, expect, it } from 'vitest';
import { roulettePreparedAssetRef, type RoulettePreparedAuditionAsset, type RoulettePreviewWindow } from '../../features/roulette/roulettePreview';
import type { FlipLabStemRoleState } from './flipLabStemLifecycle';
import {
  flipLabBarDurationSeconds,
  resolveFlipLabMasterBpm,
  resolveFlipLabPlaybackSources,
  resolveFlipLabPlayheadPercent,
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
