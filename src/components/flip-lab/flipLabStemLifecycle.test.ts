import { describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { RoulettePreviewPreparationState, RoulettePreviewWindow } from '../../features/roulette/roulettePreview';
import type { RouletteSourceRole } from '../../features/roulette/rouletteSession';
import {
  ROULETTE_SEPARATOR_VERSION,
  type StemAssetReadiness,
  type StemAssetRecord,
  type StemAssetType,
} from '../../features/roulette/stemAssets';
import {
  createFlipLabStemLifecycle,
  isFlipLabStemUsable,
} from './flipLabStemLifecycle';

function track(id: string): RekordboxTrack {
  return {
    id,
    import_id: 'import-1',
    rekordbox_content_id: id,
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
    duration_seconds: 180,
    duration_ms: 180_000,
    rating: null,
    comments: null,
    file_path: `/Volumes/USB/Music/${id}.wav`,
    file_path_volume: 'USB',
    file_format: 'WAV',
    date_added: null,
  } as RekordboxTrack;
}

function asset(trackId: string, stemType: StemAssetType, status: StemAssetRecord['status'] = 'ready'): StemAssetRecord {
  return {
    id: `${trackId}-${stemType}`,
    track_id: trackId,
    stem_type: stemType,
    installation_id: 'install-1',
    status,
    storage_locator: status === 'ready' ? `generated/${trackId}/${stemType}.wav` : null,
    source_fingerprint: `fingerprint-${trackId}`,
    separator_version: status === 'ready' ? ROULETTE_SEPARATOR_VERSION : null,
    contract_version: 1,
    duration_ms: 180_000,
    sample_rate_hz: 44_100,
    channel_count: 2,
    file_size_bytes: status === 'ready' ? 1_024 : null,
    file_mtime_ms: status === 'ready' ? 123 : null,
    analysis_metrics: null,
    failure_code: null,
    failure_message: null,
    created_at: '2026-09-27T00:00:00Z',
    updated_at: '2026-09-27T00:00:00Z',
  };
}

function readiness(
  trackId: string,
  stemType: StemAssetType,
  status: StemAssetReadiness['status'],
  options: { asset?: StemAssetRecord | null; reason?: string | null } = {},
): StemAssetReadiness {
  return {
    parentTrackId: trackId,
    stemType,
    status,
    asset: options.asset ?? null,
    reason: options.reason ?? null,
  };
}

const WINDOW: RoulettePreviewWindow = {
  sourceTimeMs: 32_000,
  windowEndMs: 64_000,
  durationMs: 32_000,
  sourceBar: 17,
  sourceBeatSequence: 65,
  requestedBars: 16,
  provenance: 'downbeat',
};

function previewState(
  trackId: string,
  role: RouletteSourceRole,
  status: RoulettePreviewPreparationState['status'],
  options: Partial<RoulettePreviewPreparationState> = {},
): RoulettePreviewPreparationState {
  const stemType = role === 'vocal' ? 'vocals' : 'instrumental';
  return {
    trackId,
    role,
    status,
    progress: status === 'ready' ? 1 : status === 'queued' ? 0 : null,
    message: null,
    recoveryAction: 'none',
    requiredVolumeName: null,
    connectedVolumeName: null,
    window: status === 'ready' ? WINDOW : null,
    asset: status === 'ready' ? {
      kind: 'hq',
      role,
      trackId,
      sourceFingerprint: `fingerprint-${trackId}`,
      window: WINDOW,
      asset: asset(trackId, stemType),
    } : null,
    ...options,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(options: {
  getReadiness?: (trackId: string, stemType: StemAssetType) => Promise<StemAssetReadiness>;
  prepare?: (track: RekordboxTrack, role: RouletteSourceRole) => Promise<RoulettePreviewPreparationState>;
} = {}) {
  const listeners = new Set<(state: RoulettePreviewPreparationState) => void>();
  const getReadiness = vi.fn(options.getReadiness ?? (async (trackId: string, stemType: StemAssetType) => (
    readiness(trackId, stemType, 'unavailable')
  )));
  const prepare = vi.fn(options.prepare ?? (async (selected: RekordboxTrack, role: RouletteSourceRole) => (
    previewState(selected.id, role, 'ready')
  )));
  const getState = vi.fn(() => null as RoulettePreviewPreparationState | null);
  const subscribe = vi.fn((listener: (state: RoulettePreviewPreparationState) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  const lifecycle = createFlipLabStemLifecycle({
    stemAssets: { getReadiness },
    previewPreparation: { prepare, getState, subscribe },
  });
  return {
    lifecycle,
    getReadiness,
    prepare,
    emit: (state: RoulettePreviewPreparationState) => {
      for (const listener of listeners) listener(state);
    },
  };
}

describe('Flip Lab stem lifecycle adapter', () => {
  it('reuses an existing ready local asset and preserves the canonical audition window', async () => {
    const test = harness({
      getReadiness: async (trackId, stemType) => readiness(trackId, stemType, 'ready', {
        asset: asset(trackId, stemType),
      }),
      prepare: async (selected, role) => previewState(selected.id, role, 'ready'),
    });

    const result = await test.lifecycle.select('vocal', track('ready-track'));

    expect(test.getReadiness).toHaveBeenCalledWith('ready-track', 'vocals', {
      expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION,
    });
    expect(test.prepare).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'ready',
      trackId: 'ready-track',
      window: WINDOW,
      asset: { kind: 'hq', role: 'vocal' },
    });
    expect(isFlipLabStemUsable(result, 'ready-track')).toBe(true);
    test.lifecycle.dispose();
  });

  it('starts the existing preview preparation path when a role stem is missing', async () => {
    const test = harness();

    const result = await test.lifecycle.select('instrumental', track('needs-preview'));

    expect(test.getReadiness).toHaveBeenCalledWith('needs-preview', 'instrumental', expect.any(Object));
    expect(test.prepare).toHaveBeenCalledWith(expect.objectContaining({ id: 'needs-preview' }), 'instrumental');
    expect(result.status).toBe('ready');
    test.lifecycle.dispose();
  });

  it('does not start duplicate preparation for an unchanged selected role', async () => {
    const pending = deferred<RoulettePreviewPreparationState>();
    const test = harness({ prepare: async () => pending.promise });
    const selected = track('same-track');

    const first = test.lifecycle.select('vocal', selected);
    await vi.waitFor(() => expect(test.prepare).toHaveBeenCalledTimes(1));
    const second = test.lifecycle.select('vocal', selected);

    expect(test.getReadiness).toHaveBeenCalledTimes(1);
    expect(test.prepare).toHaveBeenCalledTimes(1);
    pending.resolve(previewState('same-track', 'vocal', 'ready'));
    await expect(first).resolves.toMatchObject({ status: 'ready' });
    await expect(second).resolves.toMatchObject({ status: 'ready' });
    test.lifecycle.dispose();
  });

  it('ignores stale async results when the selected track changes', async () => {
    const oldReadiness = deferred<StemAssetReadiness>();
    const test = harness({
      getReadiness: async (trackId, stemType) => {
        if (trackId === 'old-track') return oldReadiness.promise;
        return readiness(trackId, stemType, 'unavailable');
      },
    });

    const oldRequest = test.lifecycle.select('vocal', track('old-track'));
    const newResult = await test.lifecycle.select('vocal', track('new-track'));
    expect(newResult).toMatchObject({ status: 'ready', trackId: 'new-track' });

    oldReadiness.resolve(readiness('old-track', 'vocals', 'failed', { reason: 'Old failure' }));
    await oldRequest;

    expect(test.lifecycle.getState('vocal')).toMatchObject({ status: 'ready', trackId: 'new-track' });
    expect(test.prepare).toHaveBeenCalledTimes(1);
    test.lifecycle.dispose();
  });

  it('surfaces failed preparation as Failed instead of unavailable', async () => {
    const test = harness({
      prepare: async (selected, role) => previewState(selected.id, role, 'failed', {
        message: 'Preview preparation failed. Try again.',
        recoveryAction: 'retry',
      }),
    });

    const result = await test.lifecycle.select('vocal', track('failed-track'));

    expect(result).toMatchObject({ status: 'failed', message: 'Preview preparation failed. Try again.' });
    test.lifecycle.dispose();
  });

  it('does not report database-ready metadata as Ready when the local file is missing', async () => {
    const preparation = deferred<RoulettePreviewPreparationState>();
    const test = harness({
      getReadiness: async (trackId, stemType) => readiness(trackId, stemType, 'unavailable', {
        asset: asset(trackId, stemType, 'ready'),
        reason: 'Stem file is not available on this installation.',
      }),
      prepare: async () => preparation.promise,
    });

    const request = test.lifecycle.select('instrumental', track('missing-local'));
    await vi.waitFor(() => expect(test.lifecycle.getState('instrumental').status).toBe('local-missing'));
    expect(isFlipLabStemUsable(test.lifecycle.getState('instrumental'), 'missing-local')).toBe(false);

    preparation.resolve(previewState('missing-local', 'instrumental', 'ready', {
      asset: {
        kind: 'preview',
        role: 'instrumental',
        trackId: 'missing-local',
        sourceFingerprint: 'fingerprint-missing-local',
        algorithmVersion: 'demucs-4.0.1-htdemucs-16bar-preview-v1',
        window: WINDOW,
        output: {
          locator: 'previews/missing-local/instrumental.wav',
          durationMs: 32_000,
          sampleRateHz: 44_100,
          channelCount: 2,
          size: 100,
          mtimeMs: 10,
          metrics: {
            version: 'roulette-stem-metrics-v1',
            durationMs: 32_000,
            rms: 0.1,
            signalRatio: 0.9,
            usableNonSilentDurationMs: 31_000,
            activityEvidence: 0.8,
            energyStability: 0.8,
            suitabilityScore: 0.8,
            bins: [],
          },
        },
        cached: false,
      },
      window: WINDOW,
    }));
    await request;
    test.lifecycle.dispose();
  });

  it('surfaces readiness query/runtime errors instead of converting them to not prepared', async () => {
    const test = harness({
      getReadiness: async () => { throw new Error('stem query failed'); },
    });

    const result = await test.lifecycle.select('vocal', track('query-error'));

    expect(result).toMatchObject({ status: 'error', message: 'stem query failed' });
    expect(test.prepare).not.toHaveBeenCalled();
    test.lifecycle.dispose();
  });

  it('updates selected-role readiness from preparation subscription events through completion', async () => {
    const preparation = deferred<RoulettePreviewPreparationState>();
    const test = harness({ prepare: async () => preparation.promise });
    const seen: string[] = [];
    const unsubscribe = test.lifecycle.subscribe((_role, state) => seen.push(state.status));

    const request = test.lifecycle.select('vocal', track('event-track'));
    await vi.waitFor(() => expect(test.prepare).toHaveBeenCalledTimes(1));
    test.emit(previewState('event-track', 'vocal', 'queued', { window: WINDOW }));
    test.emit(previewState('event-track', 'vocal', 'running', { window: WINDOW, progress: 0.5 }));
    const ready = previewState('event-track', 'vocal', 'ready');
    test.emit(ready);
    preparation.resolve(ready);
    await request;

    expect(seen).toContain('queued');
    expect(seen).toContain('processing');
    expect(test.lifecycle.getState('vocal')).toMatchObject({ status: 'ready', window: WINDOW });
    unsubscribe();
    test.lifecycle.dispose();
  });
});
