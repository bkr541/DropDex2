export type UploadBatchQueueState =
  | 'queued'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled-before-start'
  | 'cancelled-active';

export interface UploadBatchQueueEntry {
  index: number;
  state: UploadBatchQueueState;
}

export interface UploadQueueSnapshot {
  entries: UploadBatchQueueEntry[];
  activeRequests: number;
  queuedBatches: number;
  locallyAborted: boolean;
}

export class UploadQueueRuntime {
  private readonly states: UploadBatchQueueState[];
  private _activeRequests = 0;
  private _locallyAborted = false;

  constructor(batchCount: number) {
    this.states = Array.from({ length: batchCount }, () => 'queued' as const);
  }

  get locallyAborted(): boolean {
    return this._locallyAborted;
  }

  get activeRequests(): number {
    return this._activeRequests;
  }

  get queuedBatches(): number {
    return this.states.filter((state) => state === 'queued').length;
  }

  canSchedule(signal: AbortSignal): boolean {
    return !this._locallyAborted && !signal.aborted;
  }

  abortScheduling(): void {
    this._locallyAborted = true;
    for (let index = 0; index < this.states.length; index += 1) {
      if (this.states[index] === 'queued') this.states[index] = 'cancelled-before-start';
    }
  }

  markActive(index: number): void {
    this.states[index] = 'active';
    this._activeRequests += 1;
  }

  markSettled(index: number, state: Extract<UploadBatchQueueState, 'completed' | 'failed' | 'cancelled-active'>): void {
    if (this.states[index] === 'active') this._activeRequests = Math.max(0, this._activeRequests - 1);
    this.states[index] = state;
  }

  snapshot(): UploadQueueSnapshot {
    return {
      entries: this.states.map((state, index) => ({ index, state })),
      activeRequests: this._activeRequests,
      queuedBatches: this.queuedBatches,
      locallyAborted: this._locallyAborted,
    };
  }
}

export interface CancellableUploadQueueOptions<TBatch, TResult> {
  batches: TBatch[];
  maxConcurrent: number;
  signal: AbortSignal;
  runtime?: UploadQueueRuntime;
  isLocallyAborted: () => boolean;
  runBatch: (batch: TBatch, index: number) => Promise<TResult>;
  isFailedResult?: (result: TResult) => boolean;
  onBatchSuccess?: (result: TResult, batch: TBatch, index: number) => void;
  onBatchFailure?: (error: unknown, batch: TBatch, index: number) => void;
  isAbortError: (error: unknown) => boolean;
}

export interface CancellableUploadQueueResult<TResult> {
  results: Array<TResult | undefined>;
  snapshot: UploadQueueSnapshot;
  cancelled: boolean;
}

/**
 * Runs a bounded upload queue whose scheduler has two independent stop gates:
 * the caller-owned local aborted flag and AbortSignal. Queued work is marked
 * cancelled-before-start and is never counted as completed.
 */
export function runCancellableUploadQueue<TBatch, TResult>(
  options: CancellableUploadQueueOptions<TBatch, TResult>,
): Promise<CancellableUploadQueueResult<TResult>> {
  const runtime = options.runtime ?? new UploadQueueRuntime(options.batches.length);
  const results: Array<TResult | undefined> = Array.from({ length: options.batches.length });
  let nextIndex = 0;
  let resolved = false;

  return new Promise((resolve) => {
    const isCancelled = () => options.isLocallyAborted() || !runtime.canSchedule(options.signal);

    const finishIfReady = () => {
      if (resolved) return;
      if (isCancelled()) runtime.abortScheduling();
      const snapshot = runtime.snapshot();
      const hasQueued = snapshot.queuedBatches > 0;
      if (snapshot.activeRequests > 0 || hasQueued) return;
      resolved = true;
      options.signal.removeEventListener('abort', handleAbort);
      resolve({ results, snapshot, cancelled: snapshot.locallyAborted || options.signal.aborted });
    };

    const schedule = () => {
      if (resolved) return;
      if (isCancelled()) {
        runtime.abortScheduling();
        finishIfReady();
        return;
      }

      while (
        runtime.activeRequests < Math.max(1, options.maxConcurrent)
        && nextIndex < options.batches.length
      ) {
        if (isCancelled()) {
          runtime.abortScheduling();
          break;
        }

        const index = nextIndex;
        nextIndex += 1;

        // Re-check immediately before invoking runBatch. This is the final gate
        // preventing a batch from starting after a same-tick cancellation.
        if (isCancelled()) {
          runtime.abortScheduling();
          break;
        }

        const batch = options.batches[index];
        runtime.markActive(index);

        let batchPromise: Promise<TResult>;
        try {
          batchPromise = options.runBatch(batch, index);
        } catch (error) {
          const cancelled = options.isAbortError(error) || isCancelled();
          runtime.markSettled(index, cancelled ? 'cancelled-active' : 'failed');
          if (!cancelled) options.onBatchFailure?.(error, batch, index);
          if (isCancelled()) runtime.abortScheduling();
          continue;
        }

        void batchPromise
          .then((result) => {
            results[index] = result;
            const failed = options.isFailedResult?.(result) ?? false;
            runtime.markSettled(index, failed ? 'failed' : 'completed');
            if (failed) options.onBatchFailure?.(new Error('Upload batch returned a failed result.'), batch, index);
            else options.onBatchSuccess?.(result, batch, index);
          })
          .catch((error: unknown) => {
            const cancelled = options.isAbortError(error) || isCancelled();
            runtime.markSettled(index, cancelled ? 'cancelled-active' : 'failed');
            if (!cancelled) options.onBatchFailure?.(error, batch, index);
          })
          .finally(() => {
            // Never recursively schedule after either cancellation gate closes.
            if (isCancelled()) runtime.abortScheduling();
            else schedule();
            finishIfReady();
          });
      }

      finishIfReady();
    };

    const handleAbort = () => {
      runtime.abortScheduling();
      finishIfReady();
    };

    options.signal.addEventListener('abort', handleAbort, { once: true });

    if (options.batches.length === 0) {
      finishIfReady();
      return;
    }

    schedule();
  });
}
