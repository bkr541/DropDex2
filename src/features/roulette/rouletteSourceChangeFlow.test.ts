import { describe, expect, it, vi } from 'vitest';
import {
  createRouletteActionExecutor,
  RouletteSourceRecoveryRequiredError,
} from './rouletteActions';
import {
  createInitialRouletteSessionState,
  rouletteSessionReducer,
  type RouletteSessionAction,
  type RouletteSessionState,
  type RouletteSourceSelection,
} from './rouletteSession';
import type { RouletteMatchingEngine, RouletteResolvedSource } from './rouletteMatchingEngine';
import {
  executeRouletteSourceChange,
  rouletteSourceChangeRequiresConfirmation,
} from './rouletteSourceChangeFlow';
import { STEM_ASSET_CONTRACT_VERSION, type StemAssetRecord } from './stemAssets';

function stem(trackId: string, type: 'vocals' | 'instrumental'): StemAssetRecord {
  return {
    id: `${trackId}-${type}`,
    track_id: trackId,
    stem_type: type,
    installation_id: 'installation-1',
    status: 'ready',
    storage_locator: `${trackId}/${type}.wav`,
    source_fingerprint: `fingerprint-${trackId}`,
    separator_version: 'separator-v1',
    contract_version: STEM_ASSET_CONTRACT_VERSION,
    duration_ms: 27_000,
    sample_rate_hz: 48_000,
    channel_count: 2,
    file_size_bytes: 1_024,
    file_mtime_ms: 100,
    analysis_metrics: null,
    failure_code: null,
    failure_message: null,
    created_at: '2026-09-24T00:00:00Z',
    updated_at: '2026-09-24T00:00:00Z',
  };
}

function selection(trackId: string, type: 'vocals' | 'instrumental'): RouletteSourceSelection {
  return { parentTrackId: trackId, stemRef: `${trackId}-${type}`, stemStatus: 'ready' };
}

function createHarness(
  matcher: RouletteMatchingEngine,
  prepareSources: NonNullable<Parameters<typeof createRouletteActionExecutor>[0]['prepareSources']> = async () => undefined,
  prepareResolvedSource?: NonNullable<Parameters<typeof createRouletteActionExecutor>[0]['prepareResolvedSource']>,
) {
  let state: RouletteSessionState = createInitialRouletteSessionState();
  const dispatch = (action: RouletteSessionAction) => { state = rouletteSessionReducer(state, action); };
  const executor = createRouletteActionExecutor({
    getState: () => state,
    dispatch,
    matcher,
    prepareSources,
    ...(prepareResolvedSource ? { prepareResolvedSource } : {}),
  });
  const flowActions = {
    stop: () => dispatch({ type: 'transport-changed', status: 'stopped' }),
    replaceSource: executor.actions.replaceSource,
    replaceBoth: executor.actions.replaceBoth,
  };
  return {
    dispatch,
    executor,
    flowActions,
    get state() { return state; },
  };
}

function matcher(overrides: Partial<RouletteMatchingEngine> = {}): RouletteMatchingEngine {
  return {
    resolvePair: vi.fn(async () => ({
      vocal: { parentTrackId: 'vocal-a', stemAsset: stem('vocal-a', 'vocals') },
      instrumental: { parentTrackId: 'instrumental-a', stemAsset: stem('instrumental-a', 'instrumental') },
    })),
    resolveReplacement: vi.fn(async () => ({
      parentTrackId: 'vocal-b',
      stemAsset: stem('vocal-b', 'vocals'),
    })),
    ...overrides,
  };
}

describe('Roulette source-change UI/session regression flow', () => {
  it('keeps playback and the pair untouched on Cancel, then Stop + Continue commits a prepared replacement', async () => {
    const prepareSources = vi.fn(async () => undefined);
    const test = createHarness(matcher(), prepareSources);
    await expect(test.executor.actions.initialize()).resolves.toBe(true);
    const initialPair = test.state.sources;

    test.dispatch({ type: 'transport-changed', status: 'playing', masterBpm: 142 });
    expect(rouletteSourceChangeRequiresConfirmation('playing', test.state.transport.status)).toBe(true);

    // Cancel is intentionally a no-op: the dialog closes without touching
    // transport, sources, matching, or preparation.
    expect(test.state.transport.status).toBe('playing');
    expect(test.state.sources).toBe(initialPair);

    await expect(executeRouletteSourceChange(test.flowActions, 'vocal', { stopPlaybackFirst: true })).resolves.toBe(true);

    expect(test.state.transport.status).toBe('stopped');
    expect(test.state.sources.vocal).toEqual(selection('vocal-b', 'vocals'));
    expect(test.state.sources.instrumental).toBe(initialPair.instrumental);
    expect(test.state.command.status).toBe('idle');
    expect(prepareSources).toHaveBeenCalledTimes(2); // initial pair + replacement preflight
  });

  it('restores the last playable pair when Continue stops playback but replacement preflight fails', async () => {
    const prepareSources = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('decoder failed'));
    const test = createHarness(matcher(), prepareSources);
    await expect(test.executor.actions.initialize()).resolves.toBe(true);
    const initialPair = test.state.sources;
    test.dispatch({ type: 'transport-changed', status: 'playing', masterBpm: 142 });

    await expect(executeRouletteSourceChange(test.flowActions, 'vocal', { stopPlaybackFirst: true })).resolves.toBe(false);

    expect(test.state.transport.status).toBe('stopped');
    expect(test.state.sources).toBe(initialPair);
    expect(test.state.sources.vocal.stemStatus).toBe('ready');
    expect(test.state.sources.instrumental.stemStatus).toBe('ready');
    expect(test.state.command).toMatchObject({
      status: 'error',
      recoveryAction: 'retry',
      error: 'Roulette could not complete that source change. Try again.',
    });
  });

  it('preserves reconnect recovery instead of rolling back a replacement that needs its source media', async () => {
    const test = createHarness(
      matcher({
        resolveReplacement: vi.fn(async () => ({
          parentTrackId: 'vocal-usb',
          track: { id: 'vocal-usb' } as RouletteResolvedSource['track'],
          stemAsset: null,
        })),
      }),
      async () => undefined,
      async (resolved, role) => {
        if (resolved.parentTrackId === 'vocal-usb') {
          throw new RouletteSourceRecoveryRequiredError(role, resolved.parentTrackId, 'Reconnect USB-A to continue.');
        }
        return {
          parentTrackId: resolved.parentTrackId,
          stemRef: resolved.stemAsset?.id ?? `preview:${resolved.parentTrackId}:${role}`,
          stemStatus: 'ready' as const,
        };
      },
    );
    await expect(test.executor.actions.initialize()).resolves.toBe(true);

    await expect(executeRouletteSourceChange(test.flowActions, 'vocal')).resolves.toBe(false);

    expect(test.state.sources.vocal).toMatchObject({
      parentTrackId: 'vocal-usb',
      stemStatus: 'failed',
      stemRef: null,
    });
    expect(test.state.sources.instrumental.parentTrackId).toBe('instrumental-a');
    expect(test.state.command).toMatchObject({
      status: 'error',
      recoveryAction: 'reconnect-source',
      error: 'Reconnect USB-A to continue.',
    });
  });
});
