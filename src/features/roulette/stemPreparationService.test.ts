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
    outputs: {
      vocals: {
        locator: 'generated/a/b/vocals.wav',
        durationMs: 120000,
        sampleRateHz: 44100,
        channelCount: 2,
        size: 4096,
        mtimeMs: 1234,
      },
      instrumental: {
        locator: 'generated/a/b/instrumental.wav',
        durationMs: 120000,
        sampleRateHz: 44100,
        channelCount: 2,
        size: 4096,
        mtimeMs: 1234,
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
  const prepareRouletteStems = vi.fn(async (_input: DesktopRouletteStemPreparationInput) => (
    options.prepareResult ?? successResult()
  ));
  const cancelRouletteStems = vi.fn(async () => ({ ok: true, cancelled: true }));
  const deleteStemAsset = vi.fn(async () => ({ ok: true as const, deleted: true }));
  const desktop = { prepareRouletteStems, cancelRouletteStems, deleteStemAsset };
  const service = createRouletteStemPreparationService({
    repository,
    stemAssets,
    getDesktopBridge: () => desktop,
  });

  return {
    service,
    repository,
    stemAssets,
    desktop,
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

  it('deletes uncommitted generated files if the source fingerprint changes before canonical commit', async () => {
    const test = harness();
    vi.mocked(test.repository.getCurrentSourceFingerprint)
      .mockResolvedValueOnce('source-current')
      .mockResolvedValueOnce('source-changed');

    const outcome = await test.service.prepare(track());

    expect(outcome.status).toBe('failed');
    expect(test.desktop.deleteStemAsset).toHaveBeenCalledTimes(2);
    expect(test.stemAssets.commitReadyPair).not.toHaveBeenCalled();
    expect(test.stemAssets.markFailed).toHaveBeenCalledTimes(2);
  });

  it('rejects unsupported or unsafe parent media paths before canonical processing state changes', async () => {
    const test = harness();
    const outcome = await test.service.prepare(track({ file_path: '../../etc/passwd' }));

    expect(outcome.status).toBe('failed');
    expect(outcome.message).toContain('unsupported local media path');
    expect(test.stemAssets.register).not.toHaveBeenCalled();
    expect(test.desktop.prepareRouletteStems).not.toHaveBeenCalled();
  });
});
