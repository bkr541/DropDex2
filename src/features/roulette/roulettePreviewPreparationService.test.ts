import { describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type {
  DesktopRoulettePreviewPreparationInput,
  DesktopRoulettePreviewPreparationResult,
} from '../../types/dropdex-desktop';
import type { BeatGridRow, PhraseRow, VocalAnalysisRow } from '../../lib/queries/analysisData';
import type { StemAssetRepository } from '../../lib/queries/rouletteStemAssets';
import type { StemAssetReadiness, StemAssetRecord, StemAssetType } from './stemAssets';
import type { StemAssetService } from './stemAssetService';
import { ROULETTE_SEPARATOR_VERSION } from './stemAssets';
import { ROULETTE_PREVIEW_ALGORITHM_VERSION } from './roulettePreview';
import { createRoulettePreviewPreparationService } from './roulettePreviewPreparationService';

function metrics(durationMs: number) {
  return {
    version: 'roulette-stem-metrics-v1',
    durationMs,
    rms: 0.05,
    signalRatio: 0.8,
    usableNonSilentDurationMs: durationMs,
    activityEvidence: 0.7,
    energyStability: 0.9,
    suitabilityScore: 0.8,
    bins: [{ startMs: 0, endMs: durationMs, rms: 0.05, signalRatio: 0.8, nonSilentRatio: 0.9 }],
  };
}

function track(id: string, overrides: Partial<RekordboxTrack> = {}): RekordboxTrack {
  return {
    id,
    import_id: `import-${id}`,
    rekordbox_content_id: `content-${id}`,
    title: id,
    artist: 'Artist',
    album: null,
    remixer: null,
    genre: null,
    label: null,
    musical_key: 'Am',
    camelot_key: '8A',
    normalized_key_name: 'A minor',
    key_tonic: 'A',
    key_mode: 'minor',
    bpm: 120,
    duration_seconds: 120,
    duration_ms: 120_000,
    rating: null,
    comments: null,
    file_path: `/Volumes/USB-A/Contents/Artist/${id}.wav`,
    file_path_volume: 'USB-A',
    file_format: 'WAV',
    date_added: null,
    created_at: '2026-09-14T00:00:00Z',
    ...overrides,
  } as RekordboxTrack;
}

function grid(trackId: string, variable = false): BeatGridRow {
  const bars = 40;
  const beats = Array.from({ length: bars * 4 }, (_, index) => ({
    seq: index + 1,
    srcIdx: index + 1,
    beatInBar: (index % 4) + 1,
    bar: Math.floor(index / 4) + 1,
    ms: index * 500,
    bpm: 120,
    isDownbeat: index % 4 === 0,
  }));
  return {
    id: `grid-${trackId}`,
    import_id: `import-${trackId}`,
    track_id: trackId,
    source_tag: 'PQTZ',
    beats,
    beat_count: beats.length,
    downbeat_count: bars,
    bar_count: bars,
    first_beat_ms: 0,
    first_downbeat_ms: 0,
    minimum_bpm: 120,
    maximum_bpm: 120,
    is_variable_tempo: variable,
    parser_version: 'test',
  };
}

function hqAsset(trackId: string, stemType: StemAssetType): StemAssetRecord {
  return {
    id: `${trackId}-${stemType}`,
    track_id: trackId,
    stem_type: stemType,
    installation_id: 'install-1',
    status: 'ready',
    storage_locator: `generated/${trackId}/${stemType}.wav`,
    source_fingerprint: `fingerprint-${trackId}`,
    separator_version: ROULETTE_SEPARATOR_VERSION,
    contract_version: 1,
    duration_ms: 120_000,
    sample_rate_hz: 44_100,
    channel_count: 2,
    file_size_bytes: 4096,
    file_mtime_ms: 1234,
    analysis_metrics: null,
    failure_code: null,
    failure_message: null,
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
  };
}

function previewSuccess(trackId: string): Extract<DesktopRoulettePreviewPreparationResult, { ok: true }> {
  return {
    ok: true,
    cached: false,
    algorithmVersion: ROULETTE_PREVIEW_ALGORITHM_VERSION,
    sourceFingerprint: `fingerprint-${trackId}`,
    windowStartMs: 0,
    windowEndMs: 32_000,
    outputs: {
      vocals: {
        locator: `previews/${trackId}/vocals.wav`,
        durationMs: 32_000,
        sampleRateHz: 44_100,
        channelCount: 2,
        size: 100,
        mtimeMs: 10,
        metrics: metrics(32_000),
      },
      instrumental: {
        locator: `previews/${trackId}/instrumental.wav`,
        durationMs: 32_000,
        sampleRateHz: 44_100,
        channelCount: 2,
        size: 100,
        mtimeMs: 10,
        metrics: metrics(32_000),
      },
    },
  };
}

function harness(options: {
  beatGrid?: BeatGridRow | null;
  hqReady?: boolean;
  prepareResult?: DesktopRoulettePreviewPreparationResult;
} = {}) {
  const repository = {
    getCurrentSourceFingerprint: vi.fn(async (trackId: string) => `fingerprint-${trackId}`),
  } as unknown as StemAssetRepository;

  const getReadiness = vi.fn(async (trackId: string, stemType: StemAssetType): Promise<StemAssetReadiness> => ({
    parentTrackId: trackId,
    stemType,
    status: options.hqReady ? 'ready' : 'unavailable',
    asset: options.hqReady ? hqAsset(trackId, stemType) : null,
    reason: null,
  }));
  const resolveReady = vi.fn(async () => null);
  const stemAssets = { getReadiness, resolveReady } as Pick<StemAssetService, 'getReadiness' | 'resolveReady'>;

  const prepareRoulettePreview = vi.fn(async (input: DesktopRoulettePreviewPreparationInput) => (
    options.prepareResult ?? previewSuccess(input.trackId)
  ));
  const cancelRouletteStems = vi.fn(async () => ({ ok: true, cancelled: true }));
  const resolveStemAsset = vi.fn(async (locator: string) => ({
    ok: true as const,
    source: { kind: 'url' as const, url: `dropdex://stem/${locator}`, size: 100, mtimeMs: 10 },
  }));
  const reconnectUsb = vi.fn(async () => ({
    reconnected: true,
    reason: 'connected' as const,
    state: {
      status: 'connected' as const,
      volumeName: 'USB-A',
      connectedAt: '2026-09-14T00:00:00Z',
      structureWarning: null,
      error: null,
    },
  }));
  const desktop = { prepareRoulettePreview, cancelRouletteStems, resolveStemAsset, reconnectUsb };

  const service = createRoulettePreviewPreparationService({
    repository,
    stemAssets,
    loadBeatGrid: vi.fn(async (trackId) => options.beatGrid === undefined ? grid(trackId) : options.beatGrid),
    loadPhrases: vi.fn(async () => [] as PhraseRow[]),
    loadVocalAnalysis: vi.fn(async () => null as VocalAnalysisRow | null),
    loadSourceDeviceName: vi.fn(async () => 'USB-A'),
    getDesktopBridge: () => desktop,
  });

  return { service, repository, stemAssets, desktop };
}

describe('Roulette fast preview preparation service', () => {
  it('serializes preview work globally and prepares only the requested selected tracks', async () => {
    const test = harness();
    let releaseFirst!: (value: DesktopRoulettePreviewPreparationResult) => void;
    test.desktop.prepareRoulettePreview.mockImplementationOnce((input) => new Promise((resolve) => {
      releaseFirst = resolve;
      expect(input.trackId).toBe('top');
    }));

    const top = test.service.prepare(track('top'), 'vocal');
    const bottom = test.service.prepare(track('bottom'), 'instrumental');

    await vi.waitFor(() => expect(test.desktop.prepareRoulettePreview).toHaveBeenCalledTimes(1));
    releaseFirst(previewSuccess('top'));
    await vi.waitFor(() => expect(test.desktop.prepareRoulettePreview).toHaveBeenCalledTimes(2));
    await expect(top).resolves.toMatchObject({ status: 'ready' });
    await expect(bottom).resolves.toMatchObject({ status: 'ready' });
  });

  it('selects vocals for the top role and no-vocals/instrumental for the bottom role', async () => {
    const test = harness();
    const vocal = await test.service.prepare(track('top'), 'vocal');
    const instrumental = await test.service.prepare(track('bottom'), 'instrumental');

    expect(vocal.asset).toMatchObject({
      kind: 'preview',
      output: {
        locator: 'previews/top/vocals.wav',
        metrics: { version: 'roulette-stem-metrics-v1' },
      },
    });
    expect(instrumental.asset).toMatchObject({ kind: 'preview', output: { locator: 'previews/bottom/instrumental.wav' } });
    expect(test.desktop.prepareRoulettePreview).toHaveBeenNthCalledWith(1, expect.objectContaining({
      trackId: 'top',
      role: 'vocal',
      algorithmVersion: ROULETTE_PREVIEW_ALGORITHM_VERSION,
      windowStartMs: 0,
      windowEndMs: 32_000,
      expectedVolumeName: 'USB-A',
    }));
  });

  it('prefers an existing valid HQ stem and never launches rough separation', async () => {
    const test = harness({ hqReady: true });
    const outcome = await test.service.prepare(track('top'), 'vocal');

    expect(outcome).toMatchObject({ status: 'ready', asset: { kind: 'hq', role: 'vocal' } });
    expect(test.desktop.prepareRoulettePreview).not.toHaveBeenCalled();
  });

  it('fails closed before separation for missing or variable-tempo beat-grid truth', async () => {
    const missing = harness({ beatGrid: null });
    const missingResult = await missing.service.prepare(track('missing'), 'vocal');
    expect(missingResult.status).toBe('failed');
    expect(missingResult.message).toContain('usable Rekordbox beat grid');
    expect(missing.desktop.prepareRoulettePreview).not.toHaveBeenCalled();

    const variable = harness({ beatGrid: grid('variable', true) });
    const variableResult = await variable.service.prepare(track('variable'), 'instrumental');
    expect(variableResult.status).toBe('failed');
    expect(variableResult.message).toContain('Variable-tempo');
    expect(variable.desktop.prepareRoulettePreview).not.toHaveBeenCalled();
  });

  it('surfaces missing/wrong source media as recoverable state instead of false readiness', async () => {
    const test = harness({
      prepareResult: {
        ok: false,
        error: {
          kind: 'source_media_mismatch',
          message: 'Wrong USB.',
          requiredVolumeName: 'USB-A',
          connectedVolumeName: 'USB-B',
        },
      },
    });
    const outcome = await test.service.prepare(track('top'), 'vocal');
    expect(outcome).toMatchObject({
      status: 'source-required',
      recoveryAction: 'reconnect-source',
      requiredVolumeName: 'USB-A',
      connectedVolumeName: 'USB-B',
      asset: null,
    });
    expect(outcome.message).not.toContain('Wrong USB.');
  });

  it('reconnects the required source and resumes the same pending selection without re-import', async () => {
    const test = harness({
      prepareResult: {
        ok: false,
        error: {
          kind: 'source_media_required',
          message: 'Reconnect USB-A.',
          requiredVolumeName: 'USB-A',
          connectedVolumeName: null,
        },
      },
    });
    const selected = track('top');
    await expect(test.service.prepare(selected, 'vocal')).resolves.toMatchObject({ status: 'source-required' });
    test.desktop.prepareRoulettePreview.mockResolvedValueOnce(previewSuccess('top'));

    await expect(test.service.reconnectAndResume('top', 'vocal')).resolves.toBe(true);
    await vi.waitFor(() => expect(test.service.getState('top', 'vocal')?.status).toBe('ready'));
    expect(test.desktop.reconnectUsb).toHaveBeenCalledWith('USB-A');
    expect(test.desktop.prepareRoulettePreview).toHaveBeenCalledTimes(2);
  });

  it('supports retry after a failed separation without corrupting completed state', async () => {
    const test = harness({
      prepareResult: { ok: false, error: { kind: 'processing_failed', message: 'separator failed' } },
    });
    await expect(test.service.prepare(track('top'), 'vocal')).resolves.toMatchObject({
      status: 'failed',
      recoveryAction: 'retry',
      message: 'Preview preparation failed. Try again.',
    });
    test.desktop.prepareRoulettePreview.mockResolvedValueOnce(previewSuccess('top'));

    await expect(test.service.retry('top', 'vocal')).resolves.toMatchObject({ status: 'ready' });
  });

  it('does not offer generic retry semantics when the local Roulette runtime is unavailable', async () => {
    const test = harness({
      prepareResult: {
        ok: false,
        error: { kind: 'runtime_unavailable', message: 'Local stem separator failed to start: /private/internal/path' },
      },
    });

    const outcome = await test.service.prepare(track('runtime-missing'), 'vocal');
    expect(outcome).toMatchObject({
      status: 'failed',
      recoveryAction: 'runtime-setup',
    });
    expect(outcome.message).toContain('runtime setup is required');
    expect(outcome.message).not.toContain('/private/internal/path');
  });

  it('keeps source-window timing explicit when resolving preview vs HQ media', async () => {
    const preview = harness();
    const previewState = await preview.service.prepare(track('top'), 'vocal');
    expect(previewState.asset?.kind).toBe('preview');
    if (previewState.asset) {
      await expect(preview.service.resolvePreparedAsset(previewState.asset)).resolves.toMatchObject({
        assetKind: 'preview',
        mediaStartMs: 0,
      });
    }
  });

  it('releases completed preview jobs while retaining only bounded recent state', async () => {
    const test = harness();
    await expect(test.service.prepare(track('completed'), 'vocal')).resolves.toMatchObject({ status: 'ready' });

    await expect(test.service.cancel('completed', 'vocal')).resolves.toBe(false);
    await expect(test.service.retry('completed', 'vocal')).resolves.toBeNull();

    for (let index = 0; index < 30; index += 1) {
      await test.service.prepare(track(`recent-${index}`), 'vocal');
    }
    expect(test.service.getState('recent-0', 'vocal')).toBeNull();
    expect(test.service.getState('recent-29', 'vocal')?.status).toBe('ready');
  });

  it('cleans cancelled queued jobs but preserves the minimal retry context', async () => {
    const test = harness();
    let releaseFirst!: (value: DesktopRoulettePreviewPreparationResult) => void;
    test.desktop.prepareRoulettePreview.mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirst = resolve;
    }));

    const active = test.service.prepare(track('active'), 'vocal');
    const queued = test.service.prepare(track('queued'), 'instrumental');
    await vi.waitFor(() => expect(test.desktop.prepareRoulettePreview).toHaveBeenCalledTimes(1));

    await expect(test.service.cancel('queued', 'instrumental')).resolves.toBe(true);
    await expect(queued).resolves.toMatchObject({ status: 'cancelled', recoveryAction: 'retry' });
    await expect(test.service.cancel('queued', 'instrumental')).resolves.toBe(false);

    const retry = test.service.retry('queued', 'instrumental');
    releaseFirst(previewSuccess('active'));
    await expect(active).resolves.toMatchObject({ status: 'ready' });
    await expect(retry).resolves.toMatchObject({ status: 'ready' });
  });

  it('does not release active preview work until the operation reaches a terminal state', async () => {
    const test = harness();
    let release!: (value: DesktopRoulettePreviewPreparationResult) => void;
    test.desktop.prepareRoulettePreview.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve;
    }));

    const request = test.service.prepare(track('active-cancel'), 'vocal');
    await vi.waitFor(() => expect(test.desktop.prepareRoulettePreview).toHaveBeenCalledTimes(1));

    await expect(test.service.cancel('active-cancel', 'vocal')).resolves.toBe(true);
    await expect(test.service.cancel('active-cancel', 'vocal')).resolves.toBe(true);
    release(previewSuccess('active-cancel'));

    await expect(request).resolves.toMatchObject({ status: 'cancelled' });
    await vi.waitFor(async () => {
      await expect(test.service.cancel('active-cancel', 'vocal')).resolves.toBe(false);
    });
  });

  it('uses normalized source media with the same canonical volume identity used by HQ preparation', async () => {
    const test = harness();
    await test.service.prepare(track('normalized', {
      file_path: '/Volumes/USB-A/Contents/Artist/Legacy.wav',
      file_path_normalized: '/Contents/Artist/Current.wav',
      file_path_volume: 'USB-A',
    }), 'vocal');

    expect(test.desktop.prepareRoulettePreview).toHaveBeenCalledWith(expect.objectContaining({
      sourceSegments: ['Contents', 'Artist', 'Current.wav'],
      expectedVolumeName: 'USB-A',
    }));
  });

});
