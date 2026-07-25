import { describe, expect, it, vi } from 'vitest';
import { isAbortError } from './uploadBatch';
import { runCancellableUploadQueue, UploadQueueRuntime } from './cancellableUploadQueue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
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
});
