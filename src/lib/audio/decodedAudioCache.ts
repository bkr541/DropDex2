export interface DecodedAudioCacheOptions<T> {
  /** Optional memory budget. Values larger than the budget are returned but not cached. */
  maxBytes?: number;
  /** Required when maxBytes is provided. Must return a finite, non-negative byte estimate. */
  sizeOf?: (value: T) => number;
}

/**
 * Bounded LRU cache for expensive decoded-audio results.
 *
 * The cache coalesces concurrent loads for the same key and never lets a load
 * that finishes after clear/delete repopulate stale data. Runtime audio objects
 * remain memory-only and callers decide the stable cache key. A byte budget can
 * be supplied for AudioBuffer-like values so long sessions are bounded by real
 * decoded PCM footprint rather than entry count alone.
 */
export class DecodedAudioCache<T> {
  private readonly values = new Map<string, T>();
  private readonly valueBytes = new Map<string, number>();
  private readonly pending = new Map<string, Promise<T>>();
  private generation = 0;
  private currentBytes = 0;
  private readonly maxBytes: number | null;
  private readonly sizeOf: ((value: T) => number) | null;

  constructor(
    private readonly maxEntries: number,
    options: DecodedAudioCacheOptions<T> = {},
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error('DecodedAudioCache maxEntries must be a positive integer.');
    }
    if (options.maxBytes != null) {
      if (!Number.isFinite(options.maxBytes) || options.maxBytes <= 0) {
        throw new Error('DecodedAudioCache maxBytes must be a positive finite number.');
      }
      if (!options.sizeOf) {
        throw new Error('DecodedAudioCache sizeOf is required when maxBytes is configured.');
      }
      this.maxBytes = options.maxBytes;
      this.sizeOf = options.sizeOf;
    } else {
      this.maxBytes = null;
      this.sizeOf = null;
    }
  }

  get size(): number {
    return this.values.size;
  }

  get byteSize(): number {
    return this.currentBytes;
  }

  get(key: string): T | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;

    // Refresh insertion order so eviction is least-recently-used.
    this.values.delete(key);
    this.values.set(key, value);
    const bytes = this.valueBytes.get(key);
    if (bytes != null) {
      this.valueBytes.delete(key);
      this.valueBytes.set(key, bytes);
    }
    return value;
  }

  set(key: string, value: T): void {
    this.removeValue(key);
    const bytes = this.estimateBytes(value);
    if (this.maxBytes != null && bytes > this.maxBytes) return;

    this.values.set(key, value);
    this.valueBytes.set(key, bytes);
    this.currentBytes += bytes;
    this.evictToBudget();
  }

  delete(key: string): void {
    this.generation += 1;
    this.removeValue(key);
    this.pending.delete(key);
  }

  clear(): void {
    this.generation += 1;
    this.values.clear();
    this.valueBytes.clear();
    this.currentBytes = 0;
    this.pending.clear();
  }

  async getOrCreate(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const generation = this.generation;
    const promise = loader().then(
      (value) => {
        if (this.pending.get(key) === promise) {
          this.pending.delete(key);
          if (this.generation === generation) this.set(key, value);
        }
        return value;
      },
      (error: unknown) => {
        if (this.pending.get(key) === promise) this.pending.delete(key);
        throw error;
      },
    );
    this.pending.set(key, promise);
    return promise;
  }

  private estimateBytes(value: T): number {
    if (!this.sizeOf) return 0;
    const bytes = this.sizeOf(value);
    if (!Number.isFinite(bytes) || bytes < 0) {
      throw new Error('DecodedAudioCache sizeOf must return a finite, non-negative number.');
    }
    return bytes;
  }

  private removeValue(key: string): void {
    if (!this.values.delete(key)) return;
    const bytes = this.valueBytes.get(key) ?? 0;
    this.valueBytes.delete(key);
    this.currentBytes = Math.max(0, this.currentBytes - bytes);
  }

  private evictToBudget(): void {
    while (
      this.values.size > this.maxEntries
      || (this.maxBytes != null && this.currentBytes > this.maxBytes)
    ) {
      const oldestKey = this.values.keys().next().value as string | undefined;
      if (oldestKey == null) break;
      this.removeValue(oldestKey);
    }
  }
}
