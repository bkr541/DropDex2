// Non-standard HTML attribute used for folder selection
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface InputHTMLAttributes<T> {
    webkitdirectory?: '' | boolean;
  }
}

import { resolveImportUsbDeviceId } from '../lib/usb/importUsbDevice';
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useUsbConnection, type UsbConnectionContextValue } from '../contexts/UsbConnectionContext';
import { supabase } from '../lib/supabase';
import {
  completeRekordboxImport,
  deleteRekordboxImport,
  createRekordboxImportJob,
  fetchRekordboxAnalysisStatus,
  fetchRekordboxImportJob,
  fetchRekordboxWorkerState,
  pauseRekordboxAnalysis,
  startRekordboxImport,
  uploadRekordboxDb,
  uploadRekordboxZipBundle,
  RekordboxImportError,
  isExpectedHardDeleteNotFound,
  isUnauthorizedRekordboxImportError,
} from '../lib/api/rekordboxImport';
import type { BatchUploadResponse, CompleteResponse, ImportResult, ImportWriteError, ReuseStats } from '../lib/api/rekordboxImport';
import {
  buildBatches,
  buildMatchedFiles,
  findDatabaseFile,
  isBlockingAnlzFile,
  summarizeManifestWork,
  type MatchedAnalysisFile,
} from '../lib/rekordbox/analysisPaths';
import { UploadAccumulator, isTransientFileFailure } from '../lib/rekordbox/analysisUploadResults';
import { buildManifestReconciliation } from '../lib/rekordbox/manifestReconciliation';
import { runTargetedAnalysisTransfer } from '../lib/rekordbox/targetedAnalysisTransfer';
import type { ManifestReconciliation } from '../lib/rekordbox/manifestReconciliation';
import {
  buildManifestAnalysisRequests,
  resolveRekordboxDatabase,
  type UsbFileResolver,
} from '../lib/rekordbox/usbTargetedDiscovery';
import type { DeleteActiveStrategy } from '../lib/rekordbox/libraryDeletion';
import { isAbortError, uploadBatchWithRetry } from '../lib/rekordbox/uploadBatch';
import { AbortableTimerRegistry, waitForAbortableDelay } from '../lib/rekordbox/abortableRetry';
import { runCancellableUploadQueue, UploadQueueRuntime } from '../lib/rekordbox/cancellableUploadQueue';
import {
  createCloudParsingContext,
  IdempotentUsbCleanup,
  type CloudParsingContext,
  type UsbImportPhase,
  verifyUsbReleased,
} from '../lib/rekordbox/localUsbLifecycle';
import { ImportAbortDialog, ImportSourceScreen, ImportAnalysisScreen, ImportCancelledScreen, ImportFailedScreen, ImportInterruptedScreen, ImportPausedScreen, ImportStoppingScreen, ImportUploadScreen, ImportUsbReleasedScreen, ImportCompleteScreen, ImportPartialSummary, ImportIssuesScreen, type Mode, type UploadStage } from './ImportScreens';
import { ImportProgressModal } from './ImportProgressModal';
import type { ImportUiStep } from './ImportStageProgress';

// ── Types ─────────────────────────────────────────────────────────────────────


export type LocalUsbStage = 'uploading_database' | 'matching_analysis' | 'uploading_analysis' | 'uploading_bundle';

/**
 * Maps the active import phase + local USB sub-stage to one of the five
 * user-facing progress steps.  Pure function — safe to unit-test in isolation.
 */
export function phaseToStep(
  phase: UsbImportPhase,
  localUsbStage: LocalUsbStage,
  hasImportId: boolean,
): ImportUiStep {
  switch (phase) {
    case 'idle':
    case 'scanning_usb':
    case 'database_selected':
      return 'source';
    case 'uploading_usb_data':
      return localUsbStage === 'uploading_database' ? 'database' : 'analysis-files';
    case 'stopping_usb_reads':
      return 'analysis-files';
    case 'usb_released':
    case 'parsing_cloud_data':
    case 'pausing_cloud_work':
    case 'paused':
    case 'interrupted':
      return 'analyze';
    case 'completed':
    case 'partial_success':
      return 'complete';
    case 'deleting_import':
    case 'cancelling_cloud_work':
    case 'cancelled':
      return hasImportId ? 'analyze' : 'source';
    case 'failed':
      return hasImportId ? 'analyze' : 'source';
    default:
      return 'source';
  }
}
type AbortDialogIntent = 'pause' | 'delete' | 'close';

interface FolderScan {
  dbFile: File | null;
  anlzFiles: File[];
  folderName: string;
  targetedResolver: UsbFileResolver | null;
}

export async function selectRekordboxUsbDatabase(
  usb: Pick<UsbConnectionContextValue, 'selectUsbRoot' | 'resolveImportFile'>,
): Promise<{
  cancelled: boolean;
  error?: string;
  dbFile: File | null;
  folderName: string;
  resolver: UsbFileResolver;
}> {
  const selection = await usb.selectUsbRoot();
  if (selection.cancelled || selection.error) {
    return {
      cancelled: selection.cancelled,
      error: selection.error,
      dbFile: null,
      folderName: selection.volumeName || 'Selected USB',
      resolver: usb.resolveImportFile,
    };
  }

  return {
    cancelled: false,
    dbFile: await resolveRekordboxDatabase(usb.resolveImportFile),
    folderName: selection.volumeName || 'Selected USB',
    resolver: usb.resolveImportFile,
  };
}

interface UploadProgress {
  filesUploaded: number;
  filesTotal: number;
  bytesUploaded: number;
  bytesTotal: number;
  bundlePct: number;
}

interface ParseProgress {
  currentTrackLabel: string | null;
  parsedTracks: number;
  totalTracks: number;
  percent: number;
}

interface ProgressiveReadiness {
  stage: string;
  tracksReady: number;
  tracksRemaining: number;
  throughput: number | null;
  estimatedSecondsRemaining: number | null;
  optionalArchivalStatus: string;
  rawArchivalStatus: string;
}

type FinalResult =
  | { kind: 'with_analysis'; data: CompleteResponse }
  | { kind: 'library_only'; data: ImportResult };

