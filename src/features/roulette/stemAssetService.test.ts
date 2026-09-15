import { describe, expect, it, vi } from 'vitest';
import type {
  DesktopStemAssetDeleteResult,
  DesktopStemAssetInspectResult,
  DesktopStemAssetSourceResult,
} from '../../types/dropdex-desktop';
import type {
  RegisterStemAssetRecordInput,
  StemAssetRepository,
} from '../../lib/queries/rouletteStemAssets';
import {
  STEM_ASSET_CONTRACT_VERSION,
  type StemAssetRecord,
  type StemAssetType,
} from './stemAssets';
import { createStemAssetService } from './stemAssetService';
import type { StemAudioMetrics } from './rouletteStemMetrics';


function metrics(durationMs = 120000): StemAudioMetrics {
  return {
    version: 'roulette-stem-metrics-v1',
    durationMs,
    rms: 0.08,
    signalRatio: 0.8,
    usableNonSilentDurationMs: Math.round(durationMs * 0.8),
    activityEvidence: 0.75,
    energyStability: 0.9,
    suitabilityScore: 0.82,
    bins: [{ startMs: 0, endMs: durationMs, rms: 0.08, signalRatio: 0.8, nonSilentRatio: 0.8 }],
  };
}

function makeAsset(overrides: Partial<StemAssetRecord> = {}): StemAssetRecord {
  return {
    id: 'asset-1',
    track_id: 'track-1',
    stem_type: 'vocals',
    installation_id: 'installation-1',
    status: 'ready',
    storage_locator: 'user-1/track-1/vocals/stem.wav',
    source_fingerprint: 'source-current',
    separator_version: 'separator-v1',
    contract_version: STEM_ASSET_CONTRACT_VERSION,
    duration_ms: 120000,
    sample_rate_hz: 48000,
    channel_count: 2,
    file_size_bytes: 2048,
    file_mtime_ms: 4567,
    analysis_metrics: null,
    failure_code: null,
    failure_message: null,
    created_at: '2026-09-08T00:00:00Z',
    updated_at: '2026-09-08T00:00:00Z',
    ...overrides,
  };
}

