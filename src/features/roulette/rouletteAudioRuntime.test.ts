import { describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { BeatGridRow } from '../../lib/queries/analysisData';
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

function fakeAudioContext() {
  const sources: FakeSourceNode[] = [];
  const gains: FakeGainNode[] = [];
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
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as AudioContext;
  return { context, sources, gains };
}

function track(id: string, bpm = 142): RekordboxTrack {
  return { id, bpm, title: id } as RekordboxTrack;
}

function grid(trackId: string, downbeatMs: number): BeatGridRow {
  return {
    id: `grid-${trackId}`,
    import_id: 'import-1',
    track_id: trackId,
    source_tag: 'PQTZ',
    beats: [
      { seq: 1, srcIdx: 1, beatInBar: 1, bar: 1, ms: downbeatMs, bpm: 142, isDownbeat: true },
      { seq: 2, srcIdx: 2, beatInBar: 2, bar: 1, ms: downbeatMs + 422, bpm: 142, isDownbeat: false },
    ],
    beat_count: 2,
    downbeat_count: 1,
    bar_count: 1,
    first_beat_ms: downbeatMs,
    first_downbeat_ms: downbeatMs,
    minimum_bpm: 142,
    maximum_bpm: 142,
    is_variable_tempo: false,
    parser_version: 'test',
  };
}

function asset(trackId: string, type: 'vocals' | 'instrumental'): StemAssetRecord {
  return {
    id: `${trackId}-${type}`,
    track_id: trackId,
    stem_type: type,
    status: 'ready',
    storage_locator: `${trackId}/${type}.wav`,
    source_fingerprint: `fingerprint-${trackId}`,
    separator_version: 'separator-v1',
    contract_version: STEM_ASSET_CONTRACT_VERSION,
    duration_ms: 12000,
    sample_rate_hz: 100,
    channel_count: 1,
    file_size_bytes: 1200,
    file_mtime_ms: 100,
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
  it('schedules two ready stems concurrently from one AudioContext clock with independent source offsets', async () => {
    const audio = fakeAudioContext();
    const loadDecodedSources = vi.fn(async () => [buffer(12), buffer(12)]);
    const runtime = createRouletteAudioRuntime({
      getAudioContext: () => audio.context,
      decodedCache: new DecodedAudioCache<AudioBuffer>(4),
      loadTrack: async (id) => track(id),
      loadBeatGrid: async (id) => grid(id, id === 'vocal-a' ? 1000 : 2500),
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
    expect(audio.sources[0].starts[0].duration).toBeCloseTo(9.5, 8);
    expect(audio.sources[1].starts[0].duration).toBeCloseTo(9.5, 8);
    expect(result.durationSeconds).toBeCloseTo(9.5, 8);
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
      stemAssets: {
        resolveReady: async (id, type) => ({
          asset: asset(id, type),
          source: { kind: 'url' as const, url: `dropdex://stem/${id}`, size: 1200, mtimeMs: 100 },
        }),
      },
      loadDecodedSources: vi.fn(async () => [buffer(8), buffer(8)]),
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
    expect(audio.gains[0].gain.value).toBeCloseTo(0.72, 8);
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
    resolveDecode([buffer(8), buffer(8)]);

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
      stemAssets: { resolveReady: async () => null },
      loadDecodedSources: vi.fn(async () => [buffer(8), buffer(8)]),
    });

    await expect(runtime.play({
      vocal: selection('vocal-a', 'vocals'),
      instrumental: selection('instrumental-a', 'instrumental'),
    }, mix)).rejects.toThrow(/missing or no longer ready/);
    expect(audio.sources).toHaveLength(0);
  });
});