interface Props {
  isOpen: boolean;
  accessToken: string | null;
  onClose: () => void;
  onSuccess: () => void;
  onImportStarted?: (importId: string) => void;
  onBackgrounded?: (importId: string, usbReleased: boolean) => void;
  onRequestDelete?: (
    importId: string,
    executeConfirmedDelete: (strategy: DeleteActiveStrategy) => Promise<void>,
  ) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BATCH_SIZE = 50;
const MAX_BYTES_PER_BATCH = 50 * 1024 * 1024; // 50 MB
const MAX_CONCURRENT = 2;
const PARSE_STATUS_POLL_MS = 2500;
const PARSE_STATUS_MAX_TRANSIENT_FAILURES = 3;
const CLOUD_CANCEL_POLL_MS = 1000;
const CLOUD_CANCEL_MAX_POLLS = 30;


// ── Helpers ───────────────────────────────────────────────────────────────────


function extractError(err: unknown): { message: string; structured: ImportWriteError | null } {
  if (err instanceof RekordboxImportError) {
    return { message: err.message, structured: err.structured };
  }
  const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
  return { message, structured: null };
}

function isTransientAnalysisStatusPollError(error: unknown): boolean {
  if (error instanceof RekordboxImportError) {
    return error.status === 408
      || error.status === 429
      || (error.status !== null && error.status >= 500);
  }
  // Browser fetch() reports connection resets, DNS failures, and similar
  // transport problems as TypeError. These should not turn a successfully
  // queued import into a failed import after a single status-poll hiccup.
  return error instanceof TypeError;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}


// ── Component ─────────────────────────────────────────────────────────────────

export function ImportLibraryModal({
  isOpen,
  accessToken,
  onClose,
  onSuccess,
  onImportStarted,
  onBackgrounded,
  onRequestDelete,
}: Props) {
  const usb = useUsbConnection();
  const [mode, setMode] = useState<Mode>('usb_folder');
  const [phase, setPhase] = useState<UsbImportPhase>('idle');
  const [localUsbStage, setLocalUsbStage] = useState<LocalUsbStage>('uploading_database');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [folderScan, setFolderScan] = useState<FolderScan | null>(null);
  const [progress, setProgress] = useState<UploadProgress>({
    filesUploaded: 0, filesTotal: 0, bytesUploaded: 0, bytesTotal: 0, bundlePct: 0,
  });
  const [parseProgress, setParseProgress] = useState<ParseProgress>({
    currentTrackLabel: null, parsedTracks: 0, totalTracks: 0, percent: 0,
  });
  const [finalResult, setFinalResult] = useState<FinalResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorStructured, setErrorStructured] = useState<ImportWriteError | null>(null);
  const [showAbortDialog, setShowAbortDialog] = useState(false);
  const [abortDialogIntent, setAbortDialogIntent] = useState<AbortDialogIntent>('delete');
  const [usbReleaseConfirmed, setUsbReleaseConfirmed] = useState(false);
  const [cloudCancellationStarted, setCloudCancellationStarted] = useState(false);
  const [issueViewOpen, setIssueViewOpen] = useState(false);
  const [issueTracks, setIssueTracks] = useState<{ id: string; title: string; artist: string | null; analysis_parse_status: string; analysis_failure_reason: string | null; analysis_parse_warnings: Array<{ code?: string }> | null }[] | null>(null);
  const [issueTracksLoading, setIssueTracksLoading] = useState(false);
  const [expandedTrackIds, setExpandedTrackIds] = useState<Set<string>>(new Set());
  const [rejectedCount, setRejectedCount] = useState(0);
  const [reuseStats, setReuseStats] = useState<ReuseStats | null>(null);
  const [reconciliation, setReconciliation] = useState<ManifestReconciliation | null>(null);
  const [retryingCount, setRetryingCount] = useState(0);
  const [libraryMetadataReady, setLibraryMetadataReady] = useState(false);
  const [progressiveReadiness, setProgressiveReadiness] = useState<ProgressiveReadiness>({
    stage: 'Book metadata ready',
    tracksReady: 0,
    tracksRemaining: 0,
    throughput: null,
    estimatedSecondsRemaining: null,
    optionalArchivalStatus: 'skipped',
    rawArchivalStatus: 'skipped',
  });

  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localAbortControllerRef = useRef<AbortController | null>(null);
  const cloudAbortControllerRef = useRef<AbortController | null>(null);
  const importIdRef = useRef<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const operationRef = useRef(0);
  const backgroundedRef = useRef(false);
  const libraryReadyPublishedRef = useRef(false);
  const localUploadBackgroundedRef = useRef(false);
  const mountedRef = useRef(true);
  const selectedFileRef = useRef<File | null>(null);
  const folderScanRef = useRef<FolderScan | null>(null);
  const matchedFilesRef = useRef<MatchedAnalysisFile[]>([]);
  const uploadBatchesRef = useRef<MatchedAnalysisFile[][]>([]);
  const retryFilesByPathRef = useRef<Map<string, MatchedAnalysisFile>>(new Map());
  const directoryHandlesRef = useRef<FileSystemDirectoryHandle[]>([]);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const activeLocalRequestsRef = useRef(0);
  const localAbortRequestedRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const confirmedDeleteStrategyRef = useRef<DeleteActiveStrategy>('activate_next');
  const usbReleaseConfirmedRef = useRef(false);
  const closeAfterCancelRef = useRef(false);
  const retryTimersRef = useRef(new AbortableTimerRegistry());
  const uploadQueueRuntimeRef = useRef<UploadQueueRuntime | null>(null);
  const usbCleanupRef = useRef(new IdempotentUsbCleanup());
  const cancelBackendPromiseRef = useRef<Promise<void> | null>(null);
  const pauseBackendPromiseRef = useRef<Promise<void> | null>(null);
  const cloudCancellationControllerRef = useRef<AbortController | null>(null);
  const cloudCancellationTimersRef = useRef(new AbortableTimerRegistry());
  const localCleanupRoutineRef = useRef<(updateState: boolean) => void>(() => undefined);

  // AuthProvider receives Supabase TOKEN_REFRESHED events and updates this prop.
  // Keep the latest token in a ref so long-running upload/parsing closures never
  // continue polling with the token that existed when the import began.
  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  const currentAccessToken = async (fallbackToken?: string): Promise<string> => {
    const cached = accessTokenRef.current ?? fallbackToken;
    if (cached) return cached;

    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const token = data.session?.access_token;
    if (!token) {
      throw new RekordboxImportError(
        'Your DropDex session is no longer available. Sign in again and resume the import.',
        null,
        401,
      );
    }
    accessTokenRef.current = token;
    return token;
  };

  const refreshedAccessToken = async (): Promise<string> => {
    const { data, error } = await supabase.auth.refreshSession();
    const token = data.session?.access_token;
    if (error || !token) {
      throw new RekordboxImportError(
        'Your DropDex session expired while the import was running. Sign in again and resume the import.',
        null,
        401,
      );
    }
    accessTokenRef.current = token;
    return token;
  };

  const requestWithAuthRetry = async <T,>(
    request: (token: string) => Promise<T>,
    fallbackToken?: string,
  ): Promise<T> => {
    const token = await currentAccessToken(fallbackToken);
    try {
      return await request(token);
    } catch (error) {
      if (!isUnauthorizedRekordboxImportError(error)) throw error;
      const refreshedToken = await refreshedAccessToken();
      return request(refreshedToken);
    }
  };

  const localUsbAccessActive =
    phase === 'uploading_usb_data' || phase === 'stopping_usb_reads';

  const setSelectedFileResource = (file: File | null) => {
    selectedFileRef.current = file;
    setSelectedFile(file);
  };

  const setFolderScanResource = (scan: FolderScan | null) => {
    folderScanRef.current = scan;
    setFolderScan(scan);
  };

  const performLocalUsbCleanup = (updateState = true) => {
    usbCleanupRef.current.run(() => {
      // Browser import is strictly read-only. Cleanup only aborts reads and drops
      // browser references; it never opens a writable handle or mutates the USB.
      localAbortRequestedRef.current = true;
      uploadQueueRuntimeRef.current?.abortScheduling();
      retryTimersRef.current.cancelAll();
      localAbortControllerRef.current?.abort();
      localAbortControllerRef.current = null;

      selectedFileRef.current = null;
      folderScanRef.current = null;
      matchedFilesRef.current = [];
      uploadBatchesRef.current = [];
      retryFilesByPathRef.current.clear();
      directoryHandlesRef.current = [];

      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current.clear();

      if (folderInputRef.current) folderInputRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';

      if (updateState && mountedRef.current) {
        setSelectedFile(null);
        setFolderScan(null);
        setRetryingCount(0);
      }
    });
  };
  localCleanupRoutineRef.current = performLocalUsbCleanup;

  const prepareLocalUsbLifecycle = () => {
    usbCleanupRef.current = new IdempotentUsbCleanup();
    retryTimersRef.current.cancelAll();
    retryTimersRef.current = new AbortableTimerRegistry();
    uploadQueueRuntimeRef.current = null;
    localAbortRequestedRef.current = false;
    cancelRequestedRef.current = false;
    confirmedDeleteStrategyRef.current = 'activate_next';
    closeAfterCancelRef.current = false;
    cancelBackendPromiseRef.current = null;
    pauseBackendPromiseRef.current = null;
    cloudCancellationControllerRef.current?.abort();
    cloudCancellationControllerRef.current = null;
    cloudCancellationTimersRef.current.cancelAll();
    cloudCancellationTimersRef.current = new AbortableTimerRegistry();
    activeLocalRequestsRef.current = 0;
    usbReleaseConfirmedRef.current = false;
    setUsbReleaseConfirmed(false);
    setCloudCancellationStarted(false);
  };

