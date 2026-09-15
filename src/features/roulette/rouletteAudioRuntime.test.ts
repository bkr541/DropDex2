import { describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { BeatGridRow, PhraseRow, VocalAnalysisRow } from '../../lib/queries/analysisData';
import { DecodedAudioCache } from '../../lib/audio/decodedAudioCache';
import { createRouletteAudioRuntime, type RouletteMixState } from './rouletteAudioRuntime';
import { STEM_ASSET_CONTRACT_VERSION, type StemAssetRecord } from './stemAssets';
import type { RouletteSourceSelection } from './rouletteSession';

class FakeSourceNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  starts: Array<{ when: number; offset: number; duration: number }> = [];
  stops: Array<number | undefined> = [];
  connectedTo: unknown = null;
  disconnected = false;

  connect(destination: unknown) { this.connectedTo = destination; return destination; }
  disconnect() { this.disconnected = true; }
  start(when: number, offset: number, duration: number) { this.starts.push({ when, offset, duration }); }
  stop(when?: number) { this.stops.push(when); }
}

class FakeGainNode {
  gain = {
    value: 1,
    setValueAtTime: (value: number) => { this.gain.value = value; },
  };
  connectedTo: unknown = null;
  disconnected = false;

  connect(destination: unknown) { this.connectedTo = destination; return destination; }
  disconnect() { this.disconnected = true; }
}


class FakeCompressorNode {
  threshold = { value: 0 };
  knee = { value: 0 };
  ratio = { value: 1 };
  attack = { value: 0 };
  release = { value: 0 };
  connectedTo: unknown = null;
  disconnected = false;

  connect(destination: unknown) { this.connectedTo = destination; return destination; }
  disconnect() { this.disconnected = true; }
}

function fakeAudioContext() {
  const sources: FakeSourceNode[] = [];
  const gains: FakeGainNode[] = [];
  const compressors: FakeCompressorNode[] = [];
  const context = {
    currentTime: 10,
    state: 'running',
    destination: {},
    createBufferSource: () => {
      const node = new FakeSourceNode();
      sources.push(node);
      return node as unknown as AudioBufferSourceNode;
    },
    createGain: () => {
      const node = new FakeGainNode();
      gains.push(node);
      return node as unknown as GainNode;
    },
    createDynamicsCompressor: () => {
      const node = new FakeCompressorNode();
      compressors.push(node);
      return node as unknown as DynamicsCompressorNode;
    },
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as AudioContext;
  return { context, sources, gains, compressors };
}

function track(id: string, bpm = 142): RekordboxTrack {
  return { id, bpm, title: id } as RekordboxTrack;
}

function grid(trackId: string, downbeatMs: number): BeatGridRow {
  const beatMs = 422;
  const beats = Array.from({ length: 40 * 4 }, (_, index) => {
    const beatInBar = (index % 4) + 1;
    return {
      seq: index + 1,
      srcIdx: index + 1,
      beatInBar,
      bar: Math.floor(index / 4) + 1,
      ms: downbeatMs + index * beatMs,
      bpm: 142,
      isDownbeat: beatInBar === 1,
    };
  });
  return {
    id: `grid-${trackId}`,
    import_id: 'import-1',
    track_id: trackId,
    source_tag: 'PQTZ',
    beats,
    beat_count: beats.length,
    downbeat_count: 40,
    bar_count: 40,
    first_beat_ms: downbeatMs,
    first_downbeat_ms: downbeatMs,
    minimum_bpm: 142,
    maximum_bpm: 142,
    is_variable_tempo: false,
    parser_version: 'test',
  };
}

function phraseAtBar(trackId: string, phraseIndex: number, bar: number): PhraseRow {
  const startBeat = (bar - 1) * 4 + 1;
  return {
    id: `${trackId}-phrase-${phraseIndex}`,
    import_id: 'import-1',
    track_id: trackId,
    phrase_index: phraseIndex,
    source_mood: '2',
    source_kind: '2',
    source_bank: null,
    normalized_label: 'verse',
    start_beat: startBeat,
    end_beat: startBeat + 63,
    start_ms: (startBeat - 1) * 422,
    end_ms: (startBeat + 62) * 422,
    fill_start_beat: null,
    fill_start_ms: null,
    source_flags: {},
    source_payload: {},
    parser_version: 'test',
  };
}

function vocalAnalysis(trackId: string, startMs: number): VocalAnalysisRow {
  return {
    id: `${trackId}-pvdi`,
    import_id: 'import-1',
    track_id: trackId,
    source_tag: 'PVDI',
    source_header_length: null,
    source_u1: null,
    source_u2: null,
    frame_duration_ms: 100,
    frame_count: 1000,
    regions: [{
      start_frame: Math.floor(startMs / 100),
      end_frame_exclusive: Math.floor((startMs + 5000) / 100),
      start_ms: startMs,
      end_ms: startMs + 5000,
      duration_ms: 5000,
      peak_confidence: 4,
    }],
    integrity_status: 'valid',
    complete: true,
    parse_warnings: [],
    parser_version: 'test',
  };
}

function asset(trackId: string, type: 'vocals' | 'instrumental'): StemAssetRecord {
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
    duration_ms: 60000,
    sample_rate_hz: 100,
    channel_count: 1,
    file_size_bytes: 1200,
    file_mtime_ms: 100,
    analysis_metrics: null,
    failure_code: null,
    failure_message: null,
    created_at: '2026-09-08T00:00:00Z',
    updated_at: '2026-09-08T00:00:00Z',
  };
}

