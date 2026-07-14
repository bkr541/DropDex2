export interface BoundedTtlCacheOptions {
  maxEntries: number;
  ttlMs: number;
  now?: () => number;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

/**
 * Small in-memory LRU cache with per-entry expiration.
 *
 * Reading an entry refreshes its LRU position but not its expiration time. This
 * prevents a permanently mounted view from keeping stale Rekordbox analysis
 * alive forever while still bounding memory across long browsing sessions.
 */
export class BoundedTtlCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor({ maxEntries, ttlMs, now = Date.now }: BoundedTtlCacheOptions) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error('BoundedTtlCache maxEntries must be a positive integer.');
    }
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new Error('BoundedTtlCache ttlMs must be a non-negative number.');
    }
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get size(): number {
    this.pruneExpired();
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Map insertion order is our LRU order.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  peek(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs = this.ttlMs): void {
    const safeTtl = Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : this.ttlMs;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + safeTtl });
    this.evictOverflow();
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  keys(): K[] {
    this.pruneExpired();
    return [...this.entries.keys()];
  }

  entriesSnapshot(): Array<[K, V]> {
    this.pruneExpired();
    return [...this.entries.entries()].map(([key, entry]) => [
      key,
      entry.value,
    ]);
  }

  deleteWhere(predicate: (key: K, value: V) => boolean): number {
    let deleted = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= this.now() || predicate(key, entry.value)) {
        this.entries.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private evictOverflow(): void {
    this.pruneExpired();
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }
}
