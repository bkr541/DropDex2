// Non-standard HTML attribute used for folder selection
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface InputHTMLAttributes<T> {
    webkitdirectory?: '' | boolean;
  }
}

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Database,
  FileUp,
  FolderOpen,
  Loader2,
  Package,
  X,
} from 'lucide-react';
import { useUsbConnection } from '../contexts/UsbConnectionContext';
import { cn } from '../lib/utils';
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
import type { ManifestReconciliation } from '../lib/rekordbox/manifestReconciliation';
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

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = 'usb_folder' | 'zip_bundle' | 'database_only';

type LocalUsbStage = 'uploading_database' | 'matching_analysis' | 'uploading_analysis' | 'uploading_bundle';
type AbortDialogIntent = 'pause' | 'delete' | 'close';

interface FolderScan {
  dbFile: File | null;
  anlzFiles: File[];
  folderName: string;
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
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BATCH_SIZE = 50;
const MAX_BYTES_PER_BATCH = 50 * 1024 * 1024; // 50 MB
const MAX_CONCURRENT = 3;
const PARSE_STATUS_POLL_MS = 2500;
const CLOUD_CANCEL_POLL_MS = 1000;
const CLOUD_CANCEL_MAX_POLLS = 30;

const MODE_LABELS: Record<Mode, { label: string; icon: React.ReactNode; tip: string }> = {
  usb_folder: {
    label: 'USB Folder',
    icon: <FolderOpen size={14} />,
    tip: 'Select your USB drive root (e.g. "LUMA"), not the PIONEER subfolder. DropDex will find exportLibrary.db automatically, then upload only the matching analysis files. Your music files are not uploaded.',
  },
  zip_bundle: {
    label: 'ZIP Bundle',
    icon: <Package size={14} />,
    tip: 'Upload a ZIP archive containing exportLibrary.db and ANLZ files.',
  },
  database_only: {
    label: 'Database Only',
    icon: <Database size={14} />,
    tip: 'Upload exportLibrary.db to import playlists and track metadata without analysis data.',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extractError(err: unknown): { message: string; structured: ImportWriteError | null } {
  if (err instanceof RekordboxImportError) {
    return { message: err.message, structured: err.structured };
  }
  const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
  return { message, structured: null };
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function fmtEta(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `about ${hours} hr ${remainder} min` : `about ${hours} hr`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ImportLibraryModal({
  isOpen,
  accessToken,
  onClose,
  onSuccess,
  onImportStarted,
  onBackgrounded,
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
  const [rejectedCount, setRejectedCount] = useState(0);
  const [reuseStats, setReuseStats] = useState<ReuseStats | null>(null);
  const [reconciliation, setReconciliation] = useState<ManifestReconciliation | null>(null);
  const [retryingCount, setRetryingCount] = useState(0);
  const [libraryMetadataReady, setLibraryMetadataReady] = useState(false);
  const [progressiveReadiness, setProgressiveReadiness] = useState<ProgressiveReadiness>({
    stage: 'Library metadata ready',
    tracksReady: 0,
    tracksRemaining: 0,
    throughput: null,
    estimatedSecondsRemaining: null,
    optionalArchivalStatus: 'skipped',
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
    setShowAbortDialog(false);
    setAbortDialogIntent('delete');
    setRejectedCount(0);
    setReuseStats(null);
    setReconciliation(null);
    setRetryingCount(0);
    setProgressiveReadiness({
      stage: 'Library metadata ready',
      tracksReady: 0,
      tracksRemaining: 0,
      throughput: null,
      estimatedSecondsRemaining: null,
      optionalArchivalStatus: 'skipped',
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

  const deleteCloudWork = (): Promise<void> => {
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
          (token) => deleteRekordboxImport(id, token, cancellationController.signal),
          fallbackToken,
        );

        for (let poll = 0; poll < CLOUD_CANCEL_MAX_POLLS; poll += 1) {
          if (job.status === 'cancelled' || job.status === 'completed' || job.status === 'failed') break;
          await waitForAbortableDelay(
            CLOUD_CANCEL_POLL_MS,
            cancellationController.signal,
            cancellationTimers,
          );
          job = await requestWithAuthRetry(
            (token) => fetchRekordboxImportJob(id, token, cancellationController.signal),
            fallbackToken,
          );
        }

        if (!mountedRef.current) return;

        if (job.status === 'cancelled') {
          setPhase('cancelled');
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

  const openAbortDialog = (intent: AbortDialogIntent) => {
    setAbortDialogIntent(intent);
    setShowAbortDialog(true);
  };

  const handleClose = () => {
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
      if (abortDialogIntent === 'delete') void deleteCloudWork();
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
    if (!fileList || fileList.length === 0) return;

    setPhase('scanning_usb');
    const files = Array.from(fileList);
    const dbFile = findDatabaseFile(files);
    // Do not retain thousands of optional .2EX File handles in React state.
    // DAT/EXT are the only assets in the blocking fast path. Archival can be
    // performed later without delaying USB release or library readiness.
    const anlzFiles = files.filter(isBlockingAnlzFile);
    const folderName =
      (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath
        ?.split('/')[0] ?? 'Selected folder';

    setFolderScanResource({ dbFile, anlzFiles, folderName });
    setPhase('database_selected');
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
        'Please select a .db file. The rekordbox database is named exportLibrary.db.',
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
      stage: 'Library metadata ready',
      tracksReady: startResp.tracks_already_reusable ?? 0,
      tracksRemaining: affectedTrackIds.length,
      throughput: null,
      estimatedSecondsRemaining: null,
      optionalArchivalStatus: startResp.optional_archival_file_count
        ? 'skipped'
        : 'not needed',
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
    const matchingStartedAt = performance.now();
    const matchedFiles = buildMatchedFiles(scan.anlzFiles, startResp.manifest);
    const matchingElapsedMs = performance.now() - matchingStartedAt;
    const batches = buildBatches(matchedFiles, BATCH_SIZE, MAX_BYTES_PER_BATCH);
    matchedFilesRef.current = matchedFiles;
    uploadBatchesRef.current = batches;

    const totalBytes = matchedFiles.reduce((sum, item) => sum + item.file.size, 0);
    setProgress({
      filesUploaded: 0,
      filesTotal: matchedFiles.length,
      bytesUploaded: 0,
      bytesTotal: totalBytes,
      bundlePct: 0,
    });

    setLocalUsbStage('uploading_analysis');
    const accumulator = new UploadAccumulator();
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

    setRetryingCount(0);
    throwIfLocalCancellationRequested(controller);

    setReconciliation(buildManifestReconciliation(
      startResp.manifest,
      matchedFiles,
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
          usb_files_matched: matchedFiles.length,
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
            affectedTrackIds: context.affectedTrackIds,
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

      while (
        !backgroundedRef.current &&
        !cloudController.signal.aborted &&
        operation === operationRef.current
      ) {
        const status = await requestWithAuthRetry(
          (token) => fetchRekordboxAnalysisStatus(
            context.importId,
            token,
            cloudController.signal,
          ),
          fallbackToken,
        );
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
        });

        if (['completed', 'partial', 'failed'].includes(status.analysis_status)) {
          const completeResponse: CompleteResponse = {
            import_id: context.importId,
            analysis_status: status.analysis_status,
            total_tracks: totalTracks,
            completed_count: status.completed_track_count
              ?? Math.max(0, parsedTracks - status.failed_track_count),
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
      const job = await runTrackedLocalRequest(() => createRekordboxImportJob(
        sourceFilename,
        mode,
        token,
        {
          deviceName: folderScanRef.current?.folderName,
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

  const withAnalysis =
    finalResult?.kind === 'with_analysis' ? finalResult.data : null;
  const libraryOnly =
    finalResult?.kind === 'library_only' ? finalResult.data : null;

  const unexpectedDbName =
    selectedFile &&
    mode !== 'zip_bundle' &&
    selectedFile.name.toLowerCase() !== 'exportlibrary.db';

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative w-full max-w-xl bg-[var(--color-panel)] border border-[var(--color-border-subtle)] p-8 rounded-3xl shadow-2xl"
          >
            {/* ── Abort confirmation overlay ── */}
            <AnimatePresence>
              {showAbortDialog && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 rounded-3xl p-8"
                >
                  <div className="bg-[var(--color-panel)] border border-[var(--color-border-subtle)] rounded-2xl p-6 text-center max-w-xs w-full">
                    <AlertTriangle className="mx-auto mb-3 text-amber-400" size={28} />
                    <p className="font-bold text-lg mb-2">
                      {abortDialogIntent === 'pause'
                        ? 'Pause analysis?'
                        : abortDialogIntent === 'close'
                          ? 'Close and delete import?'
                          : 'Permanently delete import?'}
                    </p>
                    <p className="text-sm text-muted-foreground mb-5">
                      {abortDialogIntent === 'pause'
                        ? 'The USB is already released. DropDex will stop the cloud worker at a safe checkpoint and retain completed tracks and uploaded assets for resume.'
                        : localUsbAccessActive
                          ? 'DropDex will stop USB reads, prove the drive is released, wait for the cloud worker to acknowledge stop, then delete DropDex cloud data.'
                          : 'This permanently deletes the DropDex import, uploaded analysis assets, and parsed records after the worker acknowledges it has stopped writing.'}
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={confirmAbort}
                        className={cn(
                          'flex-1 py-3 text-white rounded-xl font-bold transition-colors',
                          abortDialogIntent === 'pause'
                            ? 'bg-primary hover:bg-primary/90'
                            : 'bg-red-500 hover:bg-red-600',
                        )}
                      >
                        {abortDialogIntent === 'pause'
                          ? 'Pause Analysis'
                          : abortDialogIntent === 'close'
                            ? 'Stop and delete'
                            : 'Delete Import and Data'}
                      </button>
                      <button
                        onClick={() => setShowAbortDialog(false)}
                        className="flex-1 py-3 glass rounded-xl font-bold text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Keep going
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Header ── */}
            {(phase === 'idle' || phase === 'database_selected' || phase === 'scanning_usb') && (
              <div className="flex items-start justify-between mb-6">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center shrink-0">
                  <Database className="text-primary" size={22} />
                </div>
                <button
                  onClick={handleClose}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1"
                >
                  <X size={18} />
                </button>
              </div>
            )}

            {/* ── Mode tabs (idle / selected) ── */}
            {(phase === 'idle' || phase === 'database_selected' || phase === 'scanning_usb') && (
              <>
                <h2 className="text-2xl font-bold mb-4">Import Rekordbox Library</h2>

                {/* Mode selector */}
                <div className="flex gap-1.5 p-1 bg-[var(--color-surface)] rounded-xl mb-5">
                  {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => switchMode(m)}
                      className={cn(
                        'flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-semibold transition-all',
                        mode === m
                          ? 'bg-primary text-white shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {MODE_LABELS[m].icon}
                      {MODE_LABELS[m].label}
                      {m === 'usb_folder' && (
                        <span className="text-[9px] bg-white/20 rounded px-1 leading-4">
                          REC
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                  {MODE_LABELS[mode].tip}
                </p>

                {/* USB Folder picker */}
                {mode === 'usb_folder' && (
                  <>
                    {phase === 'database_selected' && folderScan ? (
                      <div className="rounded-2xl border border-[var(--color-border-subtle)] p-4 mb-4">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                          {folderScan.folderName}
                        </p>
                        <div className="space-y-2">
                          {folderScan.dbFile ? (
                            <div className="flex items-center gap-2 text-sm">
                              <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                              <span className="font-mono text-xs truncate">
                                {folderScan.dbFile.name}
                              </span>
                              <span className="text-muted-foreground text-xs shrink-0">
                                {fmtBytes(folderScan.dbFile.size)}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-sm">
                              <AlertCircle size={14} className="text-red-400 shrink-0" />
                              <span className="text-red-400 text-xs">exportLibrary.db not found</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-sm">
                            {folderScan.anlzFiles.length > 0 ? (
                              <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                            ) : (
                              <AlertCircle size={14} className="text-amber-400 shrink-0" />
                            )}
                            <span className="text-xs">
                              {folderScan.anlzFiles.length.toLocaleString()} required DAT/EXT analysis file
                              {folderScan.anlzFiles.length !== 1 ? 's' : ''} found
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => folderInputRef.current?.click()}
                          className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          ← Choose different folder
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => folderInputRef.current?.click()}
                        className="w-full py-5 px-4 rounded-2xl border-2 border-dashed border-[var(--color-border-subtle)] hover:border-primary/40 hover:bg-primary/5 transition-all mb-4 text-center"
                      >
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <FolderOpen size={20} />
                          <p className="text-sm">Click to select USB drive folder</p>
                        </div>
                      </button>
                    )}

                    <input
                      ref={folderInputRef}
                      type="file"
                      webkitdirectory=""
                      multiple
                      className="hidden"
                      onChange={handleFolderChange}
                    />

                    <button
                      onClick={handleImport}
                      disabled={!folderScan?.dbFile}
                      className="w-full py-4 bg-primary text-white rounded-xl font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Import Library + Analysis
                    </button>
                  </>
                )}

                {/* ZIP Bundle / Database Only picker */}
                {(mode === 'zip_bundle' || mode === 'database_only') && (
                  <>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        'w-full py-5 px-4 rounded-2xl border-2 border-dashed transition-all mb-4 text-center',
                        selectedFile
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-[var(--color-border-subtle)] hover:border-primary/40 hover:bg-primary/5',
                      )}
                    >
                      {selectedFile ? (
                        <div>
                          <p className="text-sm font-bold font-mono truncate">{selectedFile.name}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {fmtBytes(selectedFile.size)} · Click to change
                          </p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <FileUp size={20} />
                          <p className="text-sm">
                            Click to select {mode === 'zip_bundle' ? '.zip bundle' : 'exportLibrary.db'}
                          </p>
                        </div>
                      )}
                    </button>

                    {unexpectedDbName && (
                      <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl mb-4">
                        <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-300 leading-relaxed">
                          Unexpected filename. The standard rekordbox database is named{' '}
                          <code className="font-mono">exportLibrary.db</code>. You can still try
                          importing.
                        </p>
                      </div>
                    )}

                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      className="hidden"
                      accept={mode === 'zip_bundle' ? '.zip' : '.db'}
                    />

                    <button
                      onClick={handleImport}
                      disabled={!selectedFile}
                      className="w-full py-4 bg-primary text-white rounded-xl font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {mode === 'zip_bundle' ? 'Import Bundle' : 'Import Library'}
                    </button>
                  </>
                )}

                <button
                  onClick={handleClose}
                  className="mt-3 w-full text-muted-foreground text-sm hover:text-foreground transition-colors py-2"
                >
                  Cancel
                </button>
              </>
            )}

            {/* ── Local USB access ── */}
            {phase === 'uploading_usb_data' && (
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Loader2 className="animate-spin text-primary" size={28} />
                </div>
                <h2 className="text-xl font-bold mb-2">
                  {localUsbStage === 'uploading_database' && 'Uploading Rekordbox Database…'}
                  {localUsbStage === 'matching_analysis' && 'Matching Analysis Files…'}
                  {localUsbStage === 'uploading_analysis' && 'Uploading Analysis Files…'}
                  {localUsbStage === 'uploading_bundle' && 'Uploading Bundle…'}
                </h2>

                <div className="mt-4 mb-5 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-left">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" />
                  <p className="text-xs leading-relaxed text-amber-100">
                    DropDex is currently reading this Rekordbox USB. Keep Rekordbox closed and do not eject the drive until DropDex confirms that USB access has ended.
                  </p>
                </div>

                {(localUsbStage === 'uploading_analysis' || localUsbStage === 'uploading_bundle') && (
                  <>
                    <div className="w-full h-2 bg-[var(--color-surface)] rounded-full overflow-hidden mb-3">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${uploadPct}%` }}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground mb-1">{uploadPct}%</p>
                    {mode !== 'zip_bundle' && progress.filesTotal > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {progress.filesUploaded.toLocaleString()} /{' '}
                        {progress.filesTotal.toLocaleString()} files accepted
                        {progress.bytesTotal > 0 && (
                          <> · {fmtBytes(progress.bytesUploaded)} / {fmtBytes(progress.bytesTotal)}</>
                        )}
                        {rejectedCount > 0 && (
                          <span className="text-amber-400"> · {rejectedCount.toLocaleString()} rejected</span>
                        )}
                      </p>
                    )}
                    {retryingCount > 0 && (
                      <p className="text-xs text-amber-400 mt-1">
                        Retrying {retryingCount} failed file{retryingCount !== 1 ? 's' : ''}…
                      </p>
                    )}
                    {mode === 'zip_bundle' && selectedFile && (
                      <p className="text-xs text-muted-foreground">{fmtBytes(selectedFile.size)}</p>
                    )}
                  </>
                )}

                {mode === 'usb_folder' && libraryMetadataReady && (
                  <div className="mt-6 space-y-2">
                    <button
                      type="button"
                      onClick={handleContinueInBackground}
                      className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white transition-all active:scale-[0.99]"
                    >
                      Browse Library in Background
                    </button>
                    <p className="text-[10px] leading-relaxed text-amber-200">
                      Keep the USB connected and Rekordbox closed until the background panel confirms USB access is released.
                    </p>
                  </div>
                )}

                <button
                  onClick={() => openAbortDialog('delete')}
                  className="mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel import
                </button>
              </div>
            )}

            {/* ── Normal verified USB release ── */}
            {phase === 'usb_released' && !cancelRequestedRef.current && (
              <div className="space-y-4 py-4 text-center">
                <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="text-emerald-400" size={28} />
                </div>
                <h2 className="text-xl font-bold">USB Access Released</h2>
                <p className="text-sm text-muted-foreground">
                  USB reading is complete. DropDex is continuing from uploaded copies and no longer needs the USB.
                </p>
              </div>
            )}

            {/* ── Verified USB release / cancellation sequence ── */}
            {(phase === 'stopping_usb_reads' ||
              (phase === 'usb_released' && cancelRequestedRef.current) ||
              phase === 'deleting_import' ||
              phase === 'pausing_cloud_work') && (
              <div className="space-y-5 py-4">
                <div className="text-center">
                  <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
                    {usbReleaseConfirmed ? (
                      <CheckCircle2 className="text-emerald-400" size={28} />
                    ) : (
                      <Loader2 className="animate-spin text-amber-400" size={28} />
                    )}
                  </div>
                  <h2 className="text-xl font-bold mb-2">
                    {usbReleaseConfirmed ? 'USB Access Released' : 'Stopping USB Reads…'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {usbReleaseConfirmed
                      ? 'USB reading is complete. DropDex is continuing from uploaded copies and no longer needs the USB.'
                      : 'Waiting only for active local upload requests to stop. No new batch or retry can begin.'}
                  </p>
                </div>

                <div className="space-y-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4">
                  <SafetyStep
                    label="Stopping local USB reads"
                    complete={usbReleaseConfirmed}
                    active={!usbReleaseConfirmed}
                  />
                  <SafetyStep
                    label="USB access released"
                    complete={usbReleaseConfirmed}
                    active={false}
                  />
                  <SafetyStep
                    label={phase === 'deleting_import' ? 'Stopping worker before delete' : 'Stopping cloud analysis'}
                    complete={false}
                    active={
                      cloudCancellationStarted
                      || phase === 'deleting_import'
                      || phase === 'pausing_cloud_work'
                    }
                  />
                </div>

                {!usbReleaseConfirmed && (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" />
                    <p className="text-xs leading-relaxed text-amber-100">
                      Keep Rekordbox closed and do not eject the drive until the USB access released step is checked.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── Cloud parsing, no File objects retained ── */}
            {phase === 'parsing_cloud_data' && (
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Loader2 className="animate-spin text-primary" size={28} />
                </div>
                <h2 className="text-xl font-bold mb-2">Library Ready, Analysis Running</h2>
                <div className="mb-5 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-left">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" />
                  <p className="text-xs leading-relaxed text-emerald-100">
                    USB reading is complete. DropDex is continuing from uploaded copies and no longer needs the USB. You may open Rekordbox or eject the drive.
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 text-left text-xs">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Current stage</span>
                    <span className="font-semibold capitalize text-foreground">{progressiveReadiness.stage}</span>
                  </div>
                  <div className="mt-2 flex justify-between gap-4">
                    <span className="text-muted-foreground">Tracks ready</span>
                    <span className="font-semibold text-foreground">{progressiveReadiness.tracksReady.toLocaleString()}</span>
                  </div>
                  <div className="mt-2 flex justify-between gap-4">
                    <span className="text-muted-foreground">Tracks remaining</span>
                    <span className="font-semibold text-foreground">{progressiveReadiness.tracksRemaining.toLocaleString()}</span>
                  </div>
                  <div className="mt-2 flex justify-between gap-4">
                    <span className="text-muted-foreground">Estimate</span>
                    <span className="font-semibold text-foreground">
                      {progressiveReadiness.estimatedSecondsRemaining != null
                        ? fmtEta(progressiveReadiness.estimatedSecondsRemaining)
                        : 'Measuring throughput…'}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between gap-4">
                    <span className="text-muted-foreground">Optional .2EX archival</span>
                    <span className="font-semibold capitalize text-foreground">{progressiveReadiness.optionalArchivalStatus}</span>
                  </div>
                </div>
                <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
                  Processing{' '}
                  <span className="font-semibold text-foreground">
                    {parseProgress.currentTrackLabel || 'queued tracks…'}
                  </span>
                </p>
                <div className="mt-5">
                  <div className="w-full h-2 bg-[var(--color-surface)] rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{ width: `${parseProgress.percent}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {parseProgress.percent}%
                    {parseProgress.totalTracks > 0 && (
                      <>
                        {' '}·{' '}
                        {Math.min(parseProgress.parsedTracks, parseProgress.totalTracks).toLocaleString()}
                        {' '} / {parseProgress.totalTracks.toLocaleString()} tracks
                      </>
                    )}
                  </p>
                </div>
                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={handleContinueInBackground}
                    className="rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white transition-all active:scale-[0.99]"
                  >
                    Continue in Background
                  </button>
                  <button
                    type="button"
                    onClick={() => openAbortDialog('pause')}
                    className="rounded-xl border border-primary/40 px-4 py-3 text-sm font-bold text-primary transition-colors hover:bg-primary/10"
                  >
                    Pause Analysis
                  </button>
                  <button
                    type="button"
                    onClick={() => openAbortDialog('delete')}
                    className="sm:col-span-2 rounded-xl border border-red-500/30 px-4 py-2.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/10"
                  >
                    Delete Import and Cloud Data
                  </button>
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                  Pause keeps completed work and retained uploads for resume. Delete waits for worker shutdown before removing cloud data. Neither action needs the USB.
                </p>
              </div>
            )}

            {phase === 'paused' && (
              <div className="space-y-5 py-4 text-center">
                <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="text-amber-300" size={28} />
                </div>
                <h2 className="text-xl font-bold">Analysis Paused Safely</h2>
                <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-left">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" />
                  <p className="text-xs leading-relaxed text-emerald-100">
                    USB activity is zero. The cloud worker acknowledged that it stopped writing. Completed tracks and uploaded assets were retained for resume from Import History.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDone}
                  className="w-full rounded-xl bg-primary px-4 py-3 font-bold text-white"
                >
                  Done
                </button>
              </div>
            )}

            {/* ── Success ── */}
            {phase === 'completed' && (
              <div className="text-center">
                <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="text-emerald-400" size={28} />
                </div>
                <h2 className="text-xl font-bold mb-1">
                  {withAnalysis ? 'Library Imported with Analysis!' : 'Library Imported!'}
                </h2>

                {usbReleaseConfirmed && (
                  <div className="my-4 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-left">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-400" />
                    <p className="text-xs leading-relaxed text-emerald-100">
                      USB reading is complete. DropDex no longer needs the USB.
                    </p>
                  </div>
                )}

                {withAnalysis && (
                  <p className="text-sm text-muted-foreground mb-5">
                    {withAnalysis.completed_count.toLocaleString()} tracks fully analysed.
                  </p>
                )}
                {libraryOnly && (
                  <p className="text-sm text-muted-foreground mb-5">
                    <code className="font-mono text-xs">{libraryOnly.source_filename}</code> imported
                    successfully.
                  </p>
                )}

                {/* Stats grid */}
                {withAnalysis && (
                  <div className="grid grid-cols-3 gap-2 mb-5">
                    {[
                      { label: 'Tracks', value: withAnalysis.total_tracks.toLocaleString() },
                      { label: 'Analysed', value: withAnalysis.completed_count.toLocaleString() },
                      { label: 'Parser', value: withAnalysis.parser_version },
                    ].map(({ label, value }) => (
                      <div key={label} className="glass rounded-xl p-3">
                        <p className="text-lg font-black font-mono truncate" title={String(value)}>
                          {value}
                        </p>
                        <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">
                          {label}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Optional waveform/archival gaps never affect readiness. */}
                {withAnalysis && (withAnalysis.missing_optional_ext_count > 0 || withAnalysis.missing_optional_2ex_count > 0) && (
                  <div className="mb-4 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 text-left">
                    <p className="text-[9px] uppercase tracking-widest text-amber-400/80 font-bold mb-2">
                      Optional Waveforms
                    </p>
                    <div className="space-y-1">
                      {withAnalysis.missing_optional_ext_count > 0 && (
                        <SummaryRow label="Missing color waveform (EXT)" value={withAnalysis.missing_optional_ext_count} />
                      )}
                      {withAnalysis.missing_optional_2ex_count > 0 && (
                        <SummaryRow label="Optional .2EX not archived" value={withAnalysis.missing_optional_2ex_count} />
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
                      Optional assets do not affect library readiness or track analysis.
                    </p>
                  </div>
                )}

                {/* Reuse summary (only shown when incremental reuse occurred) */}
                {reuseStats && reuseStats.tracksReused > 0 && (
                  <div className="mb-5 p-3 rounded-xl bg-primary/5 border border-primary/15 text-left">
                    <p className="text-[9px] uppercase tracking-widest text-primary/70 font-bold mb-2">
                      Reuse Summary
                    </p>
                    <div className="space-y-1">
                      {reuseStats.tracksReused > 0 && (
                        <ReuseRow label="Reused unchanged" value={reuseStats.tracksReused} />
                      )}
                      {reuseStats.tracksNeedingUpload > 0 && (
                        <ReuseRow label="Uploaded" value={reuseStats.tracksNeedingUpload} />
                      )}
                      {reuseStats.tracksReparsedFromRetained > 0 && (
                        <ReuseRow label="Reparsed from retained" value={reuseStats.tracksReparsedFromRetained} />
                      )}
                      {reuseStats.tracksMetadataOnly > 0 && (
                        <ReuseRow label="Metadata refreshed" value={reuseStats.tracksMetadataOnly} />
                      )}
                    </div>
                  </div>
                )}

                {libraryOnly && (
                  <>
                    <div className="grid grid-cols-2 gap-2 mb-5">
                      {[
                        { label: 'Tracks', value: libraryOnly.track_count.toLocaleString() },
                        { label: 'Playlists', value: libraryOnly.playlist_count },
                      ].map(({ label, value }) => (
                        <div key={label} className="glass rounded-xl p-3">
                          <p className="text-lg font-black font-mono">{value}</p>
                          <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">
                            {label}
                          </p>
                        </div>
                      ))}
                    </div>

                    {libraryOnly.playlists.length > 0 && (
                      <div className="text-left mb-5 max-h-40 overflow-y-auto space-y-1 pr-1">
                        {libraryOnly.playlists.map((pl) => (
                          <div
                            key={`${pl.name}-${pl.track_count}`}
                            className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--color-surface)]"
                          >
                            <span className="text-xs font-medium truncate">{pl.name}</span>
                            <span className="text-[10px] font-mono text-muted-foreground shrink-0 ml-2">
                              {pl.track_count.toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                <button
                  onClick={handleDone}
                  className="w-full py-4 bg-primary text-white rounded-xl font-bold transition-all active:scale-95"
                >
                  Done
                </button>
              </div>
            )}

            {/* ── Partial success ── */}
            {phase === 'partial_success' && (
              <div className="text-center">
                <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <AlertTriangle className="text-amber-400" size={28} />
                </div>
                <h2 className="text-xl font-bold mb-2">Library Imported with Warnings</h2>
                {usbReleaseConfirmed && (
                  <div className="my-4 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-left">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-400" />
                    <p className="text-xs leading-relaxed text-emerald-100">
                      USB reading is complete. DropDex no longer needs the USB.
                    </p>
                  </div>
                )}
                {withAnalysis && (
                    <>
                      <p className="text-sm text-muted-foreground mb-5">
                        {withAnalysis.completed_count.toLocaleString()} tracks fully parsed ·{' '}
                        {(
                          withAnalysis.partial_count +
                          withAnalysis.failed_count +
                          withAnalysis.missing_required_count
                        ).toLocaleString()}{' '}
                        with issues
                      </p>

                      {/* Track-level counts */}
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        {[
                          { label: 'Parsed', value: withAnalysis.completed_count.toLocaleString() },
                          { label: 'Partial parse', value: withAnalysis.partial_count.toLocaleString() },
                          { label: 'Parse failed', value: withAnalysis.failed_count.toLocaleString() },
                          { label: 'Missing DAT', value: withAnalysis.missing_required_count.toLocaleString() },
                        ].map(({ label, value }) => (
                          <div key={label} className="glass rounded-xl p-3">
                            <p className="text-lg font-black font-mono">{value}</p>
                            <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">
                              {label}
                            </p>
                          </div>
                        ))}
                      </div>

                      {/* File-level upload summary from reconciliation */}
                      {reconciliation && (reconciliation.failedFiles > 0 || reconciliation.missingFiles > 0 || withAnalysis.missing_optional_ext_count > 0 || withAnalysis.missing_optional_2ex_count > 0) && (
                        <div className="mb-4 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 text-left">
                          <p className="text-[9px] uppercase tracking-widest text-amber-400/80 font-bold mb-2">
                            File Summary
                          </p>
                          <div className="space-y-1">
                            <SummaryRow label="Uploaded" value={reconciliation.successfullyUploadedFiles} />
                            {reconciliation.failedFiles > 0 && (
                              <SummaryRow label="Failed after retries" value={reconciliation.failedFiles} warn />
                            )}
                            {reconciliation.missingFiles > 0 && (
                              <SummaryRow label="Not found on USB" value={reconciliation.missingFiles} warn />
                            )}
                            {withAnalysis.missing_optional_ext_count > 0 && (
                              <SummaryRow label="Missing color waveform (EXT)" value={withAnalysis.missing_optional_ext_count} />
                            )}
                            {withAnalysis.missing_optional_2ex_count > 0 && (
                              <SummaryRow label="Optional .2EX not archived" value={withAnalysis.missing_optional_2ex_count} />
                            )}
                          </div>
                          {(reconciliation.failedFiles > 0 || reconciliation.missingFiles > 0) && (
                            <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
                              Re-import from the same USB to retry — already-uploaded files are skipped.
                            </p>
                          )}
                        </div>
                      )}
                    </>
                )}

                <button
                  onClick={handleDone}
                  className="w-full py-4 bg-primary text-white rounded-xl font-bold transition-all active:scale-95"
                >
                  Done
                </button>
              </div>
            )}

            {/* ── Cancellation ── */}
            {phase === 'cancelled' && (
              <div className="space-y-4 py-4 text-center">
                <AlertCircle size={34} className="mx-auto text-amber-500" />
                <div>
                  <h3 className="font-semibold">Import cancelled</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    USB access was released before cloud cancellation completed. DropDex will not activate partial results.
                  </p>
                  {errorMessage && <p className="mt-2 text-sm text-destructive">{errorMessage}</p>}
                </div>
                <button type="button" onClick={reset} className="rounded-md border px-4 py-2 text-sm">
                  Start another import
                </button>
              </div>
            )}

            {phase === 'failed' && (
              <div className="text-center">
                <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <AlertCircle className="text-red-400" size={28} />
                </div>
                <h2 className="text-xl font-bold mb-2">
                  {errorStructured ? 'Library Parsed, Save Failed' : 'Import Failed'}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed px-2">
                  {errorMessage}
                </p>
                {errorStructured?.stage && (
                  <div className="mt-3 text-left rounded-xl bg-[var(--color-surface)] p-3 text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Stage:</span>
                      <code className="font-mono text-amber-300">{errorStructured.stage}</code>
                    </div>
                    {errorStructured.diagnostic && (
                      <div className="flex items-start gap-2">
                        <span className="text-muted-foreground shrink-0">Hint:</span>
                        <span className="text-foreground">{errorStructured.diagnostic}</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={reset}
                    className="flex-1 py-3 bg-primary text-white rounded-xl font-bold transition-all active:scale-95"
                  >
                    Try Again
                  </button>
                  <button
                    onClick={() => { reset(); onClose(); }}
                    className="flex-1 py-3 glass rounded-xl font-bold text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}


function SafetyStep({
  label,
  complete,
  active,
}: {
  label: string;
  complete: boolean;
  active: boolean;
}) {
  return (
    <div className="flex items-center gap-3 text-left">
      {complete ? (
        <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
      ) : active ? (
        <Loader2 size={16} className="shrink-0 animate-spin text-amber-400" />
      ) : (
        <div className="h-4 w-4 shrink-0 rounded-full border border-[var(--color-border-subtle)]" />
      )}
      <span className={cn('text-xs', complete ? 'text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>
    </div>
  );
}

function ReuseRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono font-bold text-primary/80">{value.toLocaleString()}</span>
    </div>
  );
}

function SummaryRow({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-mono font-bold ${warn ? 'text-amber-400' : 'text-foreground/70'}`}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}