function harness(initial: StemAssetRecord | null = makeAsset()) {
  let asset = initial;
  const getAsset = vi.fn(async (_trackId: string, _stemType: StemAssetType) => asset);
  const getAssets = vi.fn(async () => asset ? [asset] : []);
  const getCurrentSourceFingerprint = vi.fn(async () => 'source-current');
  const upsertAsset = vi.fn(async (input: RegisterStemAssetRecordInput) => {
    asset = makeAsset({
      track_id: input.trackId,
      stem_type: input.stemType,
      installation_id: 'installation-1',
      status: input.status,
      storage_locator: input.storageLocator ?? null,
      source_fingerprint: input.sourceFingerprint,
      separator_version: input.separatorVersion ?? null,
      duration_ms: input.durationMs ?? null,
      sample_rate_hz: input.sampleRateHz ?? null,
      channel_count: input.channelCount ?? null,
      file_size_bytes: input.fileSizeBytes ?? null,
      file_mtime_ms: input.fileMtimeMs ?? null,
      analysis_metrics: input.analysisMetrics ?? null,
      failure_code: input.failureCode ?? null,
      failure_message: input.failureMessage ?? null,
    });
    return asset;
  });
  const updateStatus: StemAssetRepository['updateStatus'] = vi.fn(async (
    _trackId,
    _stemType,
    status,
    updates = {},
  ) => {
    if (!asset) throw new Error('missing asset');
    asset = { ...asset, status, ...updates };
    return asset;
  });
  const commitReadyPair: StemAssetRepository['commitReadyPair'] = vi.fn(async (input) => {
    const now = '2026-09-08T00:00:00Z';
    return [
      makeAsset({
        track_id: input.trackId, stem_type: 'vocals', status: 'ready',
        storage_locator: input.vocals.locator, source_fingerprint: input.sourceFingerprint,
        separator_version: input.separatorVersion, duration_ms: input.vocals.durationMs,
        sample_rate_hz: input.vocals.sampleRateHz, channel_count: input.vocals.channelCount,
        file_size_bytes: input.vocals.fileSizeBytes, file_mtime_ms: input.vocals.fileMtimeMs,
        analysis_metrics: input.vocals.analysisMetrics, updated_at: now,
      }),
      makeAsset({
        id: 'asset-2', track_id: input.trackId, stem_type: 'instrumental', status: 'ready',
        storage_locator: input.instrumental.locator, source_fingerprint: input.sourceFingerprint,
        separator_version: input.separatorVersion, duration_ms: input.instrumental.durationMs,
        sample_rate_hz: input.instrumental.sampleRateHz, channel_count: input.instrumental.channelCount,
        file_size_bytes: input.instrumental.fileSizeBytes, file_mtime_ms: input.instrumental.fileMtimeMs,
        analysis_metrics: input.instrumental.analysisMetrics, updated_at: now,
      }),
    ];
  });
  const claimLegacyAsset = vi.fn(async () => {
    if (!asset) throw new Error('missing asset');
    asset = { ...asset, installation_id: 'installation-1' };
    return asset;
  });
  const deleteAsset = vi.fn(async () => { asset = null; });
  const repository: StemAssetRepository = {
    getAsset,
    getAssets,
    getCurrentSourceFingerprint,
    upsertAsset,
    updateStatus,
    commitReadyPair,
    deleteAsset,
    claimLegacyAsset,
  };

  const inspectStemAsset = vi.fn(async (): Promise<DesktopStemAssetInspectResult> => ({
    ok: true,
    asset: { size: 2048, mtimeMs: 4567 },
  }));
  const resolveStemAsset = vi.fn(async (): Promise<DesktopStemAssetSourceResult> => ({
    ok: true,
    source: {
      kind: 'url',
      url: 'dropdex-media://stem/token-1',
      size: 2048,
      mtimeMs: 4567,
    },
  }));
  const deleteStemAsset = vi.fn(async (): Promise<DesktopStemAssetDeleteResult> => ({
    ok: true,
    deleted: true,
  }));
  const desktop = { inspectStemAsset, resolveStemAsset, deleteStemAsset };
  const service = createStemAssetService({ repository, getDesktopBridge: () => desktop });

  return {
    service,
    repository,
    desktop,
    get currentAsset() { return asset; },
  };
}

