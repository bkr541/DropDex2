import { describe, expect, it, vi } from 'vitest';
import { isAbortError } from './uploadBatch';
import { runCancellableUploadQueue, UploadQueueRuntime } from './cancellableUploadQueue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Drain enough microtask ticks for a resolved gate to propagate through the
// promise chain: runBatch continuation → batchPromise.then → batchPromise.finally
// → schedule() → next runBatch starts.
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('cancellable upload queue', () => {
  it('completes every batch normally without cancellation bookkeeping', async () => {
    const controller = new AbortController();
    const runtime = new UploadQueueRuntime(4);
    const started: number[] = [];

    const result = await runCancellableUploadQueue({
      batches: [0, 1, 2, 3],
      maxConcurrent: 2,
      signal: controller.signal,
      runtime,
      isLocallyAborted: () => runtime.locallyAborted,
      isAbortError,
      runBatch: async (batch) => {
        started.push(batch);
        return batch * 2;
      },
    });

    expect(started.sort((left, right) => left - right)).toEqual([0, 1, 2, 3]);
    expect(result.cancelled).toBe(false);
    expect(result.results).toEqual([0, 2, 4, 6]);
    expect(result.snapshot.entries.every((entry) => entry.state === 'completed')).toBe(true);
  });

  it('aborts active requests and never starts undispatched batches', async () => {
    const controller = new AbortController();
    const runtime = new UploadQueueRuntime(5);
    const gates = [deferred<number>(), deferred<number>()];
    const started: number[] = [];

    const queue = runCancellableUploadQueue({
      batches: [0, 1, 2, 3, 4],
      maxConcurrent: 2,
      signal: controller.signal,
      runtime,
      isLocallyAborted: () => runtime.locallyAborted,
      isAbortError,
      runBatch: async (batch) => {
        started.push(batch);
        return gates[batch].promise;
      },
    });

    await Promise.resolve();
    runtime.abortScheduling();
    controller.abort();
    gates[0].reject(new DOMException('aborted', 'AbortError'));
    gates[1].reject(new DOMException('aborted', 'AbortError'));

    const result = await queue;
    expect(started).toEqual([0, 1]);
    expect(result.snapshot.activeRequests).toBe(0);
    expect(result.snapshot.queuedBatches).toBe(0);
    expect(result.snapshot.entries.map((entry) => entry.state)).toEqual([
      'cancelled-active',
      'cancelled-active',
      'cancelled-before-start',
      'cancelled-before-start',
      'cancelled-before-start',
    ]);
  });

  it('handles a last-batch completion racing with cancel without dispatching more work', async () => {
    const controller = new AbortController();
    const runtime = new UploadQueueRuntime(3);
    const first = deferred<number>();
    const started: number[] = [];

    const queue = runCancellableUploadQueue({
      batches: [0, 1, 2],
      maxConcurrent: 1,
      signal: controller.signal,
      runtime,
      isLocallyAborted: () => runtime.locallyAborted,
      isAbortError,
      runBatch: async (batch) => {
        started.push(batch);
        return first.promise;
      },
    });

    await Promise.resolve();
    runtime.abortScheduling();
    controller.abort();
    first.resolve(1);

    const result = await queue;
    expect(started).toEqual([0]);
    expect(result.snapshot.entries[0].state).toBe('completed');
    expect(result.snapshot.entries.slice(1).every((entry) => entry.state === 'cancelled-before-start')).toBe(true);
  });

  it('keeps failures distinct while other active workers abort', async () => {
    const controller = new AbortController();
    const runtime = new UploadQueueRuntime(4);
    const gates = [deferred<number>(), deferred<number>()];
    const failures = vi.fn();

    const queue = runCancellableUploadQueue({
      batches: [0, 1, 2, 3],
      maxConcurrent: 2,
      signal: controller.signal,
      runtime,
      isLocallyAborted: () => runtime.locallyAborted,
      isAbortError,
      runBatch: (batch) => gates[batch].promise,
      onBatchFailure: failures,
    });

    await Promise.resolve();
    gates[0].reject(new Error('network failed'));
    runtime.abortScheduling();
    controller.abort();
    gates[1].reject(new DOMException('aborted', 'AbortError'));

    const result = await queue;
    expect(result.snapshot.entries[0].state).toBe('failed');
    expect(result.snapshot.entries[1].state).toBe('cancelled-active');
    expect(failures).toHaveBeenCalledTimes(1);
  });

  it('waits only for active workers after cancellation', async () => {
    const controller = new AbortController();
    const runtime = new UploadQueueRuntime(1000);
    const gate = deferred<number>();

    const queue = runCancellableUploadQueue({
      batches: Array.from({ length: 1000 }, (_, index) => index),
      maxConcurrent: 1,
      signal: controller.signal,
      runtime,
      isLocallyAborted: () => runtime.locallyAborted,
      isAbortError,
      runBatch: () => gate.promise,
    });

    await Promise.resolve();
    runtime.abortScheduling();
    controller.abort();
    gate.reject(new DOMException('aborted', 'AbortError'));

    const result = await queue;
    expect(result.snapshot.entries.filter((entry) => entry.state === 'cancelled-before-start')).toHaveLength(999);
  });

  it('never starts more than 2 batches simultaneously (production concurrency ceiling)', async () => {
    // 4 batches, each held open by a deferred promise so we can observe concurrency.
    const controller = new AbortController();
    const runtime = new UploadQueueRuntime(4);
    const gates = [deferred<number>(), deferred<number>(), deferred<number>(), deferred<number>()];
    const active: number[] = [];
    let peakConcurrent = 0;

    const queue = runCancellableUploadQueue({
      batches: [0, 1, 2, 3],
      maxConcurrent: 2,
      signal: controller.signal,
      runtime,
      isLocallyAborted: () => runtime.locallyAborted,
      isAbortError,
      runBatch: async (batch) => {
        active.push(batch);
        peakConcurrent = Math.max(peakConcurrent, active.length);
        const result = await gates[batch].promise;
        active.splice(active.indexOf(batch), 1);
        return result;
      },
    });

    // First tick: exactly 2 batches should start.
    await flush();
    expect(active).toHaveLength(2);
    expect(peakConcurrent).toBe(2);

    // Completing one active batch frees a slot; the 3rd batch starts.
    gates[0].resolve(0);
    await flush();
    expect(active.length).toBeLessThanOrEqual(2);
    expect(active).toContain(2);

    // Completing another batch frees the last slot; the 4th batch starts.
    gates[1].resolve(1);
    await flush();
    expect(active.length).toBeLessThanOrEqual(2);
    expect(active).toContain(3);

    // Settle remaining batches.
    gates[2].resolve(2);
    gates[3].resolve(3);
    const result = await queue;

    expect(peakConcurrent).toBe(2);
    expect(result.cancelled).toBe(false);
    expect(result.snapshot.entries.every((entry) => entry.state === 'completed')).toBe(true);
  });

  it('a failed batch releases its active slot so the next queued batch can start', async () => {
    const controller = new AbortController();
    const runtime = new UploadQueueRuntime(3);
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
    const started: number[] = [];

    const queue = runCancellableUploadQueue({
      batches: [0, 1, 2],
      maxConcurrent: 2,
      signal: controller.signal,
      runtime,
      isLocallyAborted: () => runtime.locallyAborted,
      isAbortError,
      runBatch: async (batch) => {
        started.push(batch);
        return gates[batch].promise;
      },
    });

    // Batches 0 and 1 start; batch 2 is queued.
    await flush();
    expect(started).toEqual([0, 1]);

    // Batch 0 fails with a non-abort error; its slot should be released.
    gates[0].reject(new Error('network failure'));
    await flush();

    // Batch 2 must now start.
    expect(started).toContain(2);

    gates[1].resolve(1);
    gates[2].resolve(2);
    const result = await queue;
    expect(result.snapshot.entries[0].state).toBe('failed');
    expect(result.snapshot.entries[1].state).toBe('completed');
    expect(result.snapshot.entries[2].state).toBe('completed');
  });
});
