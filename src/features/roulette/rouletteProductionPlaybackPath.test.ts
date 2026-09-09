import { describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import { createRouletteActionExecutor } from './rouletteActions';
import { resolveRouletteAlignment } from './rouletteAlignment';
import { createRouletteMatchingEngine } from './rouletteMatchingEngine';
import type { RouletteCandidateAnalysis } from './rouletteMatching';
import {
  createInitialRouletteSessionState,
  rouletteSessionReducer,
  type RouletteSessionAction,
  type RouletteSessionState,
} from './rouletteSession';
import { STEM_ASSET_CONTRACT_VERSION, type StemAssetRecord } from './stemAssets';

function track(id: string, bpm: number): RekordboxTrack {
  return {
    id,
    import_id: 'import-1',
    rekordbox_content_id: id,
    title: id,
    artist: 'Artist',
    album: null,
    remixer: null,
    genre: 'Trap',
    label: 'Label',
    musical_key: 'Em',
    camelot_key: '9A',
    normalized_key_name: 'E minor',
    key_tonic: 'E',
    key_mode: 'minor',
    bpm,
    duration_seconds: 180,
    rating: null,
    comments: null,
    file_path: `/music/${id}.wav`,
    file_format: 'WAV',
    date_added: null,
  } as RekordboxTrack;
}

function grid(trackId: string, bpm: number, variable = false): BeatGridRow {
  const beatMs = 60_000 / bpm;
  const beats = Array.from({ length: 80 }, (_, index) => ({
    seq: index + 1,
    srcIdx: index + 1,
    beatInBar: (index % 4) + 1,
    bar: Math.floor(index / 4) + 1,
    ms: Math.round(index * beatMs),
    bpm,
    isDownbeat: index % 4 === 0,
  }));
  return {
    id: `grid-${trackId}`,
    import_id: 'import-1',
    track_id: trackId,
    source_tag: 'PQTZ',
    beats,
    beat_count: beats.length,
    downbeat_count: 20,
    bar_count: 20,
    first_beat_ms: 0,
    first_downbeat_ms: 0,
    minimum_bpm: variable ? bpm - 2 : bpm,
    maximum_bpm: variable ? bpm + 2 : bpm,
    is_variable_tempo: variable,
    parser_version: 'integration-test',
  };
}

function stem(trackId: string, stemType: 'vocals' | 'instrumental'): StemAssetRecord {
  return {
    id: `${trackId}-${stemType}`,
    track_id: trackId,
    stem_type: stemType,
    status: 'ready',
    storage_locator: `${trackId}/${stemType}.wav`,
    source_fingerprint: `fingerprint-${trackId}`,
    separator_version: 'separator-v1',
    contract_version: STEM_ASSET_CONTRACT_VERSION,
    duration_ms: 180_000,
    sample_rate_hz: 48_000,
    channel_count: 2,
    file_size_bytes: 1024,
    file_mtime_ms: 100,
    failure_code: null,
    failure_message: null,
    created_at: '2026-09-08T00:00:00Z',
    updated_at: '2026-09-08T00:00:00Z',
  };
}

function candidate(
  source: RekordboxTrack,
  role: 'vocal' | 'instrumental',
  beatGrid: BeatGridRow,
): RouletteCandidateAnalysis {
  return {
    track: source,
    stemAsset: stem(source.id, role === 'vocal' ? 'vocals' : 'instrumental'),
    beatGrid,
    phraseCount: 2,
    vocalAnalysisAvailable: role === 'vocal',
  };
}

function createStateHarness() {
  let state: RouletteSessionState = createInitialRouletteSessionState();
  return {
    getState: () => state,
    dispatch: (action: RouletteSessionAction) => {
      state = rouletteSessionReducer(state, action);
    },
  };
}

describe('Roulette production behavior integration', () => {
  it('executes Roulette Both and Change Vocal through real matching, preflight, and session commit boundaries', async () => {
    const tracks = new Map([
      ['vocal-a', track('vocal-a', 140)],
      ['vocal-b', track('vocal-b', 141)],
      ['instrumental-a', track('instrumental-a', 142)],
      ['instrumental-b', track('instrumental-b', 141.5)],
    ]);
    const grids = new Map([...tracks].map(([id, value]) => [id, grid(id, value.bpm!)]));
    const vocals = ['vocal-a', 'vocal-b'].map((id) => candidate(tracks.get(id)!, 'vocal', grids.get(id)!));
    const instrumentals = ['instrumental-a', 'instrumental-b']
      .map((id) => candidate(tracks.get(id)!, 'instrumental', grids.get(id)!));
    const assets = new Map<string, StemAssetRecord>();
    for (const item of [...vocals, ...instrumentals]) assets.set(item.stemAsset.id, item.stemAsset);

    const matching = createRouletteMatchingEngine({
      loadTrack: async (id) => tracks.get(id) ?? null,
      loadBeatGrid: async (id) => grids.get(id) ?? null,
      loadCandidates: async (role) => role === 'vocal' ? vocals : instrumentals,
      stemAssets: {
        getReadiness: vi.fn(async (trackId, stemType) => {
          const asset = assets.get(`${trackId}-${stemType}`) ?? null;
          return {
            parentTrackId: trackId,
            stemType,
            status: asset ? 'ready' as const : 'unavailable' as const,
            asset,
            reason: null,
          };
        }),
      },
      rng: () => 0,
    });
    const harness = createStateHarness();
    const preflight = vi.fn(async (sources) => {
      const vocalTrack = tracks.get(sources.vocal.parentTrackId!);
      const instrumentalTrack = tracks.get(sources.instrumental.parentTrackId!);
      expect(vocalTrack).toBeDefined();
      expect(instrumentalTrack).toBeDefined();
      const alignment = resolveRouletteAlignment(
        { track: vocalTrack!, beatGrid: grids.get(vocalTrack!.id)! },
        { track: instrumentalTrack!, beatGrid: grids.get(instrumentalTrack!.id)! },
      );
      expect(alignment.tempo.masterRole).toBe('instrumental');
    });
    const executor = createRouletteActionExecutor({
      getState: harness.getState,
      dispatch: harness.dispatch,
      matcher: matching,
      prepareSources: preflight,
    });

    await expect(executor.actions.replaceBoth()).resolves.toBe(true);
    expect(preflight).toHaveBeenCalledTimes(1);
    const firstPair = harness.getState().sources;
    expect(firstPair.vocal.parentTrackId).toBeTruthy();
    expect(firstPair.instrumental.parentTrackId).toBeTruthy();

    await expect(executor.actions.replaceSource('vocal')).resolves.toBe(true);
    expect(preflight).toHaveBeenCalledTimes(2);
    const secondPair = harness.getState().sources;
    expect(secondPair.instrumental.parentTrackId).toBe(firstPair.instrumental.parentTrackId);
    expect(secondPair.vocal.parentTrackId).not.toBe(firstPair.vocal.parentTrackId);
  });

  it('rejects a variable-tempo source in the real matcher before audio preflight can run', async () => {
    const vocalTrack = track('vocal-variable', 142);
    const instrumentalTrack = track('instrumental-fixed', 142);
    const vocalGrid = grid(vocalTrack.id, 142, true);
    const instrumentalGrid = grid(instrumentalTrack.id, 142, false);
    const vocal = candidate(vocalTrack, 'vocal', vocalGrid);
    const instrumental = candidate(instrumentalTrack, 'instrumental', instrumentalGrid);
    const matching = createRouletteMatchingEngine({
      loadTrack: async (id) => id === vocalTrack.id ? vocalTrack : instrumentalTrack,
      loadBeatGrid: async (id) => id === vocalTrack.id ? vocalGrid : instrumentalGrid,
      loadCandidates: async (role) => role === 'vocal' ? [vocal] : [instrumental],
      stemAssets: {
        getReadiness: vi.fn(async (trackId, stemType) => ({
          parentTrackId: trackId,
          stemType,
          status: 'ready' as const,
          asset: stem(trackId, stemType),
          reason: null,
        })),
      },
    });
    const harness = createStateHarness();
    const preflight = vi.fn(async () => undefined);
    const executor = createRouletteActionExecutor({
      getState: harness.getState,
      dispatch: harness.dispatch,
      matcher: matching,
      prepareSources: preflight,
    });

    await expect(executor.actions.replaceBoth()).resolves.toBe(false);
    expect(preflight).not.toHaveBeenCalled();
    expect(harness.getState().command.error).toBe('No compatible stem-ready pair found.');
  });
});