  const reset = () => {
    performLocalUsbCleanup(true);
    cloudAbortControllerRef.current?.abort();
    cloudAbortControllerRef.current = null;
    setPhase('idle');
    setLocalUsbStage('uploading_database');
    setProgress({ filesUploaded: 0, filesTotal: 0, bytesUploaded: 0, bytesTotal: 0, bundlePct: 0 });
    setParseProgress({ currentTrackLabel: null, parsedTracks: 0, totalTracks: 0, percent: 0 });
    setFinalResult(null);
    setErrorMessage('');
    setErrorStructured(null);
    setIssueViewOpen(false);
    setIssueTracks(null);
    setIssueTracksLoading(false);
    setShowAbortDialog(false);
    setAbortDialogIntent('delete');
    setRejectedCount(0);
    setReuseStats(null);
    setReconciliation(null);
    setRetryingCount(0);
    setProgressiveReadiness({
      stage: 'Book metadata ready',
      tracksReady: 0,
      tracksRemaining: 0,
      throughput: null,
      estimatedSecondsRemaining: null,
      optionalArchivalStatus: 'skipped',
      rawArchivalStatus: 'skipped',
    });
    libraryReadyPublishedRef.current = false;
    localUploadBackgroundedRef.current = false;
    setLibraryMetadataReady(false);
    usbReleaseConfirmedRef.current = false;
    setUsbReleaseConfirmed(false);
    setCloudCancellationStarted(false);
    operationRef.current += 1;
    backgroundedRef.current = false;
    importIdRef.current = null;
    cancelRequestedRef.current = false;
    confirmedDeleteStrategyRef.current = 'activate_next';
    closeAfterCancelRef.current = false;
    localAbortRequestedRef.current = false;
    activeLocalRequestsRef.current = 0;
    uploadQueueRuntimeRef.current = null;
    retryTimersRef.current = new AbortableTimerRegistry();
    usbCleanupRef.current = new IdempotentUsbCleanup();
    cancelBackendPromiseRef.current = null;
    pauseBackendPromiseRef.current = null;
    cloudCancellationControllerRef.current?.abort();
    cloudCancellationControllerRef.current = null;
    cloudCancellationTimersRef.current.cancelAll();
    cloudCancellationTimersRef.current = new AbortableTimerRegistry();
  };

  const switchMode = (m: Mode) => {
    reset();
    setMode(m);
  };

  const runTrackedLocalRequest = async <T,>(request: () => Promise<T>): Promise<T> => {
    activeLocalRequestsRef.current += 1;
    try {
      return await request();
    } finally {
      activeLocalRequestsRef.current = Math.max(0, activeLocalRequestsRef.current - 1);
    }
  };

  const throwIfLocalCancellationRequested = (controller: AbortController) => {
    if (localAbortRequestedRef.current || controller.signal.aborted) {
      throw new DOMException('Local USB work aborted', 'AbortError');
    }
  };

  const verifyAndPublishUsbRelease = async () => {
    performLocalUsbCleanup(true);
    await Promise.resolve();

    const queueSnapshot = uploadQueueRuntimeRef.current?.snapshot();
    const verification = verifyUsbReleased({
      activeUploadRequests:
        activeLocalRequestsRef.current + (queueSnapshot?.activeRequests ?? 0),
      queuedBatches: queueSnapshot?.queuedBatches ?? 0,
      retryTimerCount: retryTimersRef.current.activeCount,
      controllerActive: Boolean(
        localAbortControllerRef.current && !localAbortControllerRef.current.signal.aborted,
      ),
      databaseFileCount:
        (selectedFileRef.current ? 1 : 0) + (folderScanRef.current?.dbFile ? 1 : 0),
      analysisFileCount: folderScanRef.current?.anlzFiles.length ?? 0,
      matchedFileCount: matchedFilesRef.current.length,
      batchFileCount: uploadBatchesRef.current.reduce((count, batch) => count + batch.length, 0),
      pathMapCount: retryFilesByPathRef.current.size,
      objectUrlCount: objectUrlsRef.current.size,
      directoryHandleCount: directoryHandlesRef.current.length,
    });

    if (!verification.released) {
      throw new Error(`USB release verification failed: ${verification.blockers.join(', ')}`);
    }

    const desktopRelease = await usb.release();
    if (desktopRelease && !desktopRelease.allStreamsClosed) {
      throw new Error(
        `Electron USB release timed out with ${desktopRelease.remainingStreamCount} active stream(s).`,
      );
    }

    uploadQueueRuntimeRef.current = null;
    usbReleaseConfirmedRef.current = true;
    if (mountedRef.current) {
      setUsbReleaseConfirmed(true);
      setPhase('usb_released');
    }
    const releasedImportId = importIdRef.current;
    if (releasedImportId && localUploadBackgroundedRef.current) {
      onBackgrounded?.(releasedImportId, true);
    }
  };

  const closeAfterCancellationIfRequested = () => {
    if (!closeAfterCancelRef.current) return;
    reset();
    onClose();
  };

  const deleteCloudWork = (
    activeStrategy: DeleteActiveStrategy = confirmedDeleteStrategyRef.current,
  ): Promise<void> => {
    if (cancelBackendPromiseRef.current) return cancelBackendPromiseRef.current;

    const promise = (async () => {
      const id = importIdRef.current;
      const fallbackToken = accessTokenRef.current ?? undefined;
      cloudAbortControllerRef.current?.abort();
      cloudAbortControllerRef.current = null;

      cloudCancellationControllerRef.current?.abort();
      cloudCancellationTimersRef.current.cancelAll();
      const cancellationController = new AbortController();
      const cancellationTimers = new AbortableTimerRegistry();
      cloudCancellationControllerRef.current = cancellationController;
      cloudCancellationTimersRef.current = cancellationTimers;

      if (mountedRef.current) {
        setCloudCancellationStarted(true);
        setPhase('deleting_import');
      }

      if (!id) {
        cancellationController.abort();
        cancellationTimers.cancelAll();
        if (cloudCancellationControllerRef.current === cancellationController) {
          cloudCancellationControllerRef.current = null;
        }
        if (cloudCancellationTimersRef.current === cancellationTimers) {
          cloudCancellationTimersRef.current = new AbortableTimerRegistry();
        }
        if (mountedRef.current) setPhase('cancelled');
        closeAfterCancellationIfRequested();
        return;
      }

      try {
        let job = await requestWithAuthRetry(
          (token) => deleteRekordboxImport(id, token, cancellationController.signal, activeStrategy),
          fallbackToken,
        );

        for (let poll = 0; poll < CLOUD_CANCEL_MAX_POLLS; poll += 1) {
          if (job.status === 'cancelled' || job.status === 'completed' || job.status === 'failed') break;
          await waitForAbortableDelay(
            CLOUD_CANCEL_POLL_MS,
            cancellationController.signal,
            cancellationTimers,
          );
          try {
            job = await requestWithAuthRetry(
              (token) => fetchRekordboxImportJob(id, token, cancellationController.signal),
              fallbackToken,
            );
          } catch (error) {
            if (isExpectedHardDeleteNotFound(error, true)) {
              // The DELETE request above was accepted for this exact import. A
              // subsequent 404 is the expected hard-delete terminal state.
              if (mountedRef.current) {
                setPhase('cancelled');
                onSuccess();
              }
              return;
            }
            throw error;
          }
        }

        if (!mountedRef.current) return;

        if (job.status === 'cancelled') {
          setPhase('cancelled');
          onSuccess();
        } else if (job.status === 'completed') {
          setErrorMessage(
            'This import finished before the cancellation reached the server. It remains completed in Import History.',
          );
          setPhase('failed');
          onSuccess();
        } else if (job.status === 'failed') {
          setErrorMessage(job.error_message ?? 'The import failed while cancellation was being processed.');
          setPhase('failed');
        } else {
          setErrorMessage('USB access is released, but cloud cancellation is still pending. Check Import History before starting another import.');
          setPhase('failed');
        }
      } catch (error) {
        if (!mountedRef.current || isAbortError(error)) return;
        setErrorMessage(
          'USB access is released, but DropDex could not confirm cloud cancellation. Check Import History before retrying.',
        );
        setPhase('failed');
      } finally {
        cancellationTimers.cancelAll();
        if (cloudCancellationControllerRef.current === cancellationController) {
          cloudCancellationControllerRef.current = null;
        }
        if (cloudCancellationTimersRef.current === cancellationTimers) {
          cloudCancellationTimersRef.current = new AbortableTimerRegistry();
        }
        closeAfterCancellationIfRequested();
      }
    })();

    cancelBackendPromiseRef.current = promise;
    return promise;
  };

