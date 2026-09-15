import { describe, expect, it, vi } from 'vitest';
import { createRouletteActionExecutor } from './rouletteActions';
import {
  createInitialRouletteSessionState,
  rouletteSessionReducer,
  type RouletteSessionAction,
  type RouletteSessionState,
  type RouletteSourceSelection,
} from './rouletteSession';
import type { RouletteMatchingEngine, RouletteResolvedSource } from './rouletteMatchingEngine';
import { STEM_ASSET_CONTRACT_VERSION, type StemAssetRecord } from './stemAssets';

function selection(id: string, stemRef: string): RouletteSourceSelection {
  return { parentTrackId: id, stemRef, stemStatus: 'ready' };
}

function stem(id: string, type: 'vocals' | 'instrumental'): StemAssetRecord {
  return {
    id: `${id}-${type}`,
    track_id: id,
    stem_type: type,
    installation_id: 'installation-1',
    status: 'ready',
    storage_locator: `${id}/${type}.wav`,
    source_fingerprint: `fingerprint-${id}`,
    separator_version: 'separator-v1',
    contract_version: STEM_ASSET_CONTRACT_VERSION,
    duration_ms: 1000,
    sample_rate_hz: 48000,
    channel_count: 2,
    file_size_bytes: 1000,
    file_mtime_ms: 100,
    analysis_metrics: null,
    failure_code: null,
    failure_message: null,
    created_at: '2026-09-08T00:00:00Z',
    updated_at: '2026-09-08T00:00:00Z',
  };
}

function harness(
  matcher: RouletteMatchingEngine,
  initial?: RouletteSessionState,
  prepareSources: NonNullable<Parameters<typeof createRouletteActionExecutor>[0]['prepareSources']> = async () => undefined,
  prepareResolvedSource?: (
    resolved: RouletteResolvedSource,
    role: 'vocal' | 'instrumental',
    signal: AbortSignal,
  ) => Promise<RouletteSourceSelection>,
) {
  let state = initial ?? createInitialRouletteSessionState();
  const dispatch = (action: RouletteSessionAction) => {
    state = rouletteSessionReducer(state, action);
  };
  const executor = createRouletteActionExecutor({
    getState: () => state,
    dispatch,
    matcher,
    prepareSources,
    ...(prepareResolvedSource ? { prepareResolvedSource } : {}),
  });
  return { executor, get state() { return state; } };
}

function matcher(overrides: Partial<RouletteMatchingEngine> = {}): RouletteMatchingEngine {
  return {
    resolveReplacement: vi.fn(async () => null),
    resolvePair: vi.fn(async () => null),
    ...overrides,
  };
}

function readyPairState(): RouletteSessionState {
  let state = createInitialRouletteSessionState();
  state = rouletteSessionReducer(state, {
    type: 'commit-pair',
    vocal: selection('vocal-a', 'vocal-a-vocals'),
    instrumental: selection('instrumental-a', 'instrumental-a-instrumental'),
  });
  return state;
}

