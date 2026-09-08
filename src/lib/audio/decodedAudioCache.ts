/**
 * Small bounded cache for expensive decoded-audio results.
 *
 * The cache coalesces concurrent loads for the same key and never lets a load
 * that finishes after clear/delete repopulate stale data. Runtime audio objects
 * remain memory-only and callers decide the stable cache key.
 */
export class DecodedAudioCache<T> {
  private readonly values = new Map<string, T>();
  private readonly pending = new Map<string, Promise<T>>();
  private generation = 0;

  constructor(private readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error('DecodedAudioCache maxEntries must be a positive integer.');
    }
  }

  get size(): number {
    return this.values.size;
  }

  get(key: string): T | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;

    // Refresh insertion order so eviction is least-recently-used.
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.maxEntries) {
      const oldestKey = this.values.keys().next().value as string | undefined;
      if (oldestKey == null) break;
      this.values.delete(oldestKey);
    }
  }

  delete(key: string): void {
    this.generation += 1;
    this.values.delete(key);
    this.pending.delete(key);
  }

  clear(): void {
    this.generation += 1;
    this.values.clear();
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
}
