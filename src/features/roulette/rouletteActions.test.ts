import { describe, expect, it, vi } from 'vitest';
import { createRouletteActionExecutor } from './rouletteActions';
import {
  createInitialRouletteSessionState,
  rouletteSessionReducer,
  type RouletteSessionAction,
  type RouletteSessionState,
  type RouletteSourceSelection,
} from './rouletteSession';
import type { RouletteMatchingEngine } from './rouletteMatchingEngine';
import { STEM_ASSET_CONTRACT_VERSION, type StemAssetRecord } from './stemAssets';

function selection(id: string, stemRef: string): RouletteSourceSelection {
  return { parentTrackId: id, stemRef, stemStatus: 'ready' };
}

function stem(id: string, type: 'vocals' | 'instrumental'): StemAssetRecord {
  return {
    id: `${id}-${type}`,
    track_id: id,
    stem_type: type,
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
    failure_code: null,
    failure_message: null,
    created_at: '2026-09-08T00:00:00Z',
    updated_at: '2026-09-08T00:00:00Z',
  };
}

function harness(matcher: RouletteMatchingEngine, initial?: RouletteSessionState) {
  let state = initial ?? createInitialRouletteSessionState();
  const dispatch = (action: RouletteSessionAction) => {
    state = rouletteSessionReducer(state, action);
  };
  const executor = createRouletteActionExecutor({ getState: () => state, dispatch, matcher });
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

  it('preserves the previous pair when pair resolution fails', async () => {
    const test = harness(matcher(), readyPairState());
    const previousSources = test.state.sources;

    await expect(test.executor.actions.replaceBoth()).resolves.toBe(false);
    expect(test.state.sources).toBe(previousSources);
    expect(test.state.command.error).toBe('No compatible stem-ready pair found.');
  });

  it('requires the opposite selected deck for one-sided replacement', async () => {
    const resolveReplacement = vi.fn(async () => null);
    const test = harness(matcher({ resolveReplacement }));

    await expect(test.executor.actions.replaceSource('vocal')).resolves.toBe(false);
    expect(resolveReplacement).not.toHaveBeenCalled();
    expect(test.state.command.error).toBe('Select an instrumental source before changing the vocal.');
  });
});
