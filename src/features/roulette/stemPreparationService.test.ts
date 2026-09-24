import { describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type {
  DesktopRouletteStemPreparationInput,
  DesktopRouletteStemPreparationResult,
} from '../../types/dropdex-desktop';
import type { StemAssetRepository } from '../../lib/queries/rouletteStemAssets';
import type { StemAssetReadiness, StemAssetRecord, StemAssetType } from './stemAssets';
import type { StemAssetService } from './stemAssetService';
import {
  ROULETTE_SEPARATOR_VERSION,
  createRouletteStemPreparationService,
} from './stemPreparationService';

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

function track(overrides: Partial<RekordboxTrack> = {}): RekordboxTrack {
  return {
    id: 'track-1',
    import_id: 'import-1',
    rekordbox_content_id: 'content-1',
    title: 'Track One',
    artist: 'Artist',
    album: null,
    remixer: null,
    genre: null,
    label: null,
    musical_key: 'Em',
    camelot_key: '9A',
    normalized_key_name: 'E minor',
    key_tonic: 'E',
    key_mode: 'minor',
    bpm: 142,
    duration_seconds: 120,
    duration_ms: 120000,
    rating: null,
    comments: null,
    file_path: '/Contents/Artist/Track One.wav',
    file_format: 'WAV',
    date_added: null,
    created_at: '2026-09-08T00:00:00Z',
    ...overrides,
  } as RekordboxTrack;
}

function asset(stemType: StemAssetType): StemAssetRecord {
  return {
    id: `asset-${stemType}`,
    track_id: 'track-1',
    stem_type: stemType,
    installation_id: 'installation-1',
    status: 'ready',
    storage_locator: `generated/a/b/${stemType === 'vocals' ? 'vocals' : 'instrumental'}.wav`,
    source_fingerprint: 'source-current',
    separator_version: ROULETTE_SEPARATOR_VERSION,
    contract_version: 1,
    duration_ms: 120000,
    sample_rate_hz: 44100,
    channel_count: 2,
    file_size_bytes: 4096,
    file_mtime_ms: 1234,
    analysis_metrics: null,
    failure_code: null,
    failure_message: null,
    created_at: '2026-09-08T00:00:00Z',
    updated_at: '2026-09-08T00:00:00Z',
  };
}

function readiness(stemType: StemAssetType, status: StemAssetReadiness['status']): StemAssetReadiness {
  return {
    parentTrackId: 'track-1',
    stemType,
    status,
    asset: status === 'ready' ? asset(stemType) : null,
    reason: null,
  };
}

function successResult(): Extract<DesktopRouletteStemPreparationResult, { ok: true }> {
  return {
    ok: true,
    separatorVersion: ROULETTE_SEPARATOR_VERSION,
    cached: false,
    outputs: {
      vocals: {
        locator: 'generated/a/b/vocals.wav',
        durationMs: 120000,
        sampleRateHz: 44100,
        channelCount: 2,
        size: 4096,
        mtimeMs: 1234,
        metrics: metrics(120000),
      },
      instrumental: {
        locator: 'generated/a/b/instrumental.wav',
        durationMs: 120000,
        sampleRateHz: 44100,
        channelCount: 2,
        size: 4096,
        mtimeMs: 1234,
        metrics: metrics(120000),
      },
    },
  };
}

function harness(options: {
  readinessStatuses?: [StemAssetReadiness['status'], StemAssetReadiness['status']];
  prepareResult?: DesktopRouletteStemPreparationResult;
} = {}) {
  let fingerprintCalls = 0;
  const repository: StemAssetRepository = {
    getAsset: vi.fn(),
    getAssets: vi.fn(),
    getCurrentSourceFingerprint: vi.fn(async () => {
      fingerprintCalls += 1;
      return 'source-current';
    }),
    upsertAsset: vi.fn(),
    updateStatus: vi.fn(),
    commitReadyPair: vi.fn(),
    deleteAsset: vi.fn(),
  } as unknown as StemAssetRepository;

  const statuses = options.readinessStatuses ?? ['unavailable', 'unavailable'];
  const getReadiness = vi.fn(async (_trackId: string, stemType: StemAssetType) => (
    readiness(stemType, stemType === 'vocals' ? statuses[0] : statuses[1])
  ));
  const register = vi.fn(async ({ stemType, status }: { stemType: StemAssetType; status: StemAssetRecord['status'] }) => ({
    ...asset(stemType), status,
  }));
  const markFailed = vi.fn(async (_trackId: string, stemType: StemAssetType, code: string, message: string) => ({
    ...asset(stemType), status: 'failed' as const, failure_code: code, failure_message: message,
  }));
  const commitReadyPair = vi.fn(async () => [asset('vocals'), asset('instrumental')]);
  const stemAssets = {
    getReadiness,
    register,
    markFailed,
    commitReadyPair,
  } as unknown as Pick<StemAssetService, 'getReadiness' | 'register' | 'markFailed' | 'commitReadyPair'>;

  let resolvePrepare: ((value: DesktopRouletteStemPreparationResult) => void) | null = null;
  const getRouletteRuntimeHealth = vi.fn(async () => ({
    available: true as const,
    reason: null,
    message: null,
    separatorVersion: ROULETTE_SEPARATOR_VERSION,
  }));
  const prepareRouletteStems = vi.fn(async (_input: DesktopRouletteStemPreparationInput) => (
    options.prepareResult ?? successResult()
  ));
  const cancelRouletteStems = vi.fn(async () => ({ ok: true, cancelled: true }));
  const reconnectUsb = vi.fn(async () => ({
    reconnected: true,
    reason: 'connected' as const,
    state: {
      status: 'connected' as const,
      volumeName: 'USB-A',
      connectedAt: '2026-09-24T00:00:00Z',
      structureWarning: null,
      error: null,
    },
  }));
  const deleteStemAsset = vi.fn(async () => ({ ok: true as const, deleted: true }));
  const desktop = { getRouletteRuntimeHealth, prepareRouletteStems, cancelRouletteStems, reconnectUsb, deleteStemAsset };
  const loadSourceDeviceName = vi.fn(async () => 'USB-A');
  const service = createRouletteStemPreparationService({
    repository,
    stemAssets,
    loadSourceDeviceName,
    getDesktopBridge: () => desktop,
  });

  return {
    service,
    repository,
    stemAssets,
    desktop,
    loadSourceDeviceName,
    setDeferredPrepare() {
      prepareRouletteStems.mockImplementationOnce(() => new Promise((resolve) => { resolvePrepare = resolve; }));
      return (value: DesktopRouletteStemPreparationResult) => resolvePrepare?.(value);
    },
    get fingerprintCalls() { return fingerprintCalls; },
  };
}

describe('Roulette stem preparation service', () => {
  it('drives pending -> processing -> atomic ready pair through the production desktop command', async () => {
    const test = harness();
    const outcome = await test.service.prepare(track());

    expect(outcome).toEqual({ status: 'ready', cached: false, message: null });
    expect(test.stemAssets.register).toHaveBeenCalledTimes(4);
    expect(test.stemAssets.register).toHaveBeenNthCalledWith(1, expect.objectContaining({ stemType: 'vocals', status: 'pending' }));
    expect(test.stemAssets.register).toHaveBeenNthCalledWith(3, expect.objectContaining({ stemType: 'vocals', status: 'processing' }));
    expect(test.desktop.prepareRouletteStems).toHaveBeenCalledWith({
      trackId: 'track-1',
      sourceSegments: ['Contents', 'Artist', 'Track One.wav'],
      expectedVolumeName: 'USB-A',
      sourceFingerprint: 'source-current',
      separatorVersion: ROULETTE_SEPARATOR_VERSION,
      expectedDurationMs: 120000,
    });
    expect(test.stemAssets.commitReadyPair).toHaveBeenCalledTimes(1);
  });

  it('reuses a complete valid cached pair without starting the separator', async () => {
    const test = harness({ readinessStatuses: ['ready', 'ready'] });
    const outcome = await test.service.prepare(track());

    expect(outcome).toEqual({ status: 'ready', cached: true, message: null });
    expect(test.desktop.prepareRouletteStems).not.toHaveBeenCalled();
    expect(test.stemAssets.register).not.toHaveBeenCalled();
  });

  it('deduplicates rapid simultaneous preparation requests for the same track', async () => {
    const test = harness();
    const resolve = test.setDeferredPrepare();
    const first = test.service.prepare(track());
    const second = test.service.prepare(track());
    expect(first).toBe(second);

    await vi.waitFor(() => expect(test.desktop.prepareRouletteStems).toHaveBeenCalledTimes(1));
    resolve(successResult());
    await expect(first).resolves.toMatchObject({ status: 'ready' });
  });

  it('leaves canonical asset state untouched when the local runtime health check is unavailable', async () => {
    const test = harness();
    test.desktop.getRouletteRuntimeHealth.mockResolvedValueOnce({
      available: false as const,
      reason: 'model_missing' as const,
      message: 'The Demucs model is not provisioned.',
    });

    const outcome = await test.service.prepare(track());

    expect(outcome).toEqual({
      status: 'failed',
      cached: false,
      message: 'The Demucs model is not provisioned.',
    });
    expect(test.stemAssets.register).not.toHaveBeenCalled();
    expect(test.stemAssets.markFailed).not.toHaveBeenCalled();
    expect(test.desktop.prepareRouletteStems).not.toHaveBeenCalled();
  });

  it('marks both canonical assets failed and never commits ready on worker failure', async () => {
    const test = harness({
      prepareResult: { ok: false, error: { kind: 'processing_failed', message: 'Demucs failed.' } },
    });
    const outcome = await test.service.prepare(track());

    expect(outcome).toEqual({ status: 'failed', cached: false, message: 'Demucs failed.' });
    expect(test.stemAssets.markFailed).toHaveBeenCalledTimes(2);
    expect(test.stemAssets.commitReadyPair).not.toHaveBeenCalled();
  });

  it('surfaces cancellation without publishing either stem ready', async () => {
    const test = harness({
      prepareResult: { ok: false, error: { kind: 'cancelled', message: 'Stem preparation was cancelled.' } },
    });
    const outcome = await test.service.prepare(track());

    expect(outcome.status).toBe('cancelled');
    expect(test.stemAssets.markFailed).toHaveBeenCalledTimes(2);
    expect(test.stemAssets.commitReadyPair).not.toHaveBeenCalled();
  });

  it('cancels the active desktop job by canonical parent track identity', async () => {
    const test = harness();
    await expect(test.service.cancel('track-1')).resolves.toBe(true);
    expect(test.desktop.cancelRouletteStems).toHaveBeenCalledWith('track-1');
  });

  it('keeps generated HQ cache files for retry if the source fingerprint changes before canonical commit', async () => {
    const test = harness();
    vi.mocked(test.repository.getCurrentSourceFingerprint)
      .mockResolvedValueOnce('source-current')
      .mockResolvedValueOnce('source-changed');

    const outcome = await test.service.prepare(track());

    expect(outcome.status).toBe('failed');
    expect(test.desktop.deleteStemAsset).not.toHaveBeenCalled();
    expect(test.stemAssets.commitReadyPair).not.toHaveBeenCalled();
    expect(test.stemAssets.markFailed).toHaveBeenCalledTimes(2);
  });

  it('serializes HQ work globally across different tracks', async () => {
    const test = harness();
    let releaseFirst!: (value: DesktopRouletteStemPreparationResult) => void;
    test.desktop.prepareRouletteStems.mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirst = resolve;
    }));

    const first = test.service.prepare(track({ id: 'track-a', file_path: '/Contents/A.wav' }));
    const second = test.service.prepare(track({ id: 'track-b', file_path: '/Contents/B.wav' }));
    await vi.waitFor(() => expect(test.desktop.prepareRouletteStems).toHaveBeenCalledTimes(1));
    expect(test.desktop.prepareRouletteStems.mock.calls[0]?.[0].trackId).toBe('track-a');

    releaseFirst(successResult());
    await vi.waitFor(() => expect(test.desktop.prepareRouletteStems).toHaveBeenCalledTimes(2));
    expect(test.desktop.prepareRouletteStems.mock.calls[1]?.[0].trackId).toBe('track-b');
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'ready', cached: false, message: null },
      { status: 'ready', cached: false, message: null },
    ]);
  });

  it('cancels queued HQ work without starting a second separator job', async () => {
    const test = harness();
    let releaseFirst!: (value: DesktopRouletteStemPreparationResult) => void;
    test.desktop.prepareRouletteStems.mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirst = resolve;
    }));

    const first = test.service.prepare(track({ id: 'track-a', file_path: '/Contents/A.wav' }));
    const queued = test.service.prepare(track({ id: 'track-b', file_path: '/Contents/B.wav' }));
    await vi.waitFor(() => expect(test.desktop.prepareRouletteStems).toHaveBeenCalledTimes(1));

    await expect(test.service.cancel('track-b')).resolves.toBe(true);
    releaseFirst(successResult());

    await expect(first).resolves.toMatchObject({ status: 'ready' });
    await expect(queued).resolves.toMatchObject({ status: 'cancelled' });
    expect(test.desktop.prepareRouletteStems).toHaveBeenCalledTimes(1);
  });

  it('keeps a valid ready stem row intact when regenerating its missing partner fails', async () => {
    const test = harness({
      readinessStatuses: ['ready', 'unavailable'],
      prepareResult: { ok: false, error: { kind: 'processing_failed', message: 'Demucs failed.' } },
    });

    const outcome = await test.service.prepare(track());

    expect(outcome.status).toBe('failed');
    expect(test.stemAssets.register).toHaveBeenCalledTimes(2);
    expect(test.stemAssets.register).toHaveBeenCalledWith(expect.objectContaining({ stemType: 'instrumental' }));
    expect(test.stemAssets.register).not.toHaveBeenCalledWith(expect.objectContaining({ stemType: 'vocals' }));
    expect(test.stemAssets.markFailed).toHaveBeenCalledTimes(1);
    expect(test.stemAssets.markFailed).toHaveBeenCalledWith('track-1', 'instrumental', 'processing_failed', 'Demucs failed.');
  });

  it('prepares a Roulette pair one track at a time and preserves the first successful track on later failure', async () => {
    const test = harness();
    test.desktop.prepareRouletteStems
      .mockResolvedValueOnce(successResult())
      .mockResolvedValueOnce({ ok: false, error: { kind: 'processing_failed', message: 'Bottom failed.' } });

    const outcome = await test.service.preparePair(
      track({ id: 'vocal-track', file_path: '/Contents/Vocal.wav' }),
      track({ id: 'instrumental-track', file_path: '/Contents/Instrumental.wav' }),
    );

    expect(outcome.status).toBe('partial');
    expect(outcome.vocal.status).toBe('ready');
    expect(outcome.instrumental.status).toBe('failed');
    expect(test.stemAssets.commitReadyPair).toHaveBeenCalledTimes(1);
    expect(test.desktop.prepareRouletteStems.mock.calls.map(([input]) => input.trackId)).toEqual([
      'vocal-track',
      'instrumental-track',
    ]);
  });

  it('rejects unsupported or unsafe parent media paths before canonical processing state changes', async () => {
    const test = harness();
    const outcome = await test.service.prepare(track({ file_path: '../../etc/passwd' }));

    expect(outcome.status).toBe('failed');
    expect(outcome.message).toContain('unsupported local media path');
    expect(test.stemAssets.register).not.toHaveBeenCalled();
    expect(test.desktop.prepareRouletteStems).not.toHaveBeenCalled();
  });

  it('uses the same normalized-path-first fallback contract as preview preparation', async () => {
    const test = harness();
    const outcome = await test.service.prepare(track({
      file_path: '/Volumes/USB-A/Contents/Artist/Legacy.wav',
      file_path_normalized: '/Contents/Artist/Current.wav',
      file_path_volume: 'USB-A',
    }));

    expect(outcome.status).toBe('ready');
    expect(test.desktop.prepareRouletteStems).toHaveBeenCalledWith(expect.objectContaining({
      sourceSegments: ['Contents', 'Artist', 'Current.wav'],
      expectedVolumeName: 'USB-A',
    }));
  });

  it('classifies disconnected source media as reconnectable without deleting generated assets', async () => {
    const test = harness({
      prepareResult: {
        ok: false,
        error: {
          kind: 'source_media_required',
          message: 'No USB drive is connected.',
          requiredVolumeName: 'USB-A',
          connectedVolumeName: null,
        },
      },
    });

    const outcome = await test.service.prepare(track());

    expect(outcome).toMatchObject({
      status: 'failed',
      recoveryAction: 'reconnect-source',
      requiredVolumeName: 'USB-A',
      connectedVolumeName: null,
    });
    expect(test.desktop.deleteStemAsset).not.toHaveBeenCalled();
    expect(test.stemAssets.commitReadyPair).not.toHaveBeenCalled();
  });

  it('keeps a complete generated HQ pair usable even when parent source media is currently unavailable', async () => {
    const test = harness({ readinessStatuses: ['ready', 'ready'] });
    const outcome = await test.service.prepare(track({
      file_path: null,
      file_path_normalized: null,
      file_path_volume: null,
    }));

    expect(outcome).toEqual({ status: 'ready', cached: true, message: null });
    expect(test.loadSourceDeviceName).not.toHaveBeenCalled();
    expect(test.desktop.prepareRouletteStems).not.toHaveBeenCalled();
    expect(test.desktop.deleteStemAsset).not.toHaveBeenCalled();
  });


  it('reconnects the canonical required source volume before an HQ retry', async () => {
    const test = harness();

    await expect(test.service.reconnectSource('USB-A')).resolves.toBe(true);
    expect(test.desktop.reconnectUsb).toHaveBeenCalledWith('USB-A');
  });

});