describe('Roulette production action/state integration', () => {

  it('initializes an empty session through the real command boundary and commits only after both sources are prepared', async () => {
    const resolvePair = vi.fn(async () => ({
      vocal: { parentTrackId: 'vocal-a', stemAsset: stem('vocal-a', 'vocals') },
      instrumental: { parentTrackId: 'instrumental-a', stemAsset: stem('instrumental-a', 'instrumental') },
    }));
    const prepareSources = vi.fn(async () => undefined);
    const test = harness(matcher({ resolvePair }), undefined, prepareSources);

    await expect(test.executor.actions.initialize()).resolves.toBe(true);

    expect(resolvePair).toHaveBeenCalledWith(expect.objectContaining({
      currentVocalTrackId: null,
      currentInstrumentalTrackId: null,
    }));
    expect(prepareSources).toHaveBeenCalledTimes(1);
    expect(test.state.sources).toEqual({
      vocal: selection('vocal-a', 'vocal-a-vocals'),
      instrumental: selection('instrumental-a', 'instrumental-a-instrumental'),
    });
  });

  it('prepares a compatible source that has no ready HQ asset before committing it', async () => {
    const resolvedTrack = { id: 'vocal-preview' } as RouletteResolvedSource['track'];
    const resolveReplacement = vi.fn(async () => ({
      parentTrackId: 'vocal-preview',
      track: resolvedTrack,
      stemAsset: null,
    }));
    const lockedWindow = {
      sourceTimeMs: 12_000,
      windowEndMs: 39_000,
      durationMs: 27_000,
      sourceBar: 9,
      sourceBeatSequence: 33,
      requestedBars: 16,
      provenance: 'phrase' as const,
    };
    const prepareResolvedSource = vi.fn(async (_resolved, role: 'vocal' | 'instrumental') => ({
      parentTrackId: 'vocal-preview',
      stemRef: `preview:vocal-preview:${role}`,
      stemStatus: 'ready' as const,
      window: lockedWindow,
    }));
    const prepareSources = vi.fn(async () => undefined);
    const test = harness(
      matcher({ resolveReplacement }),
      readyPairState(),
      prepareSources,
      prepareResolvedSource,
    );

    await expect(test.executor.actions.replaceSource('vocal')).resolves.toBe(true);

    expect(prepareResolvedSource).toHaveBeenCalledWith(
      expect.objectContaining({ parentTrackId: 'vocal-preview', stemAsset: null }),
      'vocal',
      expect.any(AbortSignal),
    );
    expect(test.state.sources.vocal).toMatchObject({
      parentTrackId: 'vocal-preview',
      stemStatus: 'ready',
      window: lockedWindow,
    });
    expect(prepareSources).toHaveBeenCalledTimes(1);
  });

  it('preserves the exact locked 16-bar section on the fixed deck during one-sided replacement', async () => {
    const lockedInstrumental: RouletteSourceSelection = {
      ...selection('instrumental-a', 'instrumental-a-instrumental'),
      window: {
        sourceTimeMs: 20_000,
        windowEndMs: 47_000,
        durationMs: 27_000,
        sourceBar: 13,
        sourceBeatSequence: 49,
        requestedBars: 16,
        provenance: 'pvdi-phrase',
      },
    };
    let initial = createInitialRouletteSessionState();
    initial = rouletteSessionReducer(initial, {
      type: 'commit-pair',
      vocal: selection('vocal-a', 'vocal-a-vocals'),
      instrumental: lockedInstrumental,
    });
    const resolveReplacement = vi.fn(async () => ({
      parentTrackId: 'vocal-b',
      stemAsset: stem('vocal-b', 'vocals'),
    }));
    const prepareSources = vi.fn(async () => undefined);
    const test = harness(matcher({ resolveReplacement }), initial, prepareSources);

    await expect(test.executor.actions.replaceSource('vocal')).resolves.toBe(true);

    expect(test.state.sources.instrumental).toBe(lockedInstrumental);
    expect(prepareSources).toHaveBeenCalledWith(
      expect.objectContaining({ instrumental: lockedInstrumental }),
      expect.any(AbortSignal),
    );
  });

  it('routes Change Vocal through the matcher and preserves instrumental identity', async () => {
    const resolveReplacement = vi.fn(async () => ({
      parentTrackId: 'vocal-b',
      stemAsset: stem('vocal-b', 'vocals'),
    }));
    const test = harness(matcher({ resolveReplacement }), readyPairState());
    const priorInstrumental = test.state.sources.instrumental;

    await expect(test.executor.actions.replaceSource('vocal')).resolves.toBe(true);

    expect(resolveReplacement).toHaveBeenCalledWith(expect.objectContaining({
      role: 'vocal',
      fixedTrackId: 'instrumental-a',
      currentTrackId: 'vocal-a',
    }));
    expect(test.state.sources.vocal.parentTrackId).toBe('vocal-b');
    expect(test.state.sources.instrumental).toBe(priorInstrumental);
  });

  it('routes Change Instrumental through the matcher and preserves vocal identity', async () => {
    const resolveReplacement = vi.fn(async () => ({
      parentTrackId: 'instrumental-b',
      stemAsset: stem('instrumental-b', 'instrumental'),
    }));
    const test = harness(matcher({ resolveReplacement }), readyPairState());
    const priorVocal = test.state.sources.vocal;

    await expect(test.executor.actions.replaceSource('instrumental')).resolves.toBe(true);

    expect(resolveReplacement).toHaveBeenCalledWith(expect.objectContaining({
      role: 'instrumental',
      fixedTrackId: 'vocal-a',
      currentTrackId: 'instrumental-a',
    }));
    expect(test.state.sources.instrumental.parentTrackId).toBe('instrumental-b');
    expect(test.state.sources.vocal).toBe(priorVocal);
  });

  it('routes Roulette Both through one pair resolution and commits both only after success', async () => {
    const resolvePair = vi.fn(async () => ({
      vocal: { parentTrackId: 'vocal-b', stemAsset: stem('vocal-b', 'vocals') },
      instrumental: { parentTrackId: 'instrumental-b', stemAsset: stem('instrumental-b', 'instrumental') },
    }));
    const test = harness(matcher({ resolvePair }), readyPairState());

    await expect(test.executor.actions.replaceBoth()).resolves.toBe(true);
    expect(resolvePair).toHaveBeenCalledTimes(1);
    expect(test.state.sources.vocal.parentTrackId).toBe('vocal-b');
    expect(test.state.sources.instrumental.parentTrackId).toBe('instrumental-b');
  });

  it('rejects a same-parent pair even if an injected matcher violates the canonical invariant', async () => {
    const resolvePair = vi.fn(async () => ({
      vocal: { parentTrackId: 'same-parent', stemAsset: stem('same-parent', 'vocals') },
      instrumental: { parentTrackId: 'same-parent', stemAsset: stem('same-parent', 'instrumental') },
    }));
    const test = harness(matcher({ resolvePair }), readyPairState());
    const previousSources = test.state.sources;

    await expect(test.executor.actions.replaceBoth()).resolves.toBe(false);

    expect(test.state.sources).toBe(previousSources);
    expect(test.state.command.error).toContain('same-parent');
  });

  it('preserves the previous pair when pair resolution fails', async () => {
    const test = harness(matcher(), readyPairState());
    const previousSources = test.state.sources;

    await expect(test.executor.actions.replaceBoth()).resolves.toBe(false);
    expect(test.state.sources).toBe(previousSources);
    expect(test.state.command.error).toBe('No fully replaceable compatible Roulette pair found.');
  });

  it('requires the opposite selected deck for one-sided replacement', async () => {
    const resolveReplacement = vi.fn(async () => null);
    const test = harness(matcher({ resolveReplacement }));

    await expect(test.executor.actions.replaceSource('vocal')).resolves.toBe(false);
    expect(resolveReplacement).not.toHaveBeenCalled();
    expect(test.state.command.error).toBe('Select an instrumental source before changing the vocal.');
  });

  it('rejects source replacement while Roulette transport is playing', async () => {
    const resolveReplacement = vi.fn(async () => ({
      parentTrackId: 'vocal-b',
      stemAsset: stem('vocal-b', 'vocals'),
    }));
    let playing = readyPairState();
    playing = rouletteSessionReducer(playing, {
      type: 'transport-changed',
      status: 'playing',
      masterBpm: 142,
    });
    const test = harness(matcher({ resolveReplacement }), playing);

    await expect(test.executor.actions.replaceSource('vocal')).resolves.toBe(false);
    expect(resolveReplacement).not.toHaveBeenCalled();
    expect(test.state.sources).toBe(playing.sources);
  });


  it('preflights the complete prospective pair before committing a one-sided replacement', async () => {
    const resolveReplacement = vi.fn(async () => ({
      parentTrackId: 'vocal-b',
      stemAsset: stem('vocal-b', 'vocals'),
    }));
    const prepareSources = vi.fn(async () => undefined);
    const test = harness(matcher({ resolveReplacement }), readyPairState(), prepareSources);

    await expect(test.executor.actions.replaceSource('vocal')).resolves.toBe(true);

    expect(prepareSources).toHaveBeenCalledWith({
      vocal: selection('vocal-b', 'vocal-b-vocals'),
      instrumental: selection('instrumental-a', 'instrumental-a-instrumental'),
    }, expect.any(AbortSignal));
    expect(test.state.sources.vocal.parentTrackId).toBe('vocal-b');
  });

  it('rolls back identity when candidate audio/anchor/tempo preflight fails', async () => {
    const resolvePair = vi.fn(async () => ({
      vocal: { parentTrackId: 'vocal-b', stemAsset: stem('vocal-b', 'vocals') },
      instrumental: { parentTrackId: 'instrumental-b', stemAsset: stem('instrumental-b', 'instrumental') },
    }));
    const previous = readyPairState();
    const previousSources = previous.sources;
    const prepareSources = vi.fn(async () => { throw new Error('tempo processor failed'); });
    const test = harness(matcher({ resolvePair }), previous, prepareSources);

    await expect(test.executor.actions.replaceBoth()).resolves.toBe(false);

    expect(prepareSources).toHaveBeenCalledTimes(1);
    expect(test.state.sources).toBe(previousSources);
    expect(test.state.command.error).toBe('tempo processor failed');
  });

  it('passes bounded recent history back into subsequent Roulette Both resolution', async () => {
    const resolvePair = vi.fn()
      .mockResolvedValueOnce({
        vocal: { parentTrackId: 'vocal-b', stemAsset: stem('vocal-b', 'vocals') },
        instrumental: { parentTrackId: 'instrumental-b', stemAsset: stem('instrumental-b', 'instrumental') },
      })
      .mockResolvedValueOnce({
        vocal: { parentTrackId: 'vocal-c', stemAsset: stem('vocal-c', 'vocals') },
        instrumental: { parentTrackId: 'instrumental-c', stemAsset: stem('instrumental-c', 'instrumental') },
      });
    const test = harness(matcher({ resolvePair }), readyPairState());

    await expect(test.executor.actions.replaceBoth()).resolves.toBe(true);
    await expect(test.executor.actions.replaceBoth()).resolves.toBe(true);

    expect(resolvePair.mock.calls[1][0]).toEqual(expect.objectContaining({
      recentVocalTrackIds: expect.arrayContaining(['vocal-a', 'vocal-b']),
      recentInstrumentalTrackIds: expect.arrayContaining(['instrumental-a', 'instrumental-b']),
      recentPairKeys: expect.arrayContaining([
        'vocal-a\u0000instrumental-a',
        'vocal-b\u0000instrumental-b',
      ]),
    }));
  });


  it('serializes rapid replacement commands while candidate preflight is still loading', async () => {
    const resolvePair = vi.fn(async () => ({
      vocal: { parentTrackId: 'vocal-b', stemAsset: stem('vocal-b', 'vocals') },
      instrumental: { parentTrackId: 'instrumental-b', stemAsset: stem('instrumental-b', 'instrumental') },
    }));
    let finishPrepare!: () => void;
    const prepareSources = vi.fn(() => new Promise<void>((resolve) => { finishPrepare = resolve; }));
    const test = harness(matcher({ resolvePair }), readyPairState(), prepareSources);

    const first = test.executor.actions.replaceBoth();
    await vi.waitFor(() => expect(prepareSources).toHaveBeenCalledTimes(1));
    await expect(test.executor.actions.replaceBoth()).resolves.toBe(false);
    expect(resolvePair).toHaveBeenCalledTimes(1);

    finishPrepare();
    await expect(first).resolves.toBe(true);
  });

  it('cancels in-flight preflight without committing a partial replacement', async () => {
    const resolvePair = vi.fn(async () => ({
      vocal: { parentTrackId: 'vocal-b', stemAsset: stem('vocal-b', 'vocals') },
      instrumental: { parentTrackId: 'instrumental-b', stemAsset: stem('instrumental-b', 'instrumental') },
    }));
    const prepareSources = vi.fn((_sources, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    }));
    const initial = readyPairState();
    const previousSources = initial.sources;
    const test = harness(matcher({ resolvePair }), initial, prepareSources);

    const pending = test.executor.actions.replaceBoth();
    await vi.waitFor(() => expect(prepareSources).toHaveBeenCalledTimes(1));
    test.executor.cancel();

    await expect(pending).resolves.toBe(false);
    expect(test.state.sources).toBe(previousSources);
    expect(test.state.command.status).toBe('idle');
  });

});