  const pauseCloudWork = (): Promise<void> => {
    if (pauseBackendPromiseRef.current) return pauseBackendPromiseRef.current;

    const promise = (async () => {
      const id = importIdRef.current;
      const fallbackToken = accessTokenRef.current ?? undefined;
      cloudAbortControllerRef.current?.abort();
      cloudAbortControllerRef.current = null;

      cloudCancellationControllerRef.current?.abort();
      cloudCancellationTimersRef.current.cancelAll();
      const controller = new AbortController();
      const timers = new AbortableTimerRegistry();
      cloudCancellationControllerRef.current = controller;
      cloudCancellationTimersRef.current = timers;
      if (mountedRef.current) {
        setCloudCancellationStarted(true);
        setPhase('pausing_cloud_work');
      }
      if (!id) {
        if (mountedRef.current) setPhase('paused');
        return;
      }

      try {
        await requestWithAuthRetry(
          (token) => pauseRekordboxAnalysis(id, token, controller.signal),
          fallbackToken,
        );
        let worker = await requestWithAuthRetry(
          (token) => fetchRekordboxWorkerState(id, token, controller.signal),
          fallbackToken,
        );
        for (let poll = 0; poll < CLOUD_CANCEL_MAX_POLLS; poll += 1) {
          if (worker.stopped_acknowledged && !worker.worker_active) break;
          await waitForAbortableDelay(CLOUD_CANCEL_POLL_MS, controller.signal, timers);
          worker = await requestWithAuthRetry(
            (token) => fetchRekordboxWorkerState(id, token, controller.signal),
            fallbackToken,
          );
        }
        if (!mountedRef.current) return;
        if (worker.stopped_acknowledged && !worker.worker_active) {
          const finalJob = await requestWithAuthRetry(
            (token) => fetchRekordboxImportJob(id, token, controller.signal),
            fallbackToken,
          );
          const analysisFinished = finalJob.analysis_status === 'completed'
            || finalJob.analysis_status === 'partial';
          setPhase(analysisFinished ? 'completed' : 'paused');
          onSuccess();
        } else {
          setErrorMessage(
            'USB access is zero, but cloud analysis is still stopping. Import History will show the final paused state.',
          );
          setPhase('failed');
        }
      } catch (error) {
        if (!mountedRef.current || isAbortError(error)) return;
        setErrorMessage(
          'USB access is zero, but DropDex could not confirm the worker pause. Check Import History before resuming.',
        );
        setPhase('failed');
      } finally {
        timers.cancelAll();
        if (cloudCancellationControllerRef.current === controller) {
          cloudCancellationControllerRef.current = null;
        }
        if (cloudCancellationTimersRef.current === timers) {
          cloudCancellationTimersRef.current = new AbortableTimerRegistry();
        }
        pauseBackendPromiseRef.current = null;
        closeAfterCancellationIfRequested();
      }
    })();

    pauseBackendPromiseRef.current = promise;
    return promise;
  };


  const requestLocalUsbStop = () => {
    if (mountedRef.current) setPhase('stopping_usb_reads');
    localAbortRequestedRef.current = true;
    uploadQueueRuntimeRef.current?.abortScheduling();
    retryTimersRef.current.cancelAll();
    performLocalUsbCleanup(true);
  };

  const handleContinueInBackground = () => {
    const importId = importIdRef.current;
    if (!importId) return;

    if (phase === 'uploading_usb_data' && mode === 'usb_folder' && libraryMetadataReady) {
      // Keep this mounted import worker alive while the modal is hidden. The
      // browser still owns the read-only File handles until upload and release
      // verification finish, so the background panel must not expose cloud
      // pause/delete controls yet.
      localUploadBackgroundedRef.current = true;
      onBackgrounded?.(importId, false);
      onClose();
      return;
    }

    if (phase !== 'parsing_cloud_data' && phase !== 'usb_released') return;
    backgroundedRef.current = true;
    onBackgrounded?.(importId, true);
    onClose();
  };

  const executeConfirmedHardDelete = async (
    strategy: DeleteActiveStrategy,
    intent: AbortDialogIntent = abortDialogIntent,
  ): Promise<void> => {
    confirmedDeleteStrategyRef.current = strategy;
    closeAfterCancelRef.current = intent === 'close';
    cancelRequestedRef.current = true;
    setShowAbortDialog(false);
    setErrorMessage('');

    if (phase === 'parsing_cloud_data' || phase === 'usb_released') {
      usbReleaseConfirmedRef.current = true;
      setUsbReleaseConfirmed(true);
      await deleteCloudWork(strategy);
      return;
    }

    if (localUsbAccessActive) {
      requestLocalUsbStop();
      return;
    }

    await deleteCloudWork(strategy);
  };

  const openAbortDialog = (intent: AbortDialogIntent) => {
    setAbortDialogIntent(intent);
    if (intent !== 'pause' && importIdRef.current && onRequestDelete) {
      onRequestDelete(
        importIdRef.current,
        (strategy) => executeConfirmedHardDelete(strategy, intent),
      );
      return;
    }
    setShowAbortDialog(true);
  };

  const handleClose = () => {
    // Terminal success/pause states: X behaves like Done (calls onSuccess)
    if (
      phase === 'completed' ||
      phase === 'partial_success' ||
      phase === 'paused' ||
      phase === 'interrupted'
    ) {
      handleDone();
      return;
    }
    if (phase === 'parsing_cloud_data' || phase === 'usb_released') {
      handleContinueInBackground();
      return;
    }
    if (localUsbAccessActive) {
      openAbortDialog('close');
      return;
    }
    if (phase === 'deleting_import' || phase === 'pausing_cloud_work') return;
    reset();
    onClose();
  };

  const confirmAbort = () => {
    closeAfterCancelRef.current = abortDialogIntent === 'close';
    cancelRequestedRef.current = abortDialogIntent !== 'pause';
    setShowAbortDialog(false);
    setErrorMessage('');

    if (phase === 'parsing_cloud_data' || phase === 'usb_released') {
      usbReleaseConfirmedRef.current = true;
      setUsbReleaseConfirmed(true);
      if (abortDialogIntent === 'delete') void deleteCloudWork(confirmedDeleteStrategyRef.current);
      else void pauseCloudWork();
      return;
    }

    if (localUsbAccessActive) {
      requestLocalUsbStop();
      return;
    }

    void deleteCloudWork();
  };

  const handleDone = () => {
    onSuccess();
    reset();
    onClose();
  };

