// Non-standard HTML attribute used for folder selection
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface InputHTMLAttributes<T> {
    webkitdirectory?: '' | boolean;
  }
}

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useUsbConnection } from '../contexts/UsbConnectionContext';
import { supabase } from '../lib/supabase';
import {
  fetchRekordboxAnalysisStatus,
  resumeRekordboxAnalysis,
} from '../lib/api/rekordboxImport';
import type { AnalysisStatusResponse, CompleteResponse } from '../lib/api/rekordboxImport';
import { buildBatches, isAnlzFile, type MatchedAnalysisFile } from '../lib/rekordbox/analysisPaths';
import { buildResumeTargets, buildResumeMatchResult, buildStatusSummary, resumeRequiresUsbSelection } from '../lib/rekordbox/resumeAnalysis';
import type { ResumeTarget, ResumeStatusSummary } from '../lib/rekordbox/resumeAnalysis';
import { UploadAccumulator } from '../lib/rekordbox/analysisUploadResults';
import { isAbortError, uploadBatchWithRetry } from '../lib/rekordbox/uploadBatch';
import { AbortableTimerRegistry, waitForAbortableDelay } from '../lib/rekordbox/abortableRetry';
import { isFreshImportResponse } from '../lib/rekordbox/importRequestFreshness';
import { runCancellableUploadQueue, UploadQueueRuntime } from '../lib/rekordbox/cancellableUploadQueue';
import { IdempotentUsbCleanup, verifyUsbReleased } from '../lib/rekordbox/localUsbLifecycle';
import { CheckmarkFilled, CircleDash, Close, FolderOpen, Renew, WarningAlt } from '@carbon/icons-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type ResumePhase =
  | 'fetching_status'
  | 'scan_prompt'
  | 'uploading'
  | 'stopping_usb_reads'
  | 'parsing'
  | 'done'
  | 'done_partial'
  | 'error';

interface ResumeMatchSummary {
  matched: number;
  stillMissingRequired: number;
  stillMissingOptional: number;
}

interface ResumeProgress {
  filesUploaded: number;
  filesTotal: number;
  bytesUploaded: number;
  bytesTotal: number;
}

