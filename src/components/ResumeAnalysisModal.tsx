// Non-standard HTML attribute used for folder selection
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface InputHTMLAttributes<T> {
    webkitdirectory?: '' | boolean;
  }
}

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import { useUsbConnection } from '../contexts/UsbConnectionContext';
import { supabase } from '../lib/supabase';
import {
  fetchRekordboxAnalysisStatus,
  resumeRekordboxAnalysis,
} from '../lib/api/rekordboxImport';
import type { AnalysisStatusResponse, CompleteResponse } from '../lib/api/rekordboxImport';
import { buildBatches, isAnlzFile, type MatchedAnalysisFile } from '../lib/rekordbox/analysisPaths';
import { buildResumeTargets, buildResumeMatchResult, buildResumeMatchResultFromMatched, buildStatusSummary, resumeRequiresUsbSelection } from '../lib/rekordbox/resumeAnalysis';
import type { ResumeTarget, ResumeStatusSummary } from '../lib/rekordbox/resumeAnalysis';
import {
  pickTargetedRekordboxUsb,
  resolveRequestedAnalysisFiles,
  supportsTargetedUsbDiscovery,
} from '../lib/rekordbox/usbTargetedDiscovery';
import { UploadAccumulator } from '../lib/rekordbox/analysisUploadResults';
import { isAbortError, uploadBatchWithRetry } from '../lib/rekordbox/uploadBatch';
import { AbortableTimerRegistry, waitForAbortableDelay } from '../lib/rekordbox/abortableRetry';
import { isFreshImportResponse } from '../lib/rekordbox/importRequestFreshness';
import { QuietProgress, quietOverallPercent, type QuietPhase } from './ui/feedback';
import { runCancellableUploadQueue, UploadQueueRuntime } from '../lib/rekordbox/cancellableUploadQueue';
import { IdempotentUsbCleanup, verifyUsbReleased } from '../lib/rekordbox/localUsbLifecycle';
import { CheckCircle, Folder, Refresh, WarningTriangle, Xmark } from 'iconoir-react/regular';
import { ControlButton } from './ui/controls';
import { ImportProgressModal } from './ImportProgressModal';

// ── Types ─────────────────────────────────────────────────────────────────────


const RESUME_PHASES: QuietPhase[] = [
  { id: 'check', label: 'Check' },
  { id: 'upload', label: 'Upload' },
  { id: 'release', label: 'Release USB' },
  { id: 'parse', label: 'Parse' },
  { id: 'done', label: 'Complete' },
];
export type ResumePhase =
  | 'fetching_status'
  | 'scan_prompt'
  | 'uploading'
  | 'stopping_usb_reads'
  | 'parsing'
  | 'done'
  | 'done_partial'
  | 'error';

export interface ResumeMatchSummary {
  matched: number;
  stillMissingRequired: number;
  stillMissingOptional: number;
}

export interface ResumeProgress {
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
const MAX_CONCURRENT = 2;
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
  const { release: releaseUsb, runtime: usbRuntime } = useUsbConnection();
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

  const processResumeSelection = useCallback(async (
    files: File[],
    exactMatches?: MatchedAnalysisFile[],
  ) => {
    performResumeUsbCleanup();
    usbCleanupRef.current = new IdempotentUsbCleanup();
    retryTimersRef.current = new AbortableTimerRegistry();
    uploadQueueRuntimeRef.current = null;

    scannedFilesRef.current = files;

    const requestedImportId = importId;
    const generation = ++requestGenerationRef.current;
    controllerRef.current?.abort();
    const ac = new AbortController();
    controllerRef.current = ac;

    const result = exactMatches
      ? buildResumeMatchResultFromMatched(exactMatches, targets)
      : buildResumeMatchResult(files, targets);
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

  const handleFolderChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(isAnlzFile);
    e.target.value = '';
    await processResumeSelection(files);
  }, [processResumeSelection]);