describe('Roulette stem asset service', () => {
  it('registers a ready asset only after the desktop boundary verifies managed media', async () => {
    const test = harness(null);
    const registered = await test.service.register({
      trackId: 'track-1',
      stemType: 'vocals',
      status: 'ready',
      storageLocator: 'user-1/track-1/vocals/stem.wav',
      separatorVersion: 'separator-v1',
      durationMs: 120000,
    });

    expect(test.desktop.inspectStemAsset).toHaveBeenCalledWith(
      'user-1/track-1/vocals/stem.wav',
    );
    expect(registered).toMatchObject({
      status: 'ready',
      source_fingerprint: 'source-current',
      file_size_bytes: 2048,
      file_mtime_ms: 4567,
    });
  });

  it('resolves a ready asset through the production desktop media bridge', async () => {
    const test = harness();
    const resolved = await test.service.resolveReady('track-1', 'vocals', {
      expectedSeparatorVersion: 'separator-v1',
    });

    expect(test.desktop.inspectStemAsset).toHaveBeenCalledTimes(1);
    expect(test.desktop.resolveStemAsset).toHaveBeenCalledWith(
      'user-1/track-1/vocals/stem.wav',
    );
    expect(resolved?.source.url).toBe('dropdex-media://stem/token-1');
  });

  it('invalidates metadata without auto-deleting HQ media when the parent source fingerprint changes', async () => {
    const test = harness(makeAsset({ source_fingerprint: 'source-old' }));
    const readiness = await test.service.getReadiness('track-1', 'vocals');

    expect(test.desktop.deleteStemAsset).not.toHaveBeenCalled();
    expect(readiness.status).toBe('preparing');
    expect(test.currentAsset).toMatchObject({
      status: 'pending',
      storage_locator: null,
      source_fingerprint: 'source-current',
      failure_code: 'source_fingerprint_mismatch',
    });
  });

  it('treats ready metadata with a missing local file as unavailable without rewriting cloud history', async () => {
    const test = harness();
    test.desktop.inspectStemAsset.mockResolvedValueOnce({
      ok: false as const,
      error: { kind: 'not_found' as const, message: 'missing' },
    });

    const readiness = await test.service.getReadiness('track-1', 'vocals');
    expect(readiness.status).toBe('unavailable');
    expect(readiness.reason).toContain('not available on this installation');
    expect(test.currentAsset).toMatchObject({ status: 'ready', installation_id: 'installation-1' });
    expect(test.repository.updateStatus).not.toHaveBeenCalled();
    expect(test.desktop.deleteStemAsset).not.toHaveBeenCalled();
  });

  it('treats a changed local file as unavailable without erasing the durable ready record', async () => {
    const test = harness();
    test.desktop.inspectStemAsset.mockResolvedValueOnce({
      ok: true as const,
      asset: { size: 9999, mtimeMs: 4567 },
    });

    const readiness = await test.service.getReadiness('track-1', 'vocals');
    expect(readiness.status).toBe('unavailable');
    expect(test.currentAsset).toMatchObject({ status: 'ready', installation_id: 'installation-1' });
    expect(test.repository.updateStatus).not.toHaveBeenCalled();
  });

  it('claims a legacy unscoped row only after its local file is proven present', async () => {
    const test = harness(makeAsset({ installation_id: null }));
    const readiness = await test.service.getReadiness('track-1', 'vocals', {
      expectedSeparatorVersion: 'separator-v1',
    });

    expect(readiness.status).toBe('ready');
    expect(test.repository.claimLegacyAsset).toHaveBeenCalledWith('asset-1');
    expect(readiness.asset?.installation_id).toBe('installation-1');
  });

  it('rejects a separator-version mismatch before returning playable media', async () => {
    const test = harness();
    const resolved = await test.service.resolveReady('track-1', 'vocals', {
      expectedSeparatorVersion: 'separator-v2',
    });

    expect(resolved).toBeNull();
    expect(test.desktop.resolveStemAsset).not.toHaveBeenCalled();
    expect(test.currentAsset?.failure_code).toBe('separator_version_mismatch');
  });

  it('marks a missing canonical asset failed without requiring a pre-existing row', async () => {
    const test = harness(null);
    const failed = await test.service.markFailed(
      'track-1',
      'instrumental',
      'separator_crashed',
      'Separator failed.',
    );
    expect(failed).toMatchObject({
      stem_type: 'instrumental',
      installation_id: 'installation-1',
      status: 'failed',
      source_fingerprint: 'source-current',
      failure_code: 'separator_crashed',
    });
  });

  it('commits both validated worker outputs through the atomic repository pair operation', async () => {
    const test = harness(null);
    const rows = await test.service.commitReadyPair({
      trackId: 'track-1',
      sourceFingerprint: 'source-current',
      separatorVersion: 'separator-v1',
      outputs: {
        vocals: { locator: 'generated/a/b/vocals.wav', durationMs: 120000, sampleRateHz: 48000, channelCount: 2, size: 2048, mtimeMs: 4567, metrics: metrics() },
        instrumental: { locator: 'generated/a/b/instrumental.wav', durationMs: 120000, sampleRateHz: 48000, channelCount: 2, size: 2048, mtimeMs: 4567, metrics: metrics() },
      },
    });

    expect(test.desktop.inspectStemAsset).toHaveBeenCalledTimes(2);
    expect(test.repository.commitReadyPair).toHaveBeenCalledTimes(1);
    expect(test.repository.commitReadyPair).toHaveBeenCalledWith(expect.objectContaining({
      vocals: expect.objectContaining({ analysisMetrics: expect.objectContaining({ version: 'roulette-stem-metrics-v1' }) }),
      instrumental: expect.objectContaining({ analysisMetrics: expect.objectContaining({ version: 'roulette-stem-metrics-v1' }) }),
    }));
    expect(rows.map((row) => row.stem_type)).toEqual(['vocals', 'instrumental']);
  });

  it('deletes local managed media before removing the durable record', async () => {
    const test = harness();
    await test.service.delete('track-1', 'vocals');
    expect(test.desktop.deleteStemAsset).toHaveBeenCalledTimes(1);
    expect(test.repository.deleteAsset).toHaveBeenCalledWith('track-1', 'vocals');
    expect(test.currentAsset).toBeNull();
  });
});
