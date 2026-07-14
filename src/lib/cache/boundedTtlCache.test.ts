import { describe, expect, it } from 'vitest';
import { BoundedTtlCache } from './boundedTtlCache';

describe('BoundedTtlCache', () => {
  it('expires entries without refreshing TTL on reads', () => {
    let now = 0;
    const cache = new BoundedTtlCache<string, number>({
      maxEntries: 2,
      ttlMs: 100,
      now: () => now,
    });
    cache.set('a', 1);
    now = 99;
    expect(cache.get('a')).toBe(1);
    now = 100;
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts the least recently used entry', () => {
    const cache = new BoundedTtlCache<string, number>({
      maxEntries: 2,
      ttlMs: 1_000,
    });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.peek('b')).toBeUndefined();
    expect(cache.peek('a')).toBe(1);
    expect(cache.peek('c')).toBe(3);
  });

  it('supports shorter TTLs for negative results and targeted invalidation', () => {
    let now = 0;
    const cache = new BoundedTtlCache<string, string>({
      maxEntries: 5,
      ttlMs: 1_000,
      now: () => now,
    });
    cache.set('loaded', 'yes');
    cache.set('missing', 'no', 25);
    expect(cache.deleteWhere((key) => key === 'loaded')).toBe(1);
    now = 25;
    expect(cache.peek('missing')).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
