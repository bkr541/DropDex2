import { describe, expect, it, vi } from 'vitest';
import { DecodedAudioCache } from './decodedAudioCache';

describe('DecodedAudioCache', () => {
  it('bounds entries and refreshes reads using least-recently-used eviction', () => {
    const cache = new DecodedAudioCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('coalesces concurrent decoding for the same cache key', async () => {
    const cache = new DecodedAudioCache<number>(2);
    const loader = vi.fn(async () => 42);

    const [first, second] = await Promise.all([
      cache.getOrCreate('same', loader),
      cache.getOrCreate('same', loader),
    ]);

    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('does not repopulate a cache after lifecycle cleanup while a load is in flight', async () => {
    const cache = new DecodedAudioCache<number>(2);
    let finish!: (value: number) => void;
    const pending = cache.getOrCreate('late', () => new Promise<number>((resolve) => { finish = resolve; }));

    cache.clear();
    finish(7);

    await expect(pending).resolves.toBe(7);
    expect(cache.size).toBe(0);
    expect(cache.get('late')).toBeUndefined();
  });

  it('evicts least-recently-used values to stay within a byte budget', () => {
    const cache = new DecodedAudioCache<{ bytes: number; id: string }>(10, {
      maxBytes: 10,
      sizeOf: (value) => value.bytes,
    });
    cache.set('a', { id: 'a', bytes: 4 });
    cache.set('b', { id: 'b', bytes: 4 });
    expect(cache.get('a')?.id).toBe('a');
    cache.set('c', { id: 'c', bytes: 4 });

    expect(cache.byteSize).toBe(8);
    expect(cache.get('a')?.id).toBe('a');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')?.id).toBe('c');
  });

  it('returns but does not retain one decoded value larger than the byte budget', async () => {
    const cache = new DecodedAudioCache<{ bytes: number }>(4, {
      maxBytes: 8,
      sizeOf: (value) => value.bytes,
    });

    await expect(cache.getOrCreate('oversized', async () => ({ bytes: 12 }))).resolves.toEqual({ bytes: 12 });
    expect(cache.size).toBe(0);
    expect(cache.byteSize).toBe(0);
  });

});
