import { describe, expect, it, vi } from 'vitest';
import { DecodedAudioCache } from './decodedAudioCache';
import { loadDecodedAudioSources } from './audioSourceLoader';

function buffer(id: string): AudioBuffer {
  return { id } as unknown as AudioBuffer;
}

describe('loadDecodedAudioSources', () => {
  it('decodes file and URL media through the same reusable boundary', async () => {
    const cache = new DecodedAudioCache<AudioBuffer>(4);
    const decodeAudioData = vi.fn(async (bytes: ArrayBuffer) => buffer(`bytes-${bytes.byteLength}`));
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    } as Response));

    const decoded = await loadDecodedAudioSources([
      { cacheKey: 'file', pathSegments: ['file'] },
      { cacheKey: 'url', pathSegments: ['url'] },
    ], {
      cache,
      getAudioContext: () => ({ decodeAudioData } as unknown as AudioContext),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveSource: async (segments) => segments[0] === 'file'
        ? {
            ok: true,
            source: { kind: 'file', file: { arrayBuffer: async () => new Uint8Array([1, 2]).buffer } },
          }
        : { ok: true, source: { kind: 'url', url: 'dropdex://audio/url' } },
    });

    expect(decoded).toHaveLength(2);
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(2);
  });

  it('does not cache a decode that completes after cancellation', async () => {
    const cache = new DecodedAudioCache<AudioBuffer>(4);
    let cancelled = false;
    let finishDecode!: (value: AudioBuffer) => void;
    let markDecodeStarted!: () => void;
    const decodeStarted = new Promise<void>((resolve) => { markDecodeStarted = resolve; });
    const load = loadDecodedAudioSources([
      { cacheKey: 'cancelled', pathSegments: ['file'] },
    ], {
      cache,
      isCancelled: () => cancelled,
      resolveSource: async () => ({
        ok: true,
        source: { kind: 'file', file: { arrayBuffer: async () => new Uint8Array([1]).buffer } },
      }),
      getAudioContext: () => ({
        decodeAudioData: () => {
          markDecodeStarted();
          return new Promise<AudioBuffer>((resolve) => { finishDecode = resolve; });
        },
      } as unknown as AudioContext),
    });

    await decodeStarted;
    cancelled = true;
    finishDecode(buffer('late'));

    await expect(load).rejects.toMatchObject({ name: 'AbortError' });
    expect(cache.get('cancelled')).toBeUndefined();
  });
});
