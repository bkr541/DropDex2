import type { BatchUploadResponse } from '../api/rekordboxImport';
import { normalizeAnlzPath, buildBatches, type MatchedAnalysisFile } from './analysisPaths';
import { UploadAccumulator } from './analysisUploadResults';
import { runCancellableUploadQueue, UploadQueueRuntime } from './cancellableUploadQueue';
import {
  resolveRequestedAnalysisFilesWithResolver,
  type AnalysisFileRequest,
  type TargetedAnalysisResolution,
  type UsbFileResolver,
} from './usbTargetedDiscovery';


function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export interface TargetedTransferProgress {
  processedRequests: number;
  totalRequests: number;
  matchedFiles: number;
  missingFiles: number;
  confirmedFiles: number;
  confirmedBytes: number;
  rejectedFiles: number;
  errorFiles: number;
}

export interface TargetedAnalysisTransferResult {
  accumulator: UploadAccumulator;
  /** Lowercase canonical paths that existed on the USB during the initial pass. */
  matchedPaths: Set<string>;
  matchedCount: number;
  matchedBytes: number;
  missingCount: number;
  /** Time spent resolving filesystem paths only; upload/retry delay time is excluded. */
  resolutionElapsedMs: number;
}

export interface TargetedAnalysisTransferOptions {
  resolver: UsbFileResolver;
  requests: AnalysisFileRequest[];
  signal: AbortSignal;
  sourceRootName?: string;
  maxFilesPerBatch: number;
  maxBytesPerBatch: number;
  maxConcurrent: number;
  /** Defaults to one full concurrent upload window. */
  resolveWindowSize?: number;
  /** Existing upload helper. `maxAttempts` is 3 initially and 1 for file retries. */
  uploadBatch: (batch: MatchedAnalysisFile[], maxAttempts: number) => Promise<BatchUploadResponse | null>;
  isLocallyAborted?: () => boolean;
  fileRetryDelaysMs?: number[];
  waitForRetryDelay?: (delayMs: number) => Promise<void>;
  onProgress?: (progress: TargetedTransferProgress) => void;
  onRetryingCount?: (count: number) => void;
  onRuntimeChange?: (runtime: UploadQueueRuntime | null) => void;
  /** Called after an exact-path window has resolved and before any files in it are uploaded. */
  onResolutionWindow?: (resolution: TargetedAnalysisResolution) => void;
}

function requestKey(request: AnalysisFileRequest): string {
  return (normalizeAnlzPath(request.canonicalPath) ?? request.canonicalPath).toLowerCase();
}

function throwIfCancelled(signal: AbortSignal, isLocallyAborted: () => boolean): void {
  if (signal.aborted || isLocallyAborted()) {
    throw new DOMException('USB analysis transfer cancelled', 'AbortError');
  }
}

/**
 * Exact-path, bounded-window Rekordbox analysis transfer.
 *
 * Only the current resolve/upload window owns File objects. Completed windows
 * are reduced to path/counter metadata before the next window is resolved.
 * File-level retries re-resolve the exact requested paths instead of retaining
 * File references or rescanning USBANLZ.
 */