function buffer(duration: number): AudioBuffer {
  const sampleRate = 100;
  const data = new Float32Array(duration * sampleRate);
  for (let index = 0; index < data.length; index += 10) data[index] = 0.5;
  return {
    duration,
    length: data.length,
    numberOfChannels: 1,
    sampleRate,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

const mix: RouletteMixState = {
  vocal: { gain: 0.8, muted: false, solo: false },
  instrumental: { gain: 0.6, muted: false, solo: false },
};

function selection(trackId: string, type: 'vocals' | 'instrumental'): RouletteSourceSelection {
  return {
    parentTrackId: trackId,
    stemRef: `${trackId}-${type}`,
    stemStatus: 'ready',
  };
}

describe('Roulette audio runtime', () => {
  it('uses phrase/PVDI anchor resolution before Stage-5 shared-clock scheduling', async () => {
    const audio = fakeAudioContext();
    const runtime = createRouletteAudioRuntime({
      getAudioContext: () => audio.context,
      decodedCache: new DecodedAudioCache<AudioBuffer>(4),
      loadTrack: async (id) => track(id),
      loadBeatGrid: async (id) => grid(id, 0),
      loadPhrases: async (id) => id === 'vocal-a'
        ? [phraseAtBar(id, 0, 9)]
        : [phraseAtBar(id, 0, 5)],
      loadVocalAnalysis: async (id) => id === 'vocal-a' ? vocalAnalysis(id, 14_000) : null,
      stemAssets: {
        resolveReady: async (id, type) => ({
          asset: asset(id, type),
          source: { kind: 'url' as const, url: `dropdex://stem/${id}`, size: 1200, mtimeMs: 100 },
        }),
      },
      loadDecodedSources: vi.fn(async () => [buffer(60), buffer(60)]),
    });

    const result = await runtime.play({
      vocal: selection('vocal-a', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    }, mix);

    expect(result.anchors.vocal).toMatchObject({ provenance: 'pvdi-phrase', sourceBar: 9 });
    expect(result.anchors.instrumental).toMatchObject({ provenance: 'phrase', sourceBar: 5 });
    expect(audio.sources[0].starts[0].offset).toBeCloseTo(13.504, 8);
    expect(audio.sources[1].starts[0].offset).toBeCloseTo(6.752, 8);
    expect(audio.sources[0].starts[0].when).toBe(audio.sources[1].starts[0].when);
  });

  it('schedules two ready stems concurrently from one AudioContext clock with independent source offsets', async () => {
    const audio = fakeAudioContext();
    const loadDecodedSources = vi.fn(async () => [buffer(60), buffer(60)]);
    const runtime = createRouletteAudioRuntime({
      getAudioContext: () => audio.context,
      decodedCache: new DecodedAudioCache<AudioBuffer>(4),
      loadTrack: async (id) => track(id),
      loadBeatGrid: async (id) => grid(id, id === 'vocal-a' ? 1000 : 2500),
      loadPhrases: async () => [],
      loadVocalAnalysis: async () => null,
      stemAssets: {
        resolveReady: async (id, type) => {
          const stem = asset(id, type);
          return {
            asset: stem,
            source: { kind: 'url' as const, url: `dropdex://stem/${id}`, size: 1200, mtimeMs: 100 },
          };
        },
      },
      loadDecodedSources,
    });

    const result = await runtime.play({
      vocal: selection('vocal-a', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    }, mix);

    expect(audio.sources).toHaveLength(2);
    expect(audio.sources[0].starts[0].when).toBe(audio.sources[1].starts[0].when);
    expect(audio.sources[0].starts[0].when).toBeCloseTo(10.05, 8);
    expect(audio.sources[0].starts[0].offset).toBe(1);
    expect(audio.sources[1].starts[0].offset).toBe(2.5);
    expect(audio.sources[0].starts[0].duration).toBeCloseTo(27.008, 8);
    expect(audio.sources[1].starts[0].duration).toBeCloseTo(27.008, 8);
    expect(result.durationSeconds).toBeCloseTo(27.008, 8);
    expect(result.waveforms.vocal.length).toBeGreaterThan(0);
    expect(result.waveforms.instrumental.length).toBeGreaterThan(0);
    expect(result.masterBpm).toBe(142);
  });

  it('applies independent gain/mute/solo without creating separate transport clocks', async () => {
    const audio = fakeAudioContext();
    const runtime = createRouletteAudioRuntime({
      getAudioContext: () => audio.context,
      decodedCache: new DecodedAudioCache<AudioBuffer>(4),
      loadTrack: async (id) => track(id),
      loadBeatGrid: async (id) => grid(id, 0),
      loadPhrases: async () => [],
      loadVocalAnalysis: async () => null,
      stemAssets: {
        resolveReady: async (id, type) => ({
          asset: asset(id, type),
          source: { kind: 'url' as const, url: `dropdex://stem/${id}`, size: 1200, mtimeMs: 100 },
        }),
      },
      loadDecodedSources: vi.fn(async () => [buffer(60), buffer(60)]),
    });

    await runtime.play({
      vocal: selection('vocal-a', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    }, mix);
    runtime.setMix({
      vocal: { gain: 0.9, muted: false, solo: true },
      instrumental: { gain: 0.7, muted: false, solo: false },
    });

    expect(audio.gains).toHaveLength(3);
    expect(audio.gains[0].gain.value).toBeCloseTo(0.707, 8);
    expect(audio.gains[1].gain.value).toBeCloseTo(0.9, 8);
    expect(audio.gains[2].gain.value).toBe(0);
  });

  it('cancels a pending decode and never schedules a partial pair', async () => {
    const audio = fakeAudioContext();
    let resolveDecode!: (value: AudioBuffer[]) => void;
    const decodePromise = new Promise<AudioBuffer[]>((resolve) => { resolveDecode = resolve; });
    const runtime = createRouletteAudioRuntime({
      getAudioContext: () => audio.context,
      decodedCache: new DecodedAudioCache<AudioBuffer>(4),
      loadTrack: async (id) => track(id),
      loadBeatGrid: async (id) => grid(id, 0),
      loadPhrases: async () => [],
      loadVocalAnalysis: async () => null,
      stemAssets: {
        resolveReady: async (id, type) => ({
          asset: asset(id, type),
          source: { kind: 'url' as const, url: `dropdex://stem/${id}`, size: 1200, mtimeMs: 100 },
        }),
      },
      loadDecodedSources: vi.fn(async () => decodePromise),
    });

    const pending = runtime.play({
      vocal: selection('vocal-a', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    }, mix);
    await Promise.resolve();
    runtime.stop();
    resolveDecode([buffer(60), buffer(60)]);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(audio.sources).toHaveLength(0);
  });

  it('fails rather than substituting full-mix audio when a ready stem cannot resolve', async () => {
    const audio = fakeAudioContext();
    const runtime = createRouletteAudioRuntime({
      getAudioContext: () => audio.context,
      decodedCache: new DecodedAudioCache<AudioBuffer>(4),
      loadTrack: async (id) => track(id),
      loadBeatGrid: async (id) => grid(id, 0),
      loadPhrases: async () => [],
      loadVocalAnalysis: async () => null,
      stemAssets: { resolveReady: async () => null },
      loadDecodedSources: vi.fn(async () => [buffer(60), buffer(60)]),
    });

    await expect(runtime.play({
      vocal: selection('vocal-a', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    }, mix)).rejects.toThrow(/missing or no longer ready/);
    expect(audio.sources).toHaveLength(0);
  });

  it('routes a 140 BPM vocal through pitch-locked preparation against a 142 BPM instrumental master', async () => {
    const audio = fakeAudioContext();
    const prepare = vi.fn(async ({ sourceDurationSeconds, tempoRatio }: { sourceDurationSeconds: number; tempoRatio: number }) => (
      buffer(sourceDurationSeconds / tempoRatio)
    ));
    const cancel = vi.fn();
    const dispose = vi.fn();
    const runtime = createRouletteAudioRuntime({
      getAudioContext: () => audio.context,
      decodedCache: new DecodedAudioCache<AudioBuffer>(4),
      stretchedCache: new DecodedAudioCache<AudioBuffer>(4),
      createTempoProcessor: () => ({ prepare, cancel, dispose }),
      loadTrack: async (id) => track(id, id === 'vocal-a' ? 140 : 142),
      loadBeatGrid: async (id) => grid(id, 0),
      loadPhrases: async () => [],
      loadVocalAnalysis: async () => null,
      stemAssets: {
        resolveReady: async (id, type) => ({
          asset: asset(id, type),
          source: { kind: 'url' as const, url: `dropdex://stem/${id}`, size: 1200, mtimeMs: 100 },
        }),
      },
      loadDecodedSources: vi.fn(async () => [buffer(60), buffer(60)]),
    });

    const result = await runtime.play({
      vocal: selection('vocal-a', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    }, mix);

    expect(result.masterBpm).toBe(142);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0][0].tempoRatio).toBeCloseTo(142 / 140, 10);
    expect(audio.sources).toHaveLength(2);
    expect(audio.sources[0].starts[0].when).toBe(audio.sources[1].starts[0].when);
    expect(audio.sources[0].starts[0].offset).toBe(0);
    expect(audio.sources[1].starts[0].offset).toBe(0);
    expect(audio.sources[0].starts[0].duration).toBeCloseTo(result.durationSeconds, 8);
    expect(audio.sources[1].starts[0].duration).toBeCloseTo(result.durationSeconds, 8);
  });

  it('prepares a fresh ratio when the non-master vocal source is replaced', async () => {
    const audio = fakeAudioContext();
    const prepare = vi.fn(async ({ sourceDurationSeconds, tempoRatio }: { sourceDurationSeconds: number; tempoRatio: number }) => (
      buffer(sourceDurationSeconds / tempoRatio)
    ));
    const runtime = createRouletteAudioRuntime({
      getAudioContext: () => audio.context,
      decodedCache: new DecodedAudioCache<AudioBuffer>(4),
      stretchedCache: new DecodedAudioCache<AudioBuffer>(4),
      createTempoProcessor: () => ({ prepare, cancel: vi.fn(), dispose: vi.fn() }),
      loadTrack: async (id) => track(id, id === 'vocal-a' ? 140 : id === 'vocal-b' ? 141 : 142),
      loadBeatGrid: async (id) => grid(id, 0),
      loadPhrases: async () => [],
      loadVocalAnalysis: async () => null,
      stemAssets: {
        resolveReady: async (id, type) => ({
          asset: asset(id, type),
          source: { kind: 'url' as const, url: `dropdex://stem/${id}`, size: 1200, mtimeMs: 100 },
        }),
      },
      loadDecodedSources: vi.fn(async () => [buffer(60), buffer(60)]),
    });

    await runtime.play({
      vocal: selection('vocal-a', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    }, mix);
    await runtime.play({
      vocal: selection('vocal-b', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    }, mix);

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[0][0].tempoRatio).toBeCloseTo(142 / 140, 10);
    expect(prepare.mock.calls[1][0].tempoRatio).toBeCloseTo(142 / 141, 10);
  });

  it('keeps exact-BPM playback on the no-processing path', async () => {
    const audio = fakeAudioContext();
    const prepare = vi.fn(async () => buffer(10));
    const runtime = createRouletteAudioRuntime({
      getAudioContext: () => audio.context,
      decodedCache: new DecodedAudioCache<AudioBuffer>(4),
      stretchedCache: new DecodedAudioCache<AudioBuffer>(4),
      createTempoProcessor: () => ({ prepare, cancel: vi.fn(), dispose: vi.fn() }),
      loadTrack: async (id) => track(id, 142),
      loadBeatGrid: async (id) => grid(id, 0),
      loadPhrases: async () => [],
      loadVocalAnalysis: async () => null,
      stemAssets: {
        resolveReady: async (id, type) => ({
          asset: asset(id, type),
          source: { kind: 'url' as const, url: `dropdex://stem/${id}`, size: 1200, mtimeMs: 100 },
        }),
      },
      loadDecodedSources: vi.fn(async () => [buffer(60), buffer(60)]),
    });

    await runtime.play({
      vocal: selection('vocal-a', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    }, mix);

    expect(prepare).not.toHaveBeenCalled();
  });

  it('fails atomically when pitch-locked processor initialization fails', async () => {
    const audio = fakeAudioContext();
    const runtime = createRouletteAudioRuntime({
      getAudioContext: () => audio.context,
      decodedCache: new DecodedAudioCache<AudioBuffer>(4),
      stretchedCache: new DecodedAudioCache<AudioBuffer>(4),
      createTempoProcessor: () => ({
        prepare: vi.fn(async () => { throw new Error('processor init failed'); }),
        cancel: vi.fn(),
        dispose: vi.fn(),
      }),
      loadTrack: async (id) => track(id, id === 'vocal-a' ? 140 : 142),
      loadBeatGrid: async (id) => grid(id, 0),
      loadPhrases: async () => [],
      loadVocalAnalysis: async () => null,
      stemAssets: {
        resolveReady: async (id, type) => ({
          asset: asset(id, type),
          source: { kind: 'url' as const, url: `dropdex://stem/${id}`, size: 1200, mtimeMs: 100 },
        }),
      },
      loadDecodedSources: vi.fn(async () => [buffer(60), buffer(60)]),
    });

    await expect(runtime.play({
      vocal: selection('vocal-a', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    }, mix)).rejects.toThrow(/processor init failed/);
    expect(audio.sources).toHaveLength(0);
  });

  it('cancels in-flight pitch-locked preparation on stop and never schedules stale audio', async () => {
    const audio = fakeAudioContext();
    const cancel = vi.fn();
    const prepare = vi.fn(({ signal }: { signal?: AbortSignal }) => new Promise<AudioBuffer>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    }));
    const runtime = createRouletteAudioRuntime({
      getAudioContext: () => audio.context,
      decodedCache: new DecodedAudioCache<AudioBuffer>(4),
      stretchedCache: new DecodedAudioCache<AudioBuffer>(4),
      createTempoProcessor: () => ({ prepare, cancel, dispose: vi.fn() }),
      loadTrack: async (id) => track(id, id === 'vocal-a' ? 140 : 142),
      loadBeatGrid: async (id) => grid(id, 0),
      loadPhrases: async () => [],
      loadVocalAnalysis: async () => null,
      stemAssets: {
        resolveReady: async (id, type) => ({
          asset: asset(id, type),
          source: { kind: 'url' as const, url: `dropdex://stem/${id}`, size: 1200, mtimeMs: 100 },
        }),
      },
      loadDecodedSources: vi.fn(async () => [buffer(60), buffer(60)]),
    });

    const pending = runtime.play({
      vocal: selection('vocal-a', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    }, mix);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    runtime.stop();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalled();
    expect(audio.sources).toHaveLength(0);
  });


  it('refuses variable-tempo grids before scheduling or pitch-locked DSP', async () => {
    const audio = fakeAudioContext();
    const prepare = vi.fn(async () => buffer(30));
    const runtime = createRouletteAudioRuntime({
      getAudioContext: () => audio.context,
      decodedCache: new DecodedAudioCache<AudioBuffer>(4),
      stretchedCache: new DecodedAudioCache<AudioBuffer>(4),
      createTempoProcessor: () => ({ prepare, cancel: vi.fn(), dispose: vi.fn() }),
      loadTrack: async (id) => track(id, id === 'vocal-a' ? 140 : 142),
      loadBeatGrid: async (id) => {
        const beatGrid = grid(id, 0);
        if (id === 'vocal-a') beatGrid.is_variable_tempo = true;
        return beatGrid;
      },
      loadPhrases: async () => [],
      loadVocalAnalysis: async () => null,
      stemAssets: {
        resolveReady: async (id, type) => ({
          asset: asset(id, type),
          source: { kind: 'url' as const, url: `dropdex://stem/${id}`, size: 1200, mtimeMs: 100 },
        }),
      },
      loadDecodedSources: vi.fn(async () => [buffer(60), buffer(60)]),
    });

    await expect(runtime.play({
      vocal: selection('vocal-a', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    }, mix)).rejects.toThrow(/variable-tempo beat grids/);
    expect(prepare).not.toHaveBeenCalled();
    expect(audio.sources).toHaveLength(0);
  });

  it('routes the summed decks through conservative headroom and a limiter', async () => {
    const audio = fakeAudioContext();
    const runtime = createRouletteAudioRuntime({
      getAudioContext: () => audio.context,
      decodedCache: new DecodedAudioCache<AudioBuffer>(4),
      loadTrack: async (id) => track(id),
      loadBeatGrid: async (id) => grid(id, 0),
      loadPhrases: async () => [],
      loadVocalAnalysis: async () => null,
      stemAssets: {
        resolveReady: async (id, type) => ({
          asset: asset(id, type),
          source: { kind: 'url' as const, url: `dropdex://stem/${id}`, size: 1200, mtimeMs: 100 },
        }),
      },
      loadDecodedSources: vi.fn(async () => [buffer(60), buffer(60)]),
    });

    await runtime.play({
      vocal: selection('vocal-a', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    }, mix);

    expect(audio.gains[0].gain.value).toBeCloseTo(0.707, 8);
    expect(audio.compressors).toHaveLength(1);
    expect(audio.gains[0].connectedTo).toBe(audio.compressors[0]);
    expect(audio.compressors[0].threshold.value).toBe(-1);
    expect(audio.compressors[0].ratio.value).toBe(20);
  });

  it('preflights candidate media, anchors, and tempo processing without leaving scheduled audio active', async () => {
    const audio = fakeAudioContext();
    const prepare = vi.fn(async ({ sourceDurationSeconds, tempoRatio }: { sourceDurationSeconds: number; tempoRatio: number }) => (
      buffer(sourceDurationSeconds / tempoRatio)
    ));
    const runtime = createRouletteAudioRuntime({
      getAudioContext: () => audio.context,
      decodedCache: new DecodedAudioCache<AudioBuffer>(4),
      stretchedCache: new DecodedAudioCache<AudioBuffer>(4),
      createTempoProcessor: () => ({ prepare, cancel: vi.fn(), dispose: vi.fn() }),
      loadTrack: async (id) => track(id, id === 'vocal-a' ? 140 : 142),
      loadBeatGrid: async (id) => grid(id, 0),
      loadPhrases: async () => [],
      loadVocalAnalysis: async () => null,
      stemAssets: {
        resolveReady: async (id, type) => ({
          asset: asset(id, type),
          source: { kind: 'url' as const, url: `dropdex://stem/${id}`, size: 1200, mtimeMs: 100 },
        }),
      },
      loadDecodedSources: vi.fn(async () => [buffer(60), buffer(60)]),
    });

    await runtime.prepare({
      vocal: selection('vocal-a', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    });

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(audio.sources).toHaveLength(2);
    expect(audio.sources.every((source) => source.stops.length > 0 && source.disconnected)).toBe(true);
    expect(audio.gains.every((gain) => gain.disconnected)).toBe(true);
    expect(audio.compressors.every((compressor) => compressor.disconnected)).toBe(true);
    expect(runtime.getDurationSeconds()).toBe(0);
  });

});
