import { describe, expect, it, vi } from 'vitest';
import { DecodedAudioCache } from '../audio/decodedAudioCache';
import { loadDropLabDecodedPair, type DropLabAudioResolver } from './dropLabPreviewAudio';

function fakeBuffer(id: string): AudioBuffer {
  return { id } as unknown as AudioBuffer;
}

function fakeContext() {
  let index = 0;
  return {
    decodeAudioData: vi.fn(async () => fakeBuffer(`decoded-${++index}`)),
  } as unknown as AudioContext;
}

describe('Drop Lab production audio adapter', () => {
  it('loads the real source/candidate pair through the shared decode cache boundary', async () => {
    const cache = new DecodedAudioCache<AudioBuffer>(8);
    const context = fakeContext();
    const resolverMock = vi.fn(async (segments: string[]) => ({
      ok: true as const,
      source: {
        kind: 'file' as const,
        file: { arrayBuffer: async () => new TextEncoder().encode(segments.join('/')).buffer },
      },
    }));
    const resolver = resolverMock as DropLabAudioResolver;

    const request = {
      source: { cacheKey: 'source-track', pathSegments: ['Contents', 'source.flac'] },
      candidate: { cacheKey: 'candidate-track', pathSegments: ['Contents', 'candidate.flac'] },
    };
    const dependencies = { cache, resolveSource: resolver, getAudioContext: () => context };

    const first = await loadDropLabDecodedPair(request, dependencies);
    const second = await loadDropLabDecodedPair(request, dependencies);

    expect(first.source).toBeTruthy();
    expect(first.candidate).toBeTruthy();
    expect(second).toEqual(first);
    expect(resolverMock).toHaveBeenCalledTimes(2);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
  });

  it('preserves the existing Drop Lab media failure and cancellation semantics', async () => {
    const cache = new DecodedAudioCache<AudioBuffer>(8);
    const context = fakeContext();
    const missing: DropLabAudioResolver = async () => ({
      ok: false,
      error: { kind: 'not_found', path: 'Contents/missing.flac', message: 'missing' },
    });

    await expect(loadDropLabDecodedPair({
      source: { cacheKey: 'source', pathSegments: ['Contents', 'missing.flac'] },
      candidate: { cacheKey: 'candidate', pathSegments: ['Contents', 'candidate.flac'] },
    }, { cache, resolveSource: missing, getAudioContext: () => context }))
      .rejects.toThrow('Connect the Rekordbox USB drive to preview this transition.');

    const aborted: DropLabAudioResolver = async () => ({
      ok: false,
      error: { kind: 'abort', message: 'cancelled' },
    });
    await expect(loadDropLabDecodedPair({
      source: { cacheKey: 'source-2', pathSegments: ['Contents', 'source.flac'] },
      candidate: { cacheKey: 'candidate-2', pathSegments: ['Contents', 'candidate.flac'] },
    }, { cache, resolveSource: aborted, getAudioContext: () => context }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