export async function runTargetedAnalysisTransfer(
  options: TargetedAnalysisTransferOptions,
): Promise<TargetedAnalysisTransferResult> {
  const {
    resolver,
    requests,
    signal,
    sourceRootName,
    maxFilesPerBatch,
    maxBytesPerBatch,
    maxConcurrent,
    uploadBatch,
  } = options;
  const isLocallyAborted = options.isLocallyAborted ?? (() => false);
  const windowSize = Math.max(
    1,
    options.resolveWindowSize ?? Math.max(1, maxFilesPerBatch) * Math.max(1, maxConcurrent),
  );
  const retryDelays = options.fileRetryDelaysMs ?? [500, 1000];
  const waitForRetryDelay = options.waitForRetryDelay ?? (async (delayMs: number) => {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  });

  const accumulator = new UploadAccumulator();
  const matchedPaths = new Set<string>();
  const requestByPath = new Map<string, AnalysisFileRequest>();
  for (const request of requests) requestByPath.set(requestKey(request), request);

  let processedRequests = 0;
  let matchedCount = 0;
  let matchedBytes = 0;
  let missingCount = 0;
  let resolutionElapsedMs = 0;

  const emitProgress = () => {
    const summary = accumulator.summary;
    options.onProgress?.({
      processedRequests,
      totalRequests: requests.length,
      matchedFiles: matchedCount,
      missingFiles: missingCount,
      confirmedFiles: accumulator.confirmedFiles,
      confirmedBytes: accumulator.confirmedBytes,
      rejectedFiles: summary.rejectedFiles,
      errorFiles: summary.errorFiles,
    });
  };

  const uploadResolvedFiles = async (
    files: MatchedAnalysisFile[],
    retry: boolean,
  ): Promise<void> => {
    if (files.length === 0) return;
    const batches = buildBatches(files, maxFilesPerBatch, maxBytesPerBatch);
    const runtime = new UploadQueueRuntime(batches.length);
    options.onRuntimeChange?.(runtime);

    try {
      const queueResult = await runCancellableUploadQueue<MatchedAnalysisFile[], BatchUploadResponse | null>({
        batches,
        maxConcurrent,
        signal,
        runtime,
        isLocallyAborted,
        isAbortError,
        isFailedResult: (response) => response === null,
        runBatch: (batch) => uploadBatch(batch, retry ? 1 : 3),
        onBatchSuccess: (response, batch) => {
          if (!response) return;
          if (!retry) {
            accumulator.addBatchResponse(response, batch);
          } else {
            for (const fileResult of response.files) {
              if (fileResult.status === 'received' || fileResult.status === 'already_received') {
                accumulator.correctFileRetrySuccess(
                  fileResult.canonical_path,
                  fileResult.status,
                  fileResult.file_size,
                );
              } else {
                accumulator.updateFileRetryFailure(
                  fileResult.canonical_path,
                  fileResult.status,
                  fileResult.reject_reason,
                );
              }
            }
          }
          emitProgress();
        },
        onBatchFailure: (_error, batch) => {
          if (!retry) accumulator.recordFailedBatch(batch);
          emitProgress();
        },
      });

      if (queueResult.cancelled || signal.aborted || isLocallyAborted()) {
        throw new DOMException('USB analysis transfer cancelled', 'AbortError');
      }
    } finally {
      // The current File[]/batch arrays become unreachable after this function
      // returns. Never carry them into the next resolution window.
      options.onRuntimeChange?.(null);
    }
  };

  const resolveAndUploadWindows = async (
    work: AnalysisFileRequest[],
    retry: boolean,
    countInitialOutcomes: boolean,
  ): Promise<void> => {
    for (let offset = 0; offset < work.length; offset += windowSize) {
      throwIfCancelled(signal, isLocallyAborted);
      const windowRequests = work.slice(offset, offset + windowSize);
      const resolutionStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const resolution = await resolveRequestedAnalysisFilesWithResolver(
        resolver,
        windowRequests,
        { signal, sourceRootName },
      );
      const resolutionFinishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (countInitialOutcomes) {
        resolutionElapsedMs += Math.max(0, resolutionFinishedAt - resolutionStartedAt);
      }
      options.onResolutionWindow?.(resolution);

      if (countInitialOutcomes) {
        processedRequests += windowRequests.length;
        missingCount += resolution.missing.length;
        for (const matched of resolution.matched) {
          const lowerPath = matched.canonicalPath.toLowerCase();
          if (!matchedPaths.has(lowerPath)) {
            matchedPaths.add(lowerPath);
            matchedCount += 1;
            matchedBytes += matched.file.size;
          }
        }
      }

      await uploadResolvedFiles(resolution.matched, retry);
      emitProgress();
      // `resolution` is intentionally not retained beyond this iteration.
    }
  };

  await resolveAndUploadWindows(requests, false, true);

  for (const delayMs of retryDelays) {
    throwIfCancelled(signal, isLocallyAborted);
    const retryPaths = accumulator.retryableFilePaths;
    if (retryPaths.length === 0) break;
    options.onRetryingCount?.(retryPaths.length);
    await waitForRetryDelay(delayMs);
    throwIfCancelled(signal, isLocallyAborted);

    const retryRequests = retryPaths
      .map((path) => requestByPath.get(path))
      .filter((request): request is AnalysisFileRequest => request !== undefined);
    if (retryRequests.length === 0) break;

    await resolveAndUploadWindows(retryRequests, true, false);
  }

  options.onRetryingCount?.(0);
  emitProgress();

  return {
    accumulator,
    matchedPaths,
    matchedCount,
    matchedBytes,
    missingCount,
    resolutionElapsedMs,
  };
}