interface Props {
  isOpen: boolean;
  importId: string;
  onClose: () => void;
  onSuccess: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BATCH_SIZE = 50;
const MAX_BYTES_PER_BATCH = 50 * 1024 * 1024; // 50 MB
const MAX_CONCURRENT = 3;
const FILE_RETRY_DELAYS_MS = [500, 1000];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pluralFiles(n: number) {
  return `${n.toLocaleString()} file${n !== 1 ? 's' : ''}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ResumeAnalysisModal({ isOpen, importId, onClose, onSuccess }: Props) {
  const { release: releaseUsb } = useUsbConnection();
  const [phase, setPhase] = useState<ResumePhase>('fetching_status');
  const [status, setStatus] = useState<AnalysisStatusResponse | null>(null);
  const [targets, setTargets] = useState<ResumeTarget[]>([]);
  const [statusSummary, setStatusSummary] = useState<ResumeStatusSummary | null>(null);
  const [matchSummary, setMatchSummary] = useState<ResumeMatchSummary | null>(null);
  const [progress, setProgress] = useState<ResumeProgress>({ filesUploaded: 0, filesTotal: 0, bytesUploaded: 0, bytesTotal: 0 });
  const [completeResp, setCompleteResp] = useState<CompleteResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [retryingCount, setRetryingCount] = useState(0);
  const [wrongDrive, setWrongDrive] = useState(false);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const retryTimersRef = useRef(new AbortableTimerRegistry());
  const uploadQueueRuntimeRef = useRef<UploadQueueRuntime | null>(null);
  const scannedFilesRef = useRef<File[]>([]);
  const matchedFilesRef = useRef<MatchedAnalysisFile[]>([]);
  const uploadBatchesRef = useRef<MatchedAnalysisFile[][]>([]);
  const retryFilesByPathRef = useRef<Map<string, MatchedAnalysisFile>>(new Map());
  const usbCleanupRef = useRef(new IdempotentUsbCleanup());
  const closeAfterUsbStopRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const activeImportIdRef = useRef(importId);
  activeImportIdRef.current = importId;

  const isCurrentOperation = useCallback((
    requestedImportId: string,
    generation: number,
    controller: AbortController,
  ): boolean => {
    return !controller.signal.aborted
      && requestedImportId === activeImportIdRef.current
      && generation === requestGenerationRef.current;
  }, []);

  const performResumeUsbCleanup = useCallback((abortController = true) => {
    usbCleanupRef.current.run(() => {
      // Resume Analysis is read-only: stop requests and release browser File
      // references only. Never request a writable handle or mutate the USB.
      uploadQueueRuntimeRef.current?.abortScheduling();
      retryTimersRef.current.cancelAll();
      if (abortController) {
        controllerRef.current?.abort();
        controllerRef.current = null;
      }

      scannedFilesRef.current.length = 0;
      matchedFilesRef.current.length = 0;
      for (const batch of uploadBatchesRef.current) batch.length = 0;
      uploadBatchesRef.current.length = 0;
      retryFilesByPathRef.current.clear();
      if (folderInputRef.current) folderInputRef.current.value = '';
    });
  }, []);

  const releaseUsbBeforeCloudParsing = useCallback(async () => {
    const desktopRelease = await releaseUsb();
    if (desktopRelease && !desktopRelease.allStreamsClosed) {
      throw new Error(
        `Electron USB release timed out with ${desktopRelease.remainingStreamCount} active stream(s).`,
      );
    }
  }, [releaseUsb]);

  const runParsing = useCallback(async (
    impId: string,
    tok: string,
    ac: AbortController,
    generation: number,
    affectedIds?: string[],
  ) => {
    if (!isCurrentOperation(impId, generation, ac)) return;
    setPhase('parsing');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!isCurrentOperation(impId, generation, ac)) return;
      const finalTok = session?.access_token ?? tok;
      const resp = await resumeRekordboxAnalysis(impId, finalTok, {
        affectedTrackIds: affectedIds,
        signal: ac.signal,
      });
      if (!isFreshImportResponse({
        requestedImportId: impId,
        currentImportId: activeImportIdRef.current,
        responseImportId: resp.import_id,
        requestGeneration: generation,
        currentGeneration: requestGenerationRef.current,
        aborted: ac.signal.aborted,
      })) return;
      setCompleteResp(resp);
      setPhase(resp.analysis_status === 'completed' ? 'done' : 'done_partial');
    } catch (err) {
      if (isAbortError(err) || !isCurrentOperation(impId, generation, ac)) return;
      setErrorMessage(err instanceof Error ? err.message : 'Analysis reprocessing failed.');
      setPhase('error');
    }
  }, [isCurrentOperation]);

  // Fetch analysis status on open
  useEffect(() => {
    if (!isOpen) return;
    performResumeUsbCleanup();
    controllerRef.current?.abort();
    setPhase('fetching_status');
    setStatus(null);
    setTargets([]);
    setStatusSummary(null);
    setMatchSummary(null);
    setCompleteResp(null);
    setErrorMessage('');
    setWrongDrive(false);
    closeAfterUsbStopRef.current = false;
    setRetryingCount(0);
    setProgress({ filesUploaded: 0, filesTotal: 0, bytesUploaded: 0, bytesTotal: 0 });

    const ac = new AbortController();
    const generation = ++requestGenerationRef.current;
    controllerRef.current = ac;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!isCurrentOperation(importId, generation, ac)) return;
        const tok = session?.access_token ?? '';
        const requestedImportId = importId;
        const resp = await fetchRekordboxAnalysisStatus(importId, tok, ac.signal);
        if (!isFreshImportResponse({
          requestedImportId,
          currentImportId: importId,
          responseImportId: resp.import_id,
          requestGeneration: generation,
          currentGeneration: requestGenerationRef.current,
          aborted: ac.signal.aborted,
        })) return;

        setStatus(resp);
        const t = buildResumeTargets(resp);
        setTargets(t);
        setStatusSummary(buildStatusSummary(resp));

        if (!resumeRequiresUsbSelection(t)) {
          // Required assets are already retained. Optional file gaps and parse
          // retries must not make the user reconnect the USB.
          setPhase('stopping_usb_reads');
          await releaseUsbBeforeCloudParsing();
          await runParsing(importId, tok, ac, generation);
        } else {
          setPhase('scan_prompt');
        }
      } catch (err) {
        if (isAbortError(err) || !isCurrentOperation(importId, generation, ac)) return;
        setErrorMessage(err instanceof Error ? err.message : 'Failed to fetch analysis status.');
        setPhase('error');
      }
    })();

    return () => {
      requestGenerationRef.current += 1;
      performResumeUsbCleanup();
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [importId, isCurrentOperation, isOpen, performResumeUsbCleanup, releaseUsbBeforeCloudParsing, runParsing]);

  function handleClose() {
    if (phase === 'stopping_usb_reads') return;
    if (phase === 'uploading') {
      const confirmed = window.confirm(
        'DropDex is still reading the Rekordbox USB. Stop the upload and close after active reads have settled?',
      );
      if (!confirmed) return;
      closeAfterUsbStopRef.current = true;
      requestGenerationRef.current += 1;
      setPhase('stopping_usb_reads');
      performResumeUsbCleanup();
      return;
    }

    requestGenerationRef.current += 1;
    closeAfterUsbStopRef.current = false;
    performResumeUsbCleanup();
    controllerRef.current?.abort();
    controllerRef.current = null;
    setMatchSummary(null);
    onClose();
  }

  function handleDone() {
    requestGenerationRef.current += 1;
    closeAfterUsbStopRef.current = false;
    performResumeUsbCleanup();
    controllerRef.current?.abort();
    controllerRef.current = null;
    setMatchSummary(null);
    onSuccess();
    onClose();
  }

  const handleFolderChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    performResumeUsbCleanup();
    usbCleanupRef.current = new IdempotentUsbCleanup();
    retryTimersRef.current = new AbortableTimerRegistry();
    uploadQueueRuntimeRef.current = null;

    const files = Array.from(e.target.files ?? []).filter(isAnlzFile);
    scannedFilesRef.current = files;
    e.target.value = '';

    const requestedImportId = importId;
    const generation = ++requestGenerationRef.current;
    controllerRef.current?.abort();
    const ac = new AbortController();
    controllerRef.current = ac;

    const result = buildResumeMatchResult(files, targets);
    matchedFilesRef.current = result.matched;
    if (!isCurrentOperation(requestedImportId, generation, ac)) return;
    setMatchSummary({
      matched: result.matched.length,
      stillMissingRequired: result.stillMissingRequired.length,
      stillMissingOptional: result.stillMissingOptional.length,
    });

    if (result.matched.length === 0) {
      setWrongDrive(true);
      performResumeUsbCleanup();
      return;
    }

    setWrongDrive(false);

    // ── Begin upload ──────────────────────────────────────────────────────────
    let intentionalUsbRelease = false;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!isCurrentOperation(requestedImportId, generation, ac)) return;
      const tok = session?.access_token ?? '';

      const batches = buildBatches(result.matched, BATCH_SIZE, MAX_BYTES_PER_BATCH);
      uploadBatchesRef.current = batches;
      const totalFiles = result.matched.length;
      const totalBytes = result.matched.reduce((s, f) => s + f.file.size, 0);

      setProgress({ filesUploaded: 0, filesTotal: totalFiles, bytesUploaded: 0, bytesTotal: totalBytes });
      setPhase('uploading');

      const accumulator = new UploadAccumulator();

      const runtime = new UploadQueueRuntime(batches.length);
      uploadQueueRuntimeRef.current = runtime;
      const queueResult = await runCancellableUploadQueue<MatchedAnalysisFile[], Awaited<ReturnType<typeof uploadBatchWithRetry>>>({
        batches,
        maxConcurrent: MAX_CONCURRENT,
        signal: ac.signal,
        runtime,
        isLocallyAborted: () => !isCurrentOperation(requestedImportId, generation, ac),
        isAbortError,
        isFailedResult: (response) => response === null,
        runBatch: (batch) => uploadBatchWithRetry(
          requestedImportId,
          batch,
          tok,
          ac.signal,
          3,
          {
            retryTimers: retryTimersRef.current,
            isLocallyAborted: () => !isCurrentOperation(requestedImportId, generation, ac),
          },
        ),
        onBatchSuccess: (response, batch) => {
          if (response === null) return;
          accumulator.addBatchResponse(response, batch);
          if (!isCurrentOperation(requestedImportId, generation, ac)) return;
          setProgress((current) => ({
            ...current,
            filesUploaded: accumulator.confirmedFiles,
            bytesUploaded: accumulator.confirmedBytes,
          }));
        },
        onBatchFailure: (_error, batch) => accumulator.recordFailedBatch(batch),
      });
      let uploadAborted = queueResult.cancelled || !isCurrentOperation(requestedImportId, generation, ac);

      // File-level retry for transient failures
      if (!uploadAborted) {
        const filesByLowerPath = new Map(result.matched.map((mf) => [mf.canonicalPath.toLowerCase(), mf]));
        retryFilesByPathRef.current = filesByLowerPath;
        for (let ri = 0; ri < FILE_RETRY_DELAYS_MS.length && !uploadAborted; ri++) {
          const retryPaths = accumulator.retryableFilePaths;
          if (retryPaths.length === 0) break;
          setRetryingCount(retryPaths.length);
          await waitForAbortableDelay(
            FILE_RETRY_DELAYS_MS[ri],
            ac.signal,
            retryTimersRef.current,
            () => !isCurrentOperation(requestedImportId, generation, ac),
          );
          if (!isCurrentOperation(requestedImportId, generation, ac)) {
            uploadAborted = true;
            break;
          }
          const retryBatch = retryPaths.map((p) => filesByLowerPath.get(p)).filter((mf): mf is NonNullable<typeof mf> => mf !== undefined);
          if (retryBatch.length === 0) break;
          const retryResp = await uploadBatchWithRetry(
            requestedImportId,
            retryBatch,
            tok,
            ac.signal,
            1,
            {
              retryTimers: retryTimersRef.current,
              isLocallyAborted: () => !isCurrentOperation(requestedImportId, generation, ac),
            },
          );
          if (!isCurrentOperation(requestedImportId, generation, ac)) {
            uploadAborted = true;
            break;
          }
          if (retryResp === null) break;
          for (const fr of retryResp.files) {
            if (fr.status === 'received' || fr.status === 'already_received') {
              accumulator.correctFileRetrySuccess(fr.canonical_path, fr.status as 'received' | 'already_received', fr.file_size);
            }
          }
          setProgress((p) => ({ ...p, filesUploaded: accumulator.confirmedFiles, bytesUploaded: accumulator.confirmedBytes }));
        }
        if (isCurrentOperation(requestedImportId, generation, ac)) setRetryingCount(0);
      }

      if (uploadAborted || !isCurrentOperation(requestedImportId, generation, ac)) {
        performResumeUsbCleanup();
        return;
      }

      // Selective reprocessing: only reparse tracks that received new files in this session.
      const uploadedTrackIds = [...new Set(
        result.matched.map((m) => m.trackId).filter((id): id is string => !!id),
      )];
      const affectedIds = uploadedTrackIds.length > 0 ? uploadedTrackIds : undefined;

      // Release every browser File reference before the ID-only cloud parsing call.
      intentionalUsbRelease = true;
      performResumeUsbCleanup();
      const queueSnapshot = uploadQueueRuntimeRef.current?.snapshot();
      const release = verifyUsbReleased({
        activeUploadRequests: queueSnapshot?.activeRequests ?? 0,
        queuedBatches: queueSnapshot?.queuedBatches ?? 0,
        retryTimerCount: retryTimersRef.current.activeCount,
        controllerActive: Boolean(controllerRef.current && !controllerRef.current.signal.aborted),
        databaseFileCount: 0,
        analysisFileCount: scannedFilesRef.current.length,
        matchedFileCount: matchedFilesRef.current.length,
        batchFileCount: uploadBatchesRef.current.reduce((count, batch) => count + batch.length, 0),
        pathMapCount: retryFilesByPathRef.current.size,
        objectUrlCount: 0,
        directoryHandleCount: 0,
      });
      if (!release.released) {
        throw new Error(`USB release verification failed: ${release.blockers.join(', ')}`);
      }
      await releaseUsbBeforeCloudParsing();

      setMatchSummary(null);
      setRetryingCount(0);
      const cloudController = new AbortController();
      controllerRef.current = cloudController;
      await runParsing(requestedImportId, tok, cloudController, generation, affectedIds);
    } catch (err) {
      const cancelled = isAbortError(err)
        || (!intentionalUsbRelease && !isCurrentOperation(requestedImportId, generation, ac));
      performResumeUsbCleanup();
      if (!cancelled) {
        setRetryingCount(0);
        setErrorMessage(err instanceof Error ? err.message : 'Analysis upload failed.');
        setPhase('error');
      }
    } finally {
      if (closeAfterUsbStopRef.current) {
        closeAfterUsbStopRef.current = false;
        setMatchSummary(null);
        onClose();
      }
    }
  }, [importId, isCurrentOperation, onClose, performResumeUsbCleanup, releaseUsbBeforeCloudParsing, runParsing, targets]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="relative z-10 w-full max-w-2xl glass rounded-3xl p-6 shadow-2xl border border-[var(--color-border-subtle)]"
          >
            {/* Close button */}
            {(phase === 'scan_prompt' || phase === 'error' || phase === 'done_partial') && (
              <button
                onClick={handleClose}
                className="absolute top-5 right-5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Close size={18} />
              </button>
            )}

            {/* ── Fetching status ── */}
            {phase === 'fetching_status' && (
              <div className="flex items-center gap-5 py-3">
                <CircleDash className="animate-spin text-primary shrink-0" size={32} />
                <div>
                  <h2 className="text-lg font-bold">Checking Analysis Status</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Loading missing file list…</p>
                </div>
              </div>
            )}

            {/* ── Scan prompt ── */}
            {phase === 'scan_prompt' && status && (
              <div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-amber-500/10 rounded-full flex items-center justify-center shrink-0">
                    <Renew className="text-amber-400" size={22} />
                  </div>
                  <h2 className="text-xl font-bold">Resume Analysis</h2>
                </div>

                {/* Grouped status summary */}
                {statusSummary && (
                  <div className="text-left space-y-1.5 mb-5 p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
                    {statusSummary.missingRequired > 0 && (
                      <SummaryRow label="Required DAT files missing" value={statusSummary.missingRequired} warn />
                    )}
                    {statusSummary.uploadFailed > 0 && (
                      <SummaryRow label="Upload failures (retryable)" value={statusSummary.uploadFailed} warn />
                    )}
                    {statusSummary.parseFailed > 0 && (
                      <SummaryRow label="Parse failures" value={statusSummary.parseFailed} warn />
                    )}
                    {statusSummary.missingOptional > 0 && (
                      <SummaryRow label="Optional color/detail files" value={statusSummary.missingOptional} />
                    )}
                    {statusSummary.affectedTracks > 0 && (
                      <SummaryRow label="Affected tracks" value={statusSummary.affectedTracks} />
                    )}
                  </div>
                )}

                {/* Legacy fallback for backends without structured targets */}
                {!statusSummary && (
                  <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                    {targets.filter((t) => t.required).length > 0 && (
                      <span className="text-amber-400 font-semibold">
                        {targets.filter((t) => t.required).length} required DAT file{targets.filter((t) => t.required).length !== 1 ? 's' : ''} missing
                      </span>
                    )}
                    {targets.filter((t) => t.required).length > 0 && targets.filter((t) => !t.required).length > 0 && ' · '}
                    {targets.filter((t) => !t.required).length > 0 && (
                      <span>
                        {targets.filter((t) => !t.required).length} optional file{targets.filter((t) => !t.required).length !== 1 ? 's' : ''} missing
                      </span>
                    )}
                  </p>
                )}

                {wrongDrive && (
                  <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-left">
                    <p className="text-xs text-red-400 font-semibold mb-1">No matching files found</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      The selected folder doesn't contain any of the missing ANLZ files. Make sure you're selecting the PIONEER folder on the correct USB drive.
                    </p>
                  </div>
                )}

                {matchSummary && !wrongDrive && (
                  <div className="mb-4 p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-left space-y-1.5">
                    <StatusRow label="Found on USB" value={matchSummary.matched} />
                    {matchSummary.stillMissingRequired > 0 && (
                      <StatusRow label="Still missing (required)" value={matchSummary.stillMissingRequired} warn />
                    )}
                    {matchSummary.stillMissingOptional > 0 && (
                      <StatusRow label="Still missing (optional)" value={matchSummary.stillMissingOptional} />
                    )}
                  </div>
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
                  onClick={() => folderInputRef.current?.click()}
                  className="w-full py-3.5 bg-primary text-white rounded-xl font-bold transition-all active:scale-95 hover:bg-primary/90 flex items-center justify-center gap-2"
                >
                  <FolderOpen size={16} />
                  {wrongDrive ? 'Select Different Folder' : 'Select PIONEER Folder on USB'}
                </button>
                <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
                  Only the {pluralFiles(targets.length)} listed as missing will be uploaded. Your music files are not read.
                </p>
              </div>
            )}

            {/* ── Uploading ── */}
            {phase === 'uploading' && (
              <div className="flex items-start gap-5 py-2">
                <div className="relative w-12 h-12 shrink-0">
                  <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                  <div className="relative w-12 h-12 bg-primary/15 rounded-full flex items-center justify-center">
                    <CircleDash className="animate-spin text-primary" size={22} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold">Uploading Missing Files</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    {progress.filesUploaded.toLocaleString()} / {progress.filesTotal.toLocaleString()} files
                    {progress.bytesTotal > 0 && (
                      <> · {fmtBytes(progress.bytesUploaded)} / {fmtBytes(progress.bytesTotal)}</>
                    )}
                  </p>
                  {retryingCount > 0 && (
                    <p className="text-xs text-amber-400 mt-1">
                      Retrying {retryingCount} failed file{retryingCount !== 1 ? 's' : ''}…
                    </p>
                  )}
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                    <WarningAlt size={14} className="mt-0.5 shrink-0 text-amber-400" />
                    <p className="text-xs leading-relaxed text-amber-100">
                      Keep Rekordbox closed and do not eject the drive until upload completes.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Stopping local USB reads ── */}
            {phase === 'stopping_usb_reads' && (
              <div className="flex items-center gap-5 py-3">
                <CircleDash className="animate-spin text-amber-400 shrink-0" size={30} />
                <div>
                  <h2 className="text-lg font-bold">Stopping USB Reads</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Keep Rekordbox closed until this window closes.</p>
                </div>
              </div>
            )}

            {/* ── Parsing ── */}
            {phase === 'parsing' && (
              <div className="flex items-start gap-5 py-2">
                <div className="relative w-12 h-12 shrink-0">
                  <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                  <div className="relative w-12 h-12 bg-primary/15 rounded-full flex items-center justify-center">
                    <CircleDash className="animate-spin text-primary" size={22} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold">Reprocessing Analysis</h2>
                  <p className="text-xs text-muted-foreground mt-1">Parsing waveform, cue, and beat data for affected tracks…</p>
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                    <CheckmarkFilled size={14} className="shrink-0 text-emerald-400" />
                    <p className="text-xs text-emerald-100">USB released — reprocessing uses uploaded copies only.</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Done (completed) ── */}
            {phase === 'done' && completeResp && (
              <div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-emerald-500/10 rounded-full flex items-center justify-center shrink-0">
                    <CheckmarkFilled className="text-emerald-400" size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Analysis Complete</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{completeResp.completed_count.toLocaleString()} tracks fully parsed.</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {[
                    { label: 'Tracks', value: completeResp.total_tracks.toLocaleString() },
                    { label: 'Parsed', value: completeResp.completed_count.toLocaleString() },
                  ].map(({ label, value }) => (
                    <div key={label} className="glass rounded-xl p-3">
                      <p className="text-lg font-black font-mono">{value}</p>
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleDone}
                  className="w-full py-3 bg-primary text-white rounded-xl font-bold transition-all active:scale-95"
                >
                  Done
                </button>
              </div>
            )}

            {/* ── Done partial ── */}
            {phase === 'done_partial' && completeResp && (
              <div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-amber-500/10 rounded-full flex items-center justify-center shrink-0">
                    <WarningAlt className="text-amber-400" size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Analysis Updated</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {completeResp.completed_count.toLocaleString()} fully parsed
                      {completeResp.missing_required_count > 0 && ` · ${completeResp.missing_required_count.toLocaleString()} still missing required files`}.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {[
                    { label: 'Parsed', value: completeResp.completed_count.toLocaleString() },
                    { label: 'Partial', value: completeResp.partial_count.toLocaleString() },
                    { label: 'Missing DAT', value: completeResp.missing_required_count.toLocaleString() },
                    { label: 'Failed', value: completeResp.failed_count.toLocaleString() },
                  ].map(({ label, value }) => (
                    <div key={label} className="glass rounded-xl p-3">
                      <p className="text-lg font-black font-mono">{value}</p>
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
                {completeResp.missing_required_count > 0 && (
                  <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                    Reconnect the USB and run Resume Analysis again to retry the {completeResp.missing_required_count.toLocaleString()} track{completeResp.missing_required_count !== 1 ? 's' : ''} still missing DAT files.
                  </p>
                )}
                <button
                  onClick={handleDone}
                  className="w-full py-3 bg-primary text-white rounded-xl font-bold transition-all active:scale-95"
                >
                  Done
                </button>
              </div>
            )}

            {/* ── Error ── */}
            {phase === 'error' && (
              <div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center shrink-0">
                    <WarningAlt className="text-red-400" size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Resume Failed</h2>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{errorMessage}</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setPhase('fetching_status');
                      setErrorMessage('');
                    }}
                    className="flex-1 py-2.5 bg-primary text-white rounded-xl font-bold transition-all active:scale-95"
                  >
                    Retry
                  </button>
                  <button
                    onClick={handleClose}
                    className="flex-1 py-2.5 glass rounded-xl font-bold text-muted-foreground hover:text-foreground transition-colors"
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

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusRow({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-mono font-bold ${warn ? 'text-amber-400' : 'text-foreground/70'}`}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function SummaryRow({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-mono font-bold tabular-nums ${warn ? 'text-amber-400' : 'text-foreground/60'}`}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}
