import { describe, expect, it, vi } from 'vitest';
import {
  createCloudParsingContext,
  IdempotentUsbCleanup,
  verifyUsbReleased,
} from './localUsbLifecycle';

describe('local USB release lifecycle', () => {
  it('runs cleanup once logically even when several teardown paths race', () => {
    const cleanup = new IdempotentUsbCleanup();
    const action = vi.fn();

    expect(cleanup.run(action)).toBe(true);
    expect(cleanup.run(action)).toBe(false);
    expect(cleanup.run(action)).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
    expect(cleanup.logicalRuns).toBe(1);
  });

  it('does not verify release while any request, retry, queue, controller, File, or handle remains', () => {
    const verification = verifyUsbReleased({
      activeUploadRequests: 1,
      queuedBatches: 2,
      retryTimerCount: 1,
      controllerActive: true,
      databaseFileCount: 1,
      analysisFileCount: 4,
      matchedFileCount: 3,
      batchFileCount: 3,
      pathMapCount: 2,
      objectUrlCount: 1,
      directoryHandleCount: 1,
    });

    expect(verification.released).toBe(false);
    expect(verification.blockers).toHaveLength(11);
  });

  it('verifies release only after every local resource is gone', () => {
    expect(verifyUsbReleased({
      activeUploadRequests: 0,
      queuedBatches: 0,
      retryTimerCount: 0,
      controllerActive: false,
      databaseFileCount: 0,
      analysisFileCount: 0,
      matchedFileCount: 0,
      batchFileCount: 0,
      pathMapCount: 0,
      objectUrlCount: 0,
      directoryHandleCount: 0,
    })).toEqual({ released: true, blockers: [] });
  });

  it('creates an ID-only cloud parsing context with no File-bearing manifest', () => {
    const context = createCloudParsingContext('import-123', 42);
    expect(context).toEqual({ importId: 'import-123', expectedTrackCount: 42 });
    expect(Object.keys(context)).toEqual(['importId', 'expectedTrackCount']);
  });
});
