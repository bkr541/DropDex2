import { describe, expect, it } from 'vitest';
import {
  createInitialRouletteSessionState,
  rouletteSessionReducer,
  type RouletteSourceSelection,
} from './rouletteSession';

const vocalA: RouletteSourceSelection = {
  parentTrackId: 'track-vocal-a',
  stemRef: 'stem-vocal-a',
  stemStatus: 'ready',
};

const vocalB: RouletteSourceSelection = {
  parentTrackId: 'track-vocal-b',
  stemRef: 'stem-vocal-b',
  stemStatus: 'ready',
};

const instrumentalA: RouletteSourceSelection = {
  parentTrackId: 'track-instrumental-a',
  stemRef: 'stem-instrumental-a',
  stemStatus: 'ready',
};

const instrumentalB: RouletteSourceSelection = {
  parentTrackId: 'track-instrumental-b',
  stemRef: 'stem-instrumental-b',
  stemStatus: 'ready',
};

function readyPair() {
  return rouletteSessionReducer(createInitialRouletteSessionState(), {
    type: 'commit-pair',
    vocal: vocalA,
    instrumental: instrumentalA,
  });
}

describe('roulette session state', () => {
  it('starts with stable source roles and no fabricated runtime selection', () => {
    expect(createInitialRouletteSessionState()).toEqual({
      sources: {
        vocal: { parentTrackId: null, stemRef: null, stemStatus: 'unavailable' },
        instrumental: { parentTrackId: null, stemRef: null, stemStatus: 'unavailable' },
      },
      command: { active: null, requestId: null, status: 'idle', error: null },
      transport: { status: 'stopped', masterBpm: null },
    });
  });

  it('replaces the vocal without changing the instrumental identity', () => {
    const state = readyPair();
    const next = rouletteSessionReducer(state, {
      type: 'commit-source',
      role: 'vocal',
      selection: vocalB,
    });

    expect(next.sources.vocal).toEqual(vocalB);
    expect(next.sources.instrumental).toBe(state.sources.instrumental);
  });

  it('replaces the instrumental without changing the vocal identity', () => {
    const state = readyPair();
    const next = rouletteSessionReducer(state, {
      type: 'commit-source',
      role: 'instrumental',
      selection: instrumentalB,
    });

    expect(next.sources.instrumental).toEqual(instrumentalB);
    expect(next.sources.vocal).toBe(state.sources.vocal);
  });

  it('commits a resolved pair atomically', () => {
    const state = readyPair();
    const next = rouletteSessionReducer(state, {
      type: 'commit-pair',
      vocal: vocalB,
      instrumental: instrumentalB,
    });

    expect(next.sources).toEqual({ vocal: vocalB, instrumental: instrumentalB });
  });

  it('preserves the previous playable pair when a replacement command fails', () => {
    const state = readyPair();
    const loading = rouletteSessionReducer(state, {
      type: 'command-started',
      command: 'replace-both',
      requestId: 'request-1',
    });
    const failed = rouletteSessionReducer(loading, {
      type: 'command-failed',
      command: 'replace-both',
      requestId: 'request-1',
      error: 'No compatible pair found',
    });

    expect(failed.sources).toBe(loading.sources);
    expect(failed.sources).toEqual(state.sources);
    expect(failed.command).toEqual({
      active: null,
      requestId: null,
      status: 'error',
      error: 'No compatible pair found',
    });
  });

  it('ignores stale completion from an older request with the same command', () => {
    const startedFirst = rouletteSessionReducer(readyPair(), {
      type: 'command-started',
      command: 'replace-vocal',
      requestId: 'request-1',
    });
    const startedSecond = rouletteSessionReducer(startedFirst, {
      type: 'command-started',
      command: 'replace-vocal',
      requestId: 'request-2',
    });
    const stale = rouletteSessionReducer(startedSecond, {
      type: 'command-finished',
      command: 'replace-vocal',
      requestId: 'request-1',
    });

    expect(stale).toBe(startedSecond);
    expect(stale.command).toEqual({
      active: 'replace-vocal',
      requestId: 'request-2',
      status: 'loading',
      error: null,
    });
  });

});