  // ── USB Folder mode ──────────────────────────────────────────────────────────

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) {
      setPhase('idle');
      return;
    }

    const files = Array.from(fileList);
    const dbFile = findDatabaseFile(files);
    // Do not retain thousands of optional .2EX File handles in React state.
    // DAT/EXT are the only assets in the blocking fast path. Archival can be
    // performed later without delaying USB release or library readiness.
    const anlzFiles = files.filter(isBlockingAnlzFile);
    const folderName =
      (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath
        ?.split('/')[0] ?? 'Selected folder';

    directoryHandlesRef.current = [];
    setFolderScanResource({ dbFile, anlzFiles, folderName, targetedResolver: null });
    setPhase('database_selected');
  };

  const handleUsbSourceSelect = async () => {
    setPhase('scanning_usb');

    const selectionOperation = ++operationRef.current;
    try {
      const selection = await selectRekordboxUsbDatabase(usb);
      if (!mountedRef.current || selectionOperation !== operationRef.current) return;
      if (selection.cancelled) {
        setPhase('idle');
        return;
      }
      if (selection.error) throw new Error(selection.error);

      directoryHandlesRef.current = [];
      setFolderScanResource({
        dbFile: selection.dbFile,
        anlzFiles: [],
        folderName: selection.folderName,
        targetedResolver: selection.resolver,
      });
      setPhase('database_selected');
    } catch (error) {
      if (!mountedRef.current || selectionOperation !== operationRef.current) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        setPhase('idle');
        return;
      }
      // Compatibility fallback for browsers without File System Access. This
      // preserves the legacy webkitdirectory flow without making it the normal
      // path on supported browser or Electron runtimes.
      if (usb.runtime === 'browser' && typeof window.showDirectoryPicker !== 'function') {
        folderInputRef.current?.click();
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : 'Could not read the selected USB.');
      setPhase('failed');
    }
  };

  // ── ZIP / DB file mode ───────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (mode === 'zip_bundle') {
      if (!file.name.toLowerCase().endsWith('.zip')) {
        setErrorMessage('Please select a .zip file.');
        setPhase('failed');
        return;
      }
    } else if (!file.name.toLowerCase().endsWith('.db')) {
      setErrorMessage(
        'Please select a .db file. The Rekordbox database is named exportLibrary.db.',
      );
      setPhase('failed');
      return;
    }

    setSelectedFileResource(file);
    setPhase('database_selected');
  };

  const runUsbFolderUpload = async (
    token: string,
    controller: AbortController,
    jobId: string,
    operation: number,
  ): Promise<CloudParsingContext> => {
    const scan = folderScanRef.current;
    if (!scan?.dbFile) throw new Error('No exportLibrary.db found in the selected folder.');

    setLocalUsbStage('uploading_database');
    setPhase('uploading_usb_data');
    const startResp = await runTrackedLocalRequest(() => startRekordboxImport(
      scan.dbFile as File,
      token,
      controller.signal,
      scan.folderName,
      jobId,
    ));
    throwIfLocalCancellationRequested(controller);
    if (operation !== operationRef.current) throw new DOMException('Stale import', 'AbortError');

    importIdRef.current = startResp.import_id;

    if (startResp.library_ready !== false && !libraryReadyPublishedRef.current) {
      libraryReadyPublishedRef.current = true;
      setLibraryMetadataReady(true);
      onSuccess();
    }
    const manifestWork = summarizeManifestWork(startResp.manifest, BATCH_SIZE);
    const affectedTrackIds = manifestWork.affectedTrackIds;
    setProgressiveReadiness({
      stage: 'Book metadata ready',
      tracksReady: startResp.tracks_already_reusable ?? 0,
      tracksRemaining: affectedTrackIds.length,
      throughput: null,
      estimatedSecondsRemaining: null,
      optionalArchivalStatus: startResp.optional_archival_file_count
        ? 'skipped'
        : 'not needed',
      rawArchivalStatus: manifestWork.requiredAnalysisFiles > 0 ? 'queued' : 'not needed',
    });

    if (
      (startResp.tracks_reused ?? 0) > 0 ||
      (startResp.tracks_metadata_only ?? 0) > 0 ||
      (startResp.tracks_reparse_from_retained ?? 0) > 0
    ) {
      setReuseStats({
        tracksReused: startResp.tracks_reused ?? 0,
        tracksNeedingUpload: startResp.tracks_needing_upload ?? 0,
        tracksReparsedFromRetained: startResp.tracks_reparse_from_retained ?? 0,
        tracksMetadataOnly: startResp.tracks_metadata_only ?? 0,
      });
    }

    setLocalUsbStage('matching_analysis');
    let matchingElapsedMs = 0;
    let matchedCount = 0;
    let totalBytes = 0;
    let matchedPathSet = new Set<string>();
    let accumulator: UploadAccumulator;

    if (scan.targetedResolver) {
      const requests = buildManifestAnalysisRequests(startResp.manifest);
      setProgress({
        filesUploaded: 0,
        filesTotal: requests.length,
        bytesUploaded: 0,
        bytesTotal: 0,
        bundlePct: 0,
      });

      let uploadStagePublished = false;
      const transfer = await runTargetedAnalysisTransfer({
        resolver: scan.targetedResolver,
        requests,
        signal: controller.signal,
        sourceRootName: scan.folderName,
        maxFilesPerBatch: BATCH_SIZE,
        maxBytesPerBatch: MAX_BYTES_PER_BATCH,
        maxConcurrent: MAX_CONCURRENT,
        resolveWindowSize: BATCH_SIZE * MAX_CONCURRENT,
        isLocallyAborted: () => localAbortRequestedRef.current,
        uploadBatch: (batch, maxAttempts) => uploadBatchWithRetry(
          startResp.import_id,
          batch,
          accessTokenRef.current ?? token,
          controller.signal,
          maxAttempts,
          {
            retryTimers: retryTimersRef.current,
            isLocallyAborted: () => localAbortRequestedRef.current,
          },
        ),
        waitForRetryDelay: (delayMs) => waitForAbortableDelay(
          delayMs,
          controller.signal,
          retryTimersRef.current,
          () => localAbortRequestedRef.current,
        ),
        onResolutionWindow: () => {
          if (uploadStagePublished) return;
          uploadStagePublished = true;
          setLocalUsbStage('uploading_analysis');
        },
        onRuntimeChange: (runtime) => {
          uploadQueueRuntimeRef.current = runtime;
        },
        onRetryingCount: (count) => {
          if (mountedRef.current && operation === operationRef.current) setRetryingCount(count);
        },
        onProgress: (snapshot) => {
          if (!mountedRef.current || operation !== operationRef.current) return;
          setProgress((current) => ({
            ...current,
            filesUploaded: Math.min(
              snapshot.totalRequests,
              snapshot.confirmedFiles + snapshot.missingFiles,
            ),
            bytesUploaded: snapshot.confirmedBytes,
          }));
          setRejectedCount(snapshot.rejectedFiles + snapshot.errorFiles);
        },
      });

      if (!uploadStagePublished) setLocalUsbStage('uploading_analysis');
      accumulator = transfer.accumulator;
      matchingElapsedMs = transfer.resolutionElapsedMs;
      matchedCount = transfer.matchedCount;
      totalBytes = transfer.matchedBytes;
      matchedPathSet = transfer.matchedPaths;
    } else {
      // Compatibility path for browsers that cannot expose a persistent
      // directory handle. The browser has already materialized the legacy
      // FileList at selection time, so preserve the existing matcher/uploader
      // without changing unsupported-browser behavior.
      const matchingStartedAt = performance.now();
      const matchedFiles = buildMatchedFiles(scan.anlzFiles, startResp.manifest);
      matchingElapsedMs = performance.now() - matchingStartedAt;
      const batches = buildBatches(matchedFiles, BATCH_SIZE, MAX_BYTES_PER_BATCH);
      matchedFilesRef.current = matchedFiles;
      uploadBatchesRef.current = batches;
      matchedCount = matchedFiles.length;
      totalBytes = matchedFiles.reduce((sum, item) => sum + item.file.size, 0);
      matchedPathSet = new Set(matchedFiles.map((file) => file.canonicalPath.toLowerCase()));

      setProgress({
        filesUploaded: 0,
        filesTotal: matchedFiles.length,
        bytesUploaded: 0,
        bytesTotal: totalBytes,
        bundlePct: 0,
      });

      setLocalUsbStage('uploading_analysis');
      accumulator = new UploadAccumulator();
      const runtime = new UploadQueueRuntime(batches.length);
      uploadQueueRuntimeRef.current = runtime;

      const queueResult = await runCancellableUploadQueue<MatchedAnalysisFile[], BatchUploadResponse | null>({
        batches,
        maxConcurrent: MAX_CONCURRENT,
        signal: controller.signal,
        runtime,
        isLocallyAborted: () => localAbortRequestedRef.current,
        isAbortError,
        isFailedResult: (response) => response === null,
        runBatch: (batch) => uploadBatchWithRetry(
          startResp.import_id,
          batch,
          accessTokenRef.current ?? token,
          controller.signal,
          3,
          {
            retryTimers: retryTimersRef.current,
            isLocallyAborted: () => localAbortRequestedRef.current,
          },
        ),
        onBatchSuccess: (response, batch) => {
          if (response) accumulator.addBatchResponse(response, batch);
          if (!mountedRef.current || operation !== operationRef.current) return;
          setProgress((current) => ({
            ...current,
            filesUploaded: accumulator.confirmedFiles,
            bytesUploaded: accumulator.confirmedBytes,
          }));
          setRejectedCount(accumulator.summary.rejectedFiles + accumulator.summary.errorFiles);
        },
        onBatchFailure: (error, batch) => {
          if (!isAbortError(error)) accumulator.recordFailedBatch(batch);
        },
      });

      if (queueResult.cancelled || localAbortRequestedRef.current || controller.signal.aborted) {
        throw new DOMException('USB upload cancelled', 'AbortError');
      }

      const filesByLowerPath = new Map<string, MatchedAnalysisFile>(
        matchedFiles.map((file) => [file.canonicalPath.toLowerCase(), file]),
      );
      retryFilesByPathRef.current = filesByLowerPath;
      const fileRetryDelaysMs = [500, 1000];

      for (let retryIndex = 0; retryIndex < fileRetryDelaysMs.length; retryIndex += 1) {
        throwIfLocalCancellationRequested(controller);
        const retryPaths = accumulator.retryableFilePaths;
        if (retryPaths.length === 0) break;
        setRetryingCount(retryPaths.length);

        await waitForAbortableDelay(
          fileRetryDelaysMs[retryIndex],
          controller.signal,
          retryTimersRef.current,
          () => localAbortRequestedRef.current,
        );
        throwIfLocalCancellationRequested(controller);

        const retryBatch = retryPaths
          .map((path) => filesByLowerPath.get(path))
          .filter((file): file is MatchedAnalysisFile => file !== undefined);
        if (retryBatch.length === 0) break;

        const { data: { session: retrySession } } = await supabase.auth.getSession();
        throwIfLocalCancellationRequested(controller);
        const retryToken = retrySession?.access_token ?? accessTokenRef.current ?? token;
        accessTokenRef.current = retryToken;

        const retryResponse = await runTrackedLocalRequest(() => uploadBatchWithRetry(
          startResp.import_id,
          retryBatch,
          retryToken,
          controller.signal,
          1,
          {
            retryTimers: retryTimersRef.current,
            isLocallyAborted: () => localAbortRequestedRef.current,
          },
        ));
        throwIfLocalCancellationRequested(controller);
        if (retryResponse === null) break;

        for (const fileResult of retryResponse.files) {
          if (fileResult.status === 'received' || fileResult.status === 'already_received') {
            accumulator.correctFileRetrySuccess(
              fileResult.canonical_path,
              fileResult.status,
              fileResult.file_size,
            );
          }
          if (
            import.meta.env.DEV &&
            fileResult.status !== 'received' &&
            fileResult.status !== 'already_received'
          ) {
            console.debug('[ANLZ retry] File remains unresolved', {
              path: fileResult.canonical_path,
              status: fileResult.status,
              reason: fileResult.reject_reason,
              retryable: isTransientFileFailure(fileResult),
            });
          }
        }

        setProgress((current) => ({
          ...current,
          filesUploaded: accumulator.confirmedFiles,
          bytesUploaded: accumulator.confirmedBytes,
        }));
        setRejectedCount(accumulator.summary.rejectedFiles + accumulator.summary.errorFiles);
      }
    }

    setRetryingCount(0);
    throwIfLocalCancellationRequested(controller);

    setReconciliation(buildManifestReconciliation(
      startResp.manifest,
      matchedPathSet,
      accumulator.successfullyUploadedPaths,
    ));

    return createCloudParsingContext(
      startResp.import_id,
      startResp.expected_track_count || startResp.manifest.length || 0,
      affectedTrackIds,
      startResp.tracks_already_reusable ?? 0,
      startResp.optional_archival_file_count ?? 0,
      {
        timings_ms: { usb_file_matching: matchingElapsedMs },
        counts: {
          usb_files_matched: matchedCount,
          affected_tracks: affectedTrackIds.length,
        },
        bytes: { required_analysis_files: totalBytes },
      },
    );
  };

  const runCloudParsing = async (
    context: CloudParsingContext,
    fallbackToken: string,
    operation: number,
  ) => {
    const cloudController = new AbortController();
    const pollTimers = new AbortableTimerRegistry();
    cloudAbortControllerRef.current = cloudController;
    setParseProgress({
      currentTrackLabel: null,
      parsedTracks: context.tracksAlreadyReady,
      totalTracks: context.expectedTrackCount,
      percent: clampPct(
        context.expectedTrackCount > 0
          ? (context.tracksAlreadyReady / context.expectedTrackCount) * 100
          : 0,
      ),
    });
    setPhase('parsing_cloud_data');

    try {
      const queued = await requestWithAuthRetry(
        (token) => completeRekordboxImport(
          context.importId,
          token,
          {
            // A full USB import is server-authoritative. The backend already
            // persisted the manifest and knows which tracks remain pending, so
            // do not echo thousands of UUIDs back through /complete. Selective
            // track IDs remain supported by the dedicated resume workflow.
            clientMetrics: context.clientMetrics,
            signal: cloudController.signal,
          },
        ),
        fallbackToken,
      );

      if (queued.analysis_status === 'completed' && context.affectedTrackIds.length === 0) {
        setFinalResult({ kind: 'with_analysis', data: queued });
        setParseProgress({
          currentTrackLabel: null,
          parsedTracks: queued.total_tracks,
          totalTracks: queued.total_tracks,
          percent: 100,
        });
        setPhase('completed');
        return;
      }

      // When the user minimized during the USB transfer, the compact panel is
      // now the sole progress poller. Wait until this completion request has
      // successfully queued the worker before stopping the modal poll loop.
      if (localUploadBackgroundedRef.current) {
        backgroundedRef.current = true;
        return;
      }

      let consecutiveStatusPollFailures = 0;
      while (
        !backgroundedRef.current &&
        !cloudController.signal.aborted &&
        operation === operationRef.current
      ) {
        let status: Awaited<ReturnType<typeof fetchRekordboxAnalysisStatus>>;
        try {
          status = await requestWithAuthRetry(
            (token) => fetchRekordboxAnalysisStatus(
              context.importId,
              token,
              cloudController.signal,
              false,
            ),
            fallbackToken,
          );
          consecutiveStatusPollFailures = 0;
        } catch (error) {
          if (isAbortError(error) || operation !== operationRef.current || backgroundedRef.current) {
            throw error;
          }
          if (isTransientAnalysisStatusPollError(error)) {
            consecutiveStatusPollFailures += 1;
            if (consecutiveStatusPollFailures <= PARSE_STATUS_MAX_TRANSIENT_FAILURES) {
              await waitForAbortableDelay(
                PARSE_STATUS_POLL_MS,
                cloudController.signal,
                pollTimers,
              );
              continue;
            }
          }
          throw error;
        }
        if (operation !== operationRef.current || backgroundedRef.current) return;

        const totalTracks = status.expected_track_count || context.expectedTrackCount;
        const parsedTracks = Math.max(0, status.parsed_track_count || 0);
        const percent = typeof status.progress_percent === 'number'
          ? clampPct(status.progress_percent)
          : clampPct(totalTracks > 0 ? (parsedTracks / totalTracks) * 100 : 0);
        setParseProgress({
          currentTrackLabel: status.current_track_label || null,
          parsedTracks,
          totalTracks,
          percent,
        });
        setProgressiveReadiness({
          stage: status.readiness_stage?.replaceAll('_', ' ') ?? 'Analysis processing',
          tracksReady: status.tracks_ready_count ?? parsedTracks,
          tracksRemaining: status.tracks_remaining_count ?? Math.max(0, totalTracks - parsedTracks),
          throughput: status.measured_tracks_per_second ?? null,
          estimatedSecondsRemaining: status.estimated_seconds_remaining ?? null,
          optionalArchivalStatus: status.optional_archival_status ?? 'skipped',
          rawArchivalStatus: status.raw_archival_status ?? 'skipped',
        });

        if (
          status.analysis_status === 'interrupted' ||
          (status.worker_status === 'failed' && status.worker_active === false)
        ) {
          setErrorMessage(
            'Background analysis stopped unexpectedly. Your imported library and staged analysis files were kept, and analysis can be resumed without re-reading the USB.',
          );
          setPhase('interrupted');
          return;
        }

        if (['completed', 'partial', 'failed'].includes(status.analysis_status)) {
          // Progress polling deliberately uses the lightweight status view.
          // Fetch the exact track/asset breakdown once at terminal state so
          // final counts remain authoritative without paying O(library size)
          // every 2.5 seconds while analysis is active.
          status = await requestWithAuthRetry(
            (token) => fetchRekordboxAnalysisStatus(
              context.importId,
              token,
              cloudController.signal,
              true,
            ),
            fallbackToken,
          );
          const finalTotalTracks = status.expected_track_count || context.expectedTrackCount;
          const finalParsedTracks = Math.max(0, status.parsed_track_count || 0);
          const completeResponse: CompleteResponse = {
            import_id: context.importId,
            analysis_status: status.analysis_status,
            total_tracks: finalTotalTracks,
            completed_count: status.completed_track_count
              ?? Math.max(0, finalParsedTracks - status.failed_track_count),
            partial_count: status.partial_track_count ?? 0,
            failed_count: status.failed_track_count,
            missing_required_count: status.missing_required_count,
            missing_optional_ext_count: status.missing_optional_ext.length,
            missing_optional_2ex_count: 0,
            parser_version: status.parser_version ?? 'unknown',
            tracks: [],
            background_started: true,
            library_ready: status.library_ready ?? true,
            readiness_stage: status.readiness_stage ?? 'analysis_complete',
            queued_track_count: status.tracks_queued_count ?? 0,
            optional_archival_status: status.optional_archival_status ?? 'skipped',
            raw_archival_status: status.raw_archival_status ?? 'skipped',
          };
          setFinalResult({ kind: 'with_analysis', data: completeResponse });
          setPhase(status.analysis_status === 'completed' ? 'completed' : 'partial_success');
          return;
        }
        if (status.analysis_status === 'paused') {
          setPhase('paused');
          return;
        }

        await waitForAbortableDelay(
          PARSE_STATUS_POLL_MS,
          cloudController.signal,
          pollTimers,
        );
      }
    } catch (error) {
      if (isAbortError(error) && cancelRequestedRef.current) {
        await deleteCloudWork();
        return;
      }
      if (isAbortError(error) || operation !== operationRef.current || backgroundedRef.current) return;
      const extracted = extractError(error);
      setErrorMessage(extracted.message);
      setErrorStructured(extracted.structured);
      setPhase('failed');
    } finally {
      pollTimers.cancelAll();
      if (cloudAbortControllerRef.current === cloudController) {
        cloudAbortControllerRef.current = null;
      }
    }
  };

  // ── Import handler ───────────────────────────────────────────────────────────

  const handleImport = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setErrorMessage('You must be signed in to import a library.');
      setPhase('failed');
      return;
    }

    let sourceFile = mode === 'usb_folder' ? folderScanRef.current?.dbFile ?? null : selectedFileRef.current;
    if (!sourceFile) return;
    const sourceFilename = sourceFile.name;

    prepareLocalUsbLifecycle();
    const token = session.access_token;
    accessTokenRef.current = token;
    const controller = new AbortController();
    localAbortControllerRef.current = controller;
    const operation = ++operationRef.current;

    try {
      setLocalUsbStage(mode === 'zip_bundle' ? 'uploading_bundle' : 'uploading_database');
      setPhase('uploading_usb_data');
      // Each USB has its own id, so libraries from two USBs with the same name stay apart.
      const usbDeviceId = await resolveImportUsbDeviceId(session.user.id, folderScanRef.current?.folderName);
      const job = await runTrackedLocalRequest(() => createRekordboxImportJob(
        sourceFilename,
        mode,
        token,
        {
          deviceName: folderScanRef.current?.folderName,
          usbDeviceId,
          signal: controller.signal,
        },
      ));
      throwIfLocalCancellationRequested(controller);
      if (operation !== operationRef.current) return;
      importIdRef.current = job.import_id;
      onImportStarted?.(job.import_id);

      if (mode === 'database_only') {
        const result = await runTrackedLocalRequest(() => uploadRekordboxDb(
          sourceFile,
          token,
          {
            deviceName: folderScanRef.current?.folderName,
            signal: controller.signal,
            importId: job.import_id,
          },
        ));
        sourceFile = null;
        throwIfLocalCancellationRequested(controller);
        await verifyAndPublishUsbRelease();
        if (cancelRequestedRef.current) {
          await deleteCloudWork();
          return;
        }
        setFinalResult({ kind: 'library_only', data: result });
        setPhase('completed');
        return;
      }

      if (mode === 'zip_bundle') {
        const result = await runTrackedLocalRequest(() => uploadRekordboxZipBundle(
          sourceFile,
          token,
          (percent) => setProgress((current) => ({ ...current, bundlePct: percent })),
          controller.signal,
          job.import_id,
        ));
        sourceFile = null;
        throwIfLocalCancellationRequested(controller);
        await verifyAndPublishUsbRelease();
        if (cancelRequestedRef.current) {
          await deleteCloudWork();
          return;
        }
        setFinalResult({ kind: 'with_analysis', data: result });
        setPhase(result.analysis_status === 'completed' ? 'completed' : 'partial_success');
        return;
      }

      sourceFile = null;
      const cloudContext = await runUsbFolderUpload(token, controller, job.import_id, operation);
      await verifyAndPublishUsbRelease();
      if (cancelRequestedRef.current) {
        await deleteCloudWork();
        return;
      }

      await Promise.resolve();
      if (operation !== operationRef.current) return;
      await runCloudParsing(cloudContext, token, operation);
    } catch (error) {
      sourceFile = null;
      const cancelled = isAbortError(error) || controller.signal.aborted || localAbortRequestedRef.current;
      try {
        await verifyAndPublishUsbRelease();
      } catch (releaseError) {
        const extracted = extractError(releaseError);
        setErrorMessage(
          `DropDex could not verify that USB access ended. Keep Rekordbox closed and do not eject the drive. ${extracted.message}`,
        );
        setErrorStructured(extracted.structured);
        setPhase('failed');
        return;
      }

      if (cancelled) {
        if (cancelRequestedRef.current) await deleteCloudWork();
        return;
      }
      if (operation !== operationRef.current) return;
      const extracted = extractError(error);
      setErrorMessage(extracted.message);
      setErrorStructured(extracted.structured);
      setPhase('failed');
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      localAbortRequestedRef.current = true;
      uploadQueueRuntimeRef.current?.abortScheduling();
      retryTimersRef.current.cancelAll();
      localCleanupRoutineRef.current(false);
      if (!usbReleaseConfirmedRef.current) {
        cloudAbortControllerRef.current?.abort();
        cloudAbortControllerRef.current = null;
      }
      cloudCancellationControllerRef.current?.abort();
      cloudCancellationControllerRef.current = null;
      cloudCancellationTimersRef.current.cancelAll();
    };
  }, []);

  useEffect(() => {
    const activePhases: UsbImportPhase[] = [
      'uploading_usb_data',
      'stopping_usb_reads',
      'usb_released',
      'parsing_cloud_data',
      'deleting_import',
      'pausing_cloud_work',
    ];
    if (!activePhases.includes(phase) || !('wakeLock' in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let released = false;
    navigator.wakeLock.request('screen').then((sentinel) => {
      if (released) sentinel.release();
      else lock = sentinel;
    }).catch(() => { /* unavailable or document hidden — ignore */ });

    return () => {
      released = true;
      lock?.release();
    };
  }, [phase]);

  useEffect(() => {
    if (!localUsbAccessActive) return undefined;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      localAbortRequestedRef.current = true;
      uploadQueueRuntimeRef.current?.abortScheduling();
      retryTimersRef.current.cancelAll();
      localCleanupRoutineRef.current(false);
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [localUsbAccessActive]);

  // ── Derived display values ────────────────────────────────────────────────────

  const uploadPct =
    progress.bytesTotal > 0
      ? Math.round((progress.bytesUploaded / progress.bytesTotal) * 100)
      : progress.filesTotal > 0
      ? Math.round((progress.filesUploaded / progress.filesTotal) * 100)
      : progress.bundlePct;

  const isReady = mode === 'usb_folder' ? Boolean(folderScan?.dbFile) : Boolean(selectedFile);

  const withAnalysis =
    finalResult?.kind === 'with_analysis' ? finalResult.data : null;
  const libraryOnly =
    finalResult?.kind === 'library_only' ? finalResult.data : null;

  const unexpectedDbName =
    selectedFile &&
    mode !== 'zip_bundle' &&
    selectedFile.name.toLowerCase() !== 'exportlibrary.db';

  // ── Render ────────────────────────────────────────────────────────────────────

  const openIssueView = async () => {
    if (!withAnalysis) return;

    setIssueViewOpen(true);
    if (!issueTracks) {
      setIssueTracksLoading(true);
      try {
        const { data } = await supabase
          .from('rekordbox_tracks')
          .select('id, title, artist, analysis_parse_status, analysis_failure_reason, analysis_parse_warnings')
          .eq('import_id', withAnalysis.import_id)
          .in('analysis_parse_status', ['partial', 'failed', 'missing_required'])
          .order('title', { ascending: true });
        setIssueTracks(data ?? []);
      } catch {
        setIssueTracks([]);
      } finally {
        setIssueTracksLoading(false);
      }
    }
  };

  // Abort confirmation overlay — projects into ImportProgressModal covering header+stepper+body
  const abortDialogContent = showAbortDialog ? (
    <ImportAbortDialog
      intent={abortDialogIntent}
      localUsbAccessActive={localUsbAccessActive}
      onConfirm={confirmAbort}
      onKeepGoing={() => setShowAbortDialog(false)}
    />
  ) : undefined;

  const currentStep = phaseToStep(phase, localUsbStage, Boolean(importIdRef.current));

  const isSelectionPhase =
    phase === 'idle' || phase === 'database_selected' || phase === 'scanning_usb';

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          {/* Single persistent modal shell — same dimensions on every phase */}
          <ImportProgressModal
            currentStep={currentStep}
            stagePercent={currentStep === 'analyze' ? parseProgress.percent : currentStep === 'database' || currentStep === 'analysis-files' ? uploadPct : 0}
            status={phase === 'failed' ? 'failed' : undefined}
            ready={phase !== 'failed' && (isReady || !isSelectionPhase)}
            onClose={handleClose}
            abortOverlay={abortDialogContent}
          >

            {/* ── SOURCE: mode selection, folder/file picker ── */}
            {isSelectionPhase && (
              <ImportSourceScreen
                mode={mode}
                onModeChange={switchMode}
                isReady={isReady}
                scanning={phase === 'scanning_usb'}
                folderScan={phase === 'database_selected' ? folderScan : null}
                folderAllowsImport={Boolean(folderScan?.dbFile)}
                selectedFile={selectedFile}
                unexpectedDbName={Boolean(unexpectedDbName)}
                onSelectFolder={() => void handleUsbSourceSelect()}
                onPickFile={() => fileInputRef.current?.click()}
                onImport={handleImport}
                onCancel={handleClose}
                hiddenInputs={(
                  <>
                    <input ref={folderInputRef} type="file" webkitdirectory="" multiple className="hidden" onChange={handleFolderChange} />
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept={mode === 'zip_bundle' ? '.zip' : '.db'} />
                  </>
                )}
              />
            )}

            {/* ── DATABASE / ANALYSIS FILES: local USB upload ── */}
            {phase === 'uploading_usb_data' && (
              <ImportUploadScreen
                stage={localUsbStage as UploadStage}
                zipBundle={mode === 'zip_bundle'}
                progress={progress}
                bundleSize={selectedFile?.size ?? null}
                rejectedCount={rejectedCount}
                retryingCount={retryingCount}
                uploadPct={uploadPct}
                onCancel={() => openAbortDialog('delete')}
                onBackground={mode === 'usb_folder' && libraryMetadataReady ? handleContinueInBackground : undefined}
              />
            )}

            {/* ── ANALYSIS FILES → ANALYZE: USB teardown / USB released ── */}
            {phase === 'usb_released' && !cancelRequestedRef.current && <ImportUsbReleasedScreen />}

            {(phase === 'stopping_usb_reads' ||
              (phase === 'usb_released' && cancelRequestedRef.current) ||
              phase === 'deleting_import' ||
              phase === 'pausing_cloud_work') && (
              <ImportStoppingScreen
                usbReleaseConfirmed={usbReleaseConfirmed}
                cloudStepActive={cloudCancellationStarted || phase === 'deleting_import' || phase === 'pausing_cloud_work'}
                deleting={phase === 'deleting_import'}
              />
            )}

            {/* ── ANALYZE: cloud analysis running ── */}
            {phase === 'parsing_cloud_data' && (
              <ImportAnalysisScreen
                readiness={progressiveReadiness}
                parse={parseProgress}
                onPause={() => openAbortDialog('pause')}
                onBackground={handleContinueInBackground}
              />
            )}

            {phase === 'paused' && <ImportPausedScreen onDone={handleDone} />}

            {phase === 'interrupted' && <ImportInterruptedScreen message={errorMessage} onDone={handleDone} />}

            {/* ── COMPLETE: success ── */}
            {phase === 'completed' && (
              <ImportCompleteScreen usbReleaseConfirmed={usbReleaseConfirmed} withAnalysis={withAnalysis} libraryOnly={libraryOnly} reuseStats={reuseStats} onDone={handleDone} />
            )}

            {/* ── COMPLETE: partial success (summary + track issues sub-view) ── */}
            {phase === 'partial_success' && (
              <div className="relative overflow-hidden flex flex-col h-full">
                <AnimatePresence initial={false} mode="wait">
                  {!issueViewOpen ? (
                    <motion.div
                      key="summary"
                      initial={{ x: '-100%', opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: '-100%', opacity: 0 }}
                      transition={{ duration: 0.22, ease: 'easeInOut' }}
                      className="flex flex-col h-full"
                    >
                      <ImportPartialSummary usbReleaseConfirmed={usbReleaseConfirmed} withAnalysis={withAnalysis} reconciliation={reconciliation} onOpenIssues={() => void openIssueView()} onDone={handleDone} />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="issues"
                      initial={{ x: '100%', opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: '100%', opacity: 0 }}
                      transition={{ duration: 0.22, ease: 'easeInOut' }}
                      className="flex flex-col h-full"
                    >
                      <ImportIssuesScreen
                        tracks={issueTracks}
                        loading={issueTracksLoading}
                        expandedIds={expandedTrackIds}
                        onToggle={(id) => setExpandedTrackIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
                        onBack={() => setIssueViewOpen(false)}
                        onDone={handleDone}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* ── Cancellation ── */}
            {phase === 'cancelled' && <ImportCancelledScreen errorMessage={errorMessage} onReset={reset} />}

            {phase === 'failed' && (
              <ImportFailedScreen
                saveFailed={Boolean(errorStructured)}
                message={errorMessage}
                stage={errorStructured?.stage}
                diagnostic={errorStructured?.diagnostic}
                onRetry={reset}
                onCancel={() => { reset(); onClose(); }}
              />
            )}

          </ImportProgressModal>
        </div>
      )}
    </AnimatePresence>
  );
}