  const handleUsbFolderSelect = useCallback(async () => {
    if (usbRuntime === 'browser' && supportsTargetedUsbDiscovery()) {
      const requestedImportId = importId;
      const generation = ++requestGenerationRef.current;
      controllerRef.current?.abort();
      const discoveryController = new AbortController();
      controllerRef.current = discoveryController;
      try {
        const selection = await pickTargetedRekordboxUsb();
        if (!isCurrentOperation(requestedImportId, generation, discoveryController)) return;
        const resolution = await resolveRequestedAnalysisFiles(
          selection.rootHandle,
          targets.map((target) => ({
            canonicalPath: target.path,
            assetType: target.assetType,
            trackId: target.trackId ?? '',
          })),
          { signal: discoveryController.signal },
        );
        if (!isCurrentOperation(requestedImportId, generation, discoveryController)) return;
        await processResumeSelection(
          resolution.matched.map((item) => item.file),
          resolution.matched,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setErrorMessage(error instanceof Error ? error.message : 'Could not read the selected USB.');
        setPhase('error');
      }
      return;
    }
    folderInputRef.current?.click();
  }, [importId, isCurrentOperation, processResumeSelection, targets, usbRuntime]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
          <ResumeAnalysisView
            phase={phase}
            hasStatus={Boolean(status)}
            statusSummary={statusSummary}
            targets={targets}
            matchSummary={matchSummary}
            wrongDrive={wrongDrive}
            progress={progress}
            retryingCount={retryingCount}
            completeResp={completeResp}
            errorMessage={errorMessage}
            hiddenInput={<input ref={folderInputRef} type="file" webkitdirectory="" multiple className="hidden" onChange={handleFolderChange} />}
            onClose={handleClose}
            onDone={handleDone}
            onSelectFolder={() => void handleUsbFolderSelect()}
            onRetry={() => { setPhase('fetching_status'); setErrorMessage(''); }}
          />
        </div>
      )}
    </AnimatePresence>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryRow({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${warn ? 'text-amber-400' : 'text-foreground'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
    </div>
  );
}

/** Every screen of the Resume Analysis popover. The live popover and Layout Lab render this same view. */
export function ResumeAnalysisView({
  phase, hasStatus, statusSummary, targets, matchSummary, wrongDrive, progress, retryingCount, completeResp, errorMessage, hiddenInput,
  onClose, onDone, onSelectFolder, onRetry,
}: {
  phase: ResumePhase;
  hasStatus: boolean;
  statusSummary: ResumeStatusSummary | null;
  targets: Array<{ required: boolean }>;
  matchSummary: ResumeMatchSummary | null;
  wrongDrive: boolean;
  progress: ResumeProgress;
  retryingCount: number;
  completeResp: CompleteResponse | null;
  errorMessage: string;
  /** The folder input the screen opens. Layout Lab has none. */
  hiddenInput?: React.ReactNode;
  onClose: () => void;
  onDone: () => void;
  onSelectFolder: () => void;
  onRetry: () => void;
}) {
  const stageIndex: Record<ResumePhase, number> = {
    fetching_status: 0, scan_prompt: 0, uploading: 1, stopping_usb_reads: 2, parsing: 3, done: 4, done_partial: 4, error: 0,
  };
  const uploadPct = progress.filesTotal > 0 ? (progress.filesUploaded / progress.filesTotal) * 100 : 0;
  const headline: Partial<Record<ResumePhase, string>> = {
    fetching_status: 'Checking which analysis files are missing.',
    scan_prompt: 'Choose the USB that holds the missing files.',
    uploading: 'Uploading the missing files.',
    stopping_usb_reads: 'Stopping USB reads.',
    parsing: 'Reprocessing waveform, cue and beat data.',
    done: 'Your analysis is up to date.',
    done_partial: 'Some tracks still need attention.',
  };
  const keepClosed = (
    <div className="import-group import-group--amber flex items-center gap-3 text-left">
      <WarningTriangle width={16} height={16} aria-hidden="true" className="shrink-0 text-amber-400" />
      <p className="whitespace-nowrap text-[11px] leading-snug text-amber-100">Keep Rekordbox closed. Do not eject the drive until DropDex confirms.</p>
    </div>
  );
  const hero = (title: string, kind: 'spin' | 'done' | 'warn' | 'error' = 'spin') => (
    <div className={`import-group shrink-0 text-center ${kind === 'warn' ? 'import-group--amber' : kind === 'error' ? '' : 'import-group--accent'}`}>
      <div className="import-status-icon">
        {kind === 'spin' && <Refresh className="animate-spin text-[var(--color-control-primary)]" width={24} height={24} aria-hidden="true" />}
        {kind === 'done' && <CheckCircle className="text-[var(--color-control-primary)]" width={24} height={24} aria-hidden="true" />}
        {kind === 'warn' && <WarningTriangle className="text-amber-400" width={24} height={24} aria-hidden="true" />}
        {kind === 'error' && <WarningTriangle className="text-red-400" width={24} height={24} aria-hidden="true" />}
      </div>
      <h2 className="import-heading">{title}</h2>
    </div>
  );
  const footer = (children: React.ReactNode) => <div className="mt-auto flex justify-center gap-3 pt-4">{children}</div>;

  return (
          <ImportProgressModal
            title="Resume Analysis"
            stepKey={phase}
            ready={phase !== 'error'}
            status={phase === 'error' ? 'failed' : undefined}
            onClose={onClose}
            progress={(
              <QuietProgress
                title="Resume analysis"
                phases={RESUME_PHASES}
                activeIndex={stageIndex[phase]}
                stagePercent={phase === 'uploading' ? uploadPct : undefined}
                percent={quietOverallPercent(stageIndex[phase], RESUME_PHASES.length, phase === 'uploading' ? uploadPct : 0, phase === 'done')}
                status={phase === 'error' ? 'failed' : phase === 'done' ? 'done' : 'running'}
                headline={phase === 'error' ? 'The resume stopped before it finished.' : headline[phase]}
              />
            )}
          >
            {phase === 'fetching_status' && (
              <div className="flex h-full flex-col text-center">{hero('Checking Analysis Files…')}</div>
            )}

            {phase === 'scan_prompt' && hasStatus && (
              <div className="flex h-full flex-col">
                {statusSummary && (
                  <div className="import-group import-stats text-left text-xs">
                    {statusSummary.missingRequired > 0 && <SummaryRow label="Required DAT files missing" value={statusSummary.missingRequired} warn />}
                    {statusSummary.uploadFailed > 0 && <SummaryRow label="Upload failures (retryable)" value={statusSummary.uploadFailed} warn />}
                    {statusSummary.parseFailed > 0 && <SummaryRow label="Parse failures" value={statusSummary.parseFailed} warn />}
                    {statusSummary.missingOptional > 0 && <SummaryRow label="Optional color/detail files" value={statusSummary.missingOptional} />}
                    {statusSummary.affectedTracks > 0 && <SummaryRow label="Affected tracks" value={statusSummary.affectedTracks} />}
                  </div>
                )}

                {!statusSummary && (
                  <div className="import-group text-left">
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {targets.filter((t) => t.required).length > 0 && (
                        <span className="font-semibold text-amber-400">
                          {targets.filter((t) => t.required).length} required DAT file{targets.filter((t) => t.required).length !== 1 ? 's' : ''} missing
                        </span>
                      )}
                      {targets.filter((t) => t.required).length > 0 && targets.filter((t) => !t.required).length > 0 && ' · '}
                      {targets.filter((t) => !t.required).length > 0 && (
                        <span>{targets.filter((t) => !t.required).length} optional file{targets.filter((t) => !t.required).length !== 1 ? 's' : ''} missing</span>
                      )}
                    </p>
                  </div>
                )}

                {wrongDrive && (
                  <div className="import-group text-left">
                    <p className="mb-1 text-xs font-semibold text-red-400">No matching files found</p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      The selected folder doesn&apos;t contain any of the missing ANLZ files. Make sure you&apos;re selecting the PIONEER folder on the correct USB drive.
                    </p>
                  </div>
                )}

                {matchSummary && !wrongDrive && (
                  <div className="import-group import-stats text-left text-xs">
                    <SummaryRow label="Found on USB" value={matchSummary.matched} />
                    {matchSummary.stillMissingRequired > 0 && <SummaryRow label="Still missing (required)" value={matchSummary.stillMissingRequired} warn />}
                    {matchSummary.stillMissingOptional > 0 && <SummaryRow label="Still missing (optional)" value={matchSummary.stillMissingOptional} />}
                  </div>
                )}

                <p className="text-sm leading-relaxed text-muted-foreground">
                  Only the {pluralFiles(targets.length)} listed as missing will be uploaded. Your music files are not read.
                </p>

                {hiddenInput}
                {footer(
                  <>
                    <ControlButton variant="secondary" onClick={onClose}>
                      <Xmark width={16} height={16} aria-hidden="true" /> Cancel
                    </ControlButton>
                    <ControlButton variant="primary" onClick={() => onSelectFolder()}>
                      <Folder width={16} height={16} aria-hidden="true" />
                      {wrongDrive ? 'Select Different Folder' : 'Select PIONEER Folder'}
                    </ControlButton>
                  </>,
                )}
              </div>
            )}

            {phase === 'uploading' && (
              <div className="flex h-full flex-col text-center">
                {hero('Uploading Missing Files…')}
                {keepClosed}
                <div className="import-group import-stats text-left text-xs">
                  <SummaryRow label="Files" value={`${progress.filesUploaded.toLocaleString()} / ${progress.filesTotal.toLocaleString()}`} />
                  {progress.bytesTotal > 0 && <SummaryRow label="Data uploaded" value={`${fmtBytes(progress.bytesUploaded)} / ${fmtBytes(progress.bytesTotal)}`} />}
                  {retryingCount > 0 && <SummaryRow label="Retrying" value={retryingCount} warn />}
                </div>
              </div>
            )}

            {phase === 'stopping_usb_reads' && (
              <div className="flex h-full flex-col text-center">
                {hero('Stopping USB Reads…')}
                {keepClosed}
              </div>
            )}

            {phase === 'parsing' && (
              <div className="flex h-full flex-col text-center">
                {hero('Reprocessing Tracks…')}
                <div className="import-group import-group--success flex items-center gap-3 text-left">
                  <CheckCircle width={16} height={16} aria-hidden="true" className="shrink-0 text-green-500" />
                  <p className="text-xs leading-relaxed text-green-100">USB released. Reprocessing uses uploaded copies only.</p>
                </div>
              </div>
            )}

            {phase === 'done' && completeResp && (
              <div className="flex h-full flex-col text-center">
                {hero('Analysis Complete', 'done')}
                <div className="import-group import-stats text-left text-xs">
                  <SummaryRow label="Tracks" value={completeResp.total_tracks} />
                  <SummaryRow label="Parsed" value={completeResp.completed_count} />
                </div>
                {footer(
                  <ControlButton variant="primary" onClick={onDone}>
                    <CheckCircle width={16} height={16} aria-hidden="true" /> Done
                  </ControlButton>,
                )}
              </div>
            )}

            {phase === 'done_partial' && completeResp && (
              <div className="flex h-full flex-col text-center">
                {hero('Analysis Updated', 'warn')}
                <div className="import-group import-stats text-left text-xs">
                  <SummaryRow label="Tracks Ready" value={completeResp.completed_count} />
                  <SummaryRow label="Tracks with Issues" value={completeResp.partial_count} warn={completeResp.partial_count > 0} />
                  <SummaryRow label="Tracks Not Processed" value={completeResp.failed_count} warn={completeResp.failed_count > 0} />
                  <SummaryRow label="Missing Analysis Files" value={completeResp.missing_required_count} warn={completeResp.missing_required_count > 0} />
                </div>
                {completeResp.missing_required_count > 0 && (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Reconnect the USB and run Resume Analysis again to retry the {completeResp.missing_required_count.toLocaleString()} track{completeResp.missing_required_count !== 1 ? 's' : ''} still missing analysis files.
                  </p>
                )}
                {footer(
                  <ControlButton variant="primary" onClick={onDone}>
                    <CheckCircle width={16} height={16} aria-hidden="true" /> Done
                  </ControlButton>,
                )}
              </div>
            )}

            {phase === 'error' && (
              <div className="flex h-full flex-col text-center">
                {hero('Resume Failed', 'error')}
                <p className="px-2 text-sm leading-relaxed text-muted-foreground">{errorMessage}</p>
                {footer(
                  <>
                    <ControlButton variant="secondary" onClick={onClose}>
                      <Xmark width={16} height={16} aria-hidden="true" /> Cancel
                    </ControlButton>
                    <ControlButton variant="primary" onClick={onRetry}>
                      <Refresh width={16} height={16} aria-hidden="true" /> Retry
                    </ControlButton>
                  </>,
                )}
              </div>
            )}
          </ImportProgressModal>
  );
}
