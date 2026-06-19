// Non-standard HTML attribute used for folder selection
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface InputHTMLAttributes<T> {
    webkitdirectory?: '' | boolean;
  }
}

import React, { useRef, useState } from 'react';
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
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import {
  completeRekordboxImport,
  startRekordboxImport,
  uploadRekordboxDb,
  uploadRekordboxZipBundle,
  RekordboxImportError,
} from '../lib/api/rekordboxImport';
import type { CompleteResponse, ImportResult, ImportStartResponse, ImportWriteError, ReuseStats } from '../lib/api/rekordboxImport';
import {
  buildBatches,
  buildMatchedFiles,
  findDatabaseFile,
  isAnlzFile,
  type MatchedAnalysisFile,
} from '../lib/rekordbox/analysisPaths';
import { UploadAccumulator, isTransientFileFailure } from '../lib/rekordbox/analysisUploadResults';
import { buildManifestReconciliation } from '../lib/rekordbox/manifestReconciliation';
import type { ManifestReconciliation } from '../lib/rekordbox/manifestReconciliation';
import { isAbortError, uploadBatchWithRetry } from '../lib/rekordbox/uploadBatch';

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = 'usb_folder' | 'zip_bundle' | 'database_only';

type Phase =
  | 'idle'
  | 'scanning'
  | 'database_selected'
  | 'starting_import'
  | 'matching_analysis'
  | 'uploading_analysis'
  | 'parsing_analysis'
  | 'success'
  | 'partial_success'
  | 'error';

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

type FinalResult =
  | { kind: 'with_analysis'; data: CompleteResponse }
  | { kind: 'library_only'; data: ImportResult };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BATCH_SIZE = 50;
const MAX_BYTES_PER_BATCH = 50 * 1024 * 1024; // 50 MB
const MAX_CONCURRENT = 3;

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

// ── Component ─────────────────────────────────────────────────────────────────

export function ImportLibraryModal({ isOpen, onClose, onSuccess }: Props) {
  const [mode, setMode] = useState<Mode>('usb_folder');
  const [phase, setPhase] = useState<Phase>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [folderScan, setFolderScan] = useState<FolderScan | null>(null);
  const [progress, setProgress] = useState<UploadProgress>({
    filesUploaded: 0, filesTotal: 0, bytesUploaded: 0, bytesTotal: 0, bundlePct: 0,
  });
  const [finalResult, setFinalResult] = useState<FinalResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorStructured, setErrorStructured] = useState<ImportWriteError | null>(null);
  const [showAbortDialog, setShowAbortDialog] = useState(false);
  const [cancelledAfterDb, setCancelledAfterDb] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [reuseStats, setReuseStats] = useState<ReuseStats | null>(null);
  const [reconciliation, setReconciliation] = useState<ManifestReconciliation | null>(null);
  const [retryingCount, setRetryingCount] = useState(0);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const importIdRef = useRef<string | null>(null);

  const isUploading =
    phase === 'starting_import' ||
    phase === 'uploading_analysis' ||
    phase === 'parsing_analysis';

  const reset = () => {
    setPhase('idle');
    setSelectedFile(null);
    setFolderScan(null);
    setProgress({ filesUploaded: 0, filesTotal: 0, bytesUploaded: 0, bytesTotal: 0, bundlePct: 0 });
    setFinalResult(null);
    setErrorMessage('');
    setErrorStructured(null);
    setShowAbortDialog(false);
    setCancelledAfterDb(false);
    setImportId(null);
    setRejectedCount(0);
    setReuseStats(null);
    setReconciliation(null);
    setRetryingCount(0);
    importIdRef.current = null;
    abortControllerRef.current = null;
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const switchMode = (m: Mode) => {
    reset();
    setMode(m);
  };

  const handleClose = () => {
    if (isUploading) {
      setShowAbortDialog(true);
      return;
    }
    reset();
    onClose();
  };

  const confirmAbort = () => {
    abortControllerRef.current?.abort();
    setShowAbortDialog(false);
    if (importIdRef.current) {
      setCancelledAfterDb(true);
      setPhase('partial_success');
    } else {
      reset();
    }
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

    setPhase('scanning');
    const files = Array.from(fileList);
    const dbFile = findDatabaseFile(files);
    const anlzFiles = files.filter(isAnlzFile);
    const folderName =
      (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath
        ?.split('/')[0] ?? 'Selected folder';

    setFolderScan({ dbFile, anlzFiles, folderName });
    setPhase('database_selected');
  };

  // ── ZIP / DB file mode ───────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (mode === 'zip_bundle') {
      if (!file.name.toLowerCase().endsWith('.zip')) {
        setErrorMessage('Please select a .zip file.');
        setPhase('error');
        return;
      }
    } else {
      if (!file.name.toLowerCase().endsWith('.db')) {
        setErrorMessage(
          'Please select a .db file. The rekordbox database is named exportLibrary.db.',
        );
        setPhase('error');
        return;
      }
    }

    setSelectedFile(file);
    setPhase('database_selected');
  };

  // ── Import handler ───────────────────────────────────────────────────────────

  const handleImport = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setErrorMessage('You must be signed in to import a library.');
      setPhase('error');
      return;
    }
    const token = session.access_token;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (mode === 'database_only') {
      await runDatabaseOnlyImport(token);
    } else if (mode === 'zip_bundle') {
      await runZipBundleImport(token, controller);
    } else {
      await runUsbFolderImport(token, controller);
    }
  };

  const runDatabaseOnlyImport = async (token: string) => {
    if (!selectedFile) return;
    setPhase('starting_import');
    try {
      const result = await uploadRekordboxDb(selectedFile, token, folderScan?.folderName);
      setFinalResult({ kind: 'library_only', data: result });
      setPhase('success');
    } catch (err) {
      const { message, structured } = extractError(err);
      setErrorMessage(message);
      setErrorStructured(structured);
      setPhase('error');
    }
  };

  const runZipBundleImport = async (token: string, controller: AbortController) => {
    if (!selectedFile) return;
    setPhase('uploading_analysis');
    try {
      const result = await uploadRekordboxZipBundle(
        selectedFile,
        token,
        (pct) => setProgress(p => ({ ...p, bundlePct: pct })),
        controller.signal,
      );
      setFinalResult({ kind: 'with_analysis', data: result });
      setPhase(result.analysis_status === 'completed' ? 'success' : 'partial_success');
    } catch (err) {
      if (isAbortError(err)) {
        if (importIdRef.current) {
          setCancelledAfterDb(true);
          setPhase('partial_success');
        } else {
          reset();
        }
        return;
      }
      const { message, structured } = extractError(err);
      setErrorMessage(message);
      setErrorStructured(structured);
      setPhase('error');
    }
  };

  const runUsbFolderImport = async (token: string, controller: AbortController) => {
    if (!folderScan?.dbFile) {
      setErrorMessage('No exportLibrary.db found in the selected folder.');
      setPhase('error');
      return;
    }

    // ── Stage 1: upload DB, get manifest ──────────────────────────────────────
    setPhase('starting_import');
    let startResp: ImportStartResponse;
    try {
      startResp = await startRekordboxImport(folderScan.dbFile, token, controller.signal, folderScan.folderName);
    } catch (err) {
      if (isAbortError(err)) { reset(); return; }
      const { message, structured } = extractError(err);
      setErrorMessage(message);
      setErrorStructured(structured);
      setPhase('error');
      return;
    }

    importIdRef.current = startResp.import_id;
    setImportId(startResp.import_id);

    // Capture reuse stats if the backend returned them (incremental rescan)
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

    // ── Stage 2: match scanned files against manifest ─────────────────────────
    setPhase('matching_analysis');
    const matchedFiles = buildMatchedFiles(folderScan.anlzFiles, startResp.manifest);
    const batches = buildBatches(matchedFiles, BATCH_SIZE, MAX_BYTES_PER_BATCH);

    const totalBytes = matchedFiles.reduce((sum, m) => sum + m.file.size, 0);
    setProgress({
      filesUploaded: 0,
      filesTotal: matchedFiles.length,
      bytesUploaded: 0,
      bytesTotal: totalBytes,
      bundlePct: 0,
    });

    // ── Stage 3: concurrent batch upload ANLZ files ───────────────────────────
    setPhase('uploading_analysis');

    // Lookup map for file-level retry: lowercase canonical path → MatchedAnalysisFile.
    const filesByLowerPath = new Map<string, MatchedAnalysisFile>(
      matchedFiles.map((mf) => [mf.canonicalPath.toLowerCase(), mf]),
    );

    const accumulator = new UploadAccumulator();
    let uploadAborted = false;

    await new Promise<void>((resolve) => {
      let active = 0;
      let dispatched = 0;
      let settled = 0;
      const total = batches.length;

      if (total === 0) { resolve(); return; }

      const maybeDone = () => {
        if (settled === total) resolve();
      };

      const runNext = () => {
        while (active < MAX_CONCURRENT && dispatched < total) {
          const batch = batches[dispatched++];
          active++;

          uploadBatchWithRetry(startResp.import_id, batch, token, controller.signal)
            .then((resp) => {
              active--;
              settled++;
              if (resp) {
                accumulator.addBatchResponse(resp, batch);
              } else {
                accumulator.recordFailedBatch(batch);
              }
              // Update progress from server-confirmed bytes (not attempted batch bytes)
              setProgress((p) => ({
                ...p,
                filesUploaded: accumulator.confirmedFiles,
                bytesUploaded: accumulator.confirmedBytes,
              }));
              setRejectedCount(accumulator.summary.rejectedFiles + accumulator.summary.errorFiles);
              runNext();
              maybeDone();
            })
            .catch((err) => {
              active--;
              settled++;
              if (isAbortError(err)) {
                uploadAborted = true;
              } else {
                console.warn('[DropDex] Batch upload error (all retries exhausted):', err);
                accumulator.recordFailedBatch(batch);
              }
              runNext();
              maybeDone();
            });
        }
      };

      runNext();
    });

    // ── Stage 3a: file-level retry for transient individual-file failures ────────
    // The initial batch loop handles request-level failures (network, HTTP errors).
    // This loop handles HTTP 200 responses where individual files inside the batch
    // failed with a transient status (e.g. status "error", or rejected with
    // "Upload failed. Please try again."). We retry those files up to 2 more times
    // (3 total attempts per file), without calling addBatchResponse again so that
    // _attemptedFiles counts unique files rather than attempts.
    //
    // Delays: 500 ms before attempt 2, 1 000 ms before attempt 3.
    const FILE_RETRY_DELAYS_MS = [500, 1000];

    for (let ri = 0; ri < FILE_RETRY_DELAYS_MS.length && !uploadAborted; ri++) {
      const retryPaths = accumulator.retryableFilePaths;
      if (retryPaths.length === 0) break;

      setRetryingCount(retryPaths.length);

      // Abortable delay before each retry attempt.
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, FILE_RETRY_DELAYS_MS[ri]);
        controller.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
      });

      if (controller.signal.aborted) { uploadAborted = true; break; }

      const retryBatch = retryPaths
        .map((p) => filesByLowerPath.get(p))
        .filter((mf): mf is MatchedAnalysisFile => mf !== undefined);

      if (retryBatch.length === 0) break;

      if (import.meta.env.DEV) {
        console.debug('[ANLZ retry] File-level retry attempt', ri + 2, {
          count: retryBatch.length,
          files: retryBatch.map((f) => ({
            path: f.canonicalPath,
            type: f.assetType,
            attempt: ri + 2,
          })),
        });
      }

      // Use maxAttempts=1 here: request-level retries are handled by
      // uploadBatchWithRetry only on the initial pass.
      const { data: { session: retrySession } } = await supabase.auth.getSession();
      const retryTok = retrySession?.access_token ?? token;
      const retryResp = await uploadBatchWithRetry(
        startResp.import_id,
        retryBatch,
        retryTok,
        controller.signal,
        1,
      );

      if (retryResp === null) {
        // Request-level failure during file retry — leave affected files as-is.
        if (import.meta.env.DEV) {
          console.debug('[ANLZ retry] Request-level failure on retry attempt', ri + 2, {
            paths: retryPaths,
          });
        }
        break;
      }

      for (const fr of retryResp.files) {
        const succeeded = fr.status === 'received' || fr.status === 'already_received';
        if (succeeded) {
          accumulator.correctFileRetrySuccess(
            fr.canonical_path,
            fr.status as 'received' | 'already_received',
            fr.file_size,
          );
        }
        if (import.meta.env.DEV) {
          console.debug('[ANLZ retry] File result on attempt', ri + 2, {
            path: fr.canonical_path,
            status: fr.status,
            reason: fr.reject_reason,
            resolved: succeeded,
            stillRetryable: !succeeded && isTransientFileFailure(fr),
          });
        }
      }

      setProgress((p) => ({
        ...p,
        filesUploaded: accumulator.confirmedFiles,
        bytesUploaded: accumulator.confirmedBytes,
      }));
      setRejectedCount(accumulator.summary.rejectedFiles + accumulator.summary.errorFiles);
    }

    setRetryingCount(0);

    if (uploadAborted) {
      setCancelledAfterDb(true);
      setPhase('partial_success');
      return;
    }

    // ── Stage 3b: manifest reconciliation ────────────────────────────────────
    // Compare what the manifest expected against what was actually uploaded.
    // This produces structured info about missing / failed files, surfaced in
    // the completion UI. It does NOT gate calling /complete — the backend
    // handles missing DAT files by marking individual tracks as missing_required
    // and returning analysis_status "partial", so all valid tracks still parse.
    const recon = buildManifestReconciliation(
      startResp.manifest,
      matchedFiles,
      accumulator.successfullyUploadedPaths,
    );
    setReconciliation(recon);

    // ── Stage 4: trigger server-side parsing ──────────────────────────────────
    // Always call /complete unless the user explicitly cancelled. The backend
    // is idempotent (upsert semantics) and handles missing files gracefully.
    setPhase('parsing_analysis');
    let completeResp: CompleteResponse;
    try {
      const { data: { session: completeSession } } = await supabase.auth.getSession();
      completeResp = await completeRekordboxImport(startResp.import_id, completeSession?.access_token ?? token, { signal: controller.signal });
    } catch (err) {
      if (isAbortError(err)) {
        setCancelledAfterDb(true);
        setPhase('partial_success');
        return;
      }
      const { message, structured } = extractError(err);
      setErrorMessage(message);
      setErrorStructured(structured);
      setPhase('error');
      return;
    }

    setFinalResult({ kind: 'with_analysis', data: completeResp });
    // "failed" analysis_status (all tracks missing_required) still lands in
    // partial_success so the user sees a useful summary rather than an error screen.
    setPhase(completeResp.analysis_status === 'completed' ? 'success' : 'partial_success');
  };

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
                    <p className="font-bold text-lg mb-2">Cancel import?</p>
                    {importId ? (
                      <p className="text-sm text-muted-foreground mb-5">
                        Your library and playlists have already been saved. Only the analysis
                        upload will be cancelled.
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground mb-5">
                        The import will be cancelled and no data will be saved.
                      </p>
                    )}
                    <div className="flex gap-3">
                      <button
                        onClick={confirmAbort}
                        className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold transition-colors"
                      >
                        Yes, cancel
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
            {(phase === 'idle' || phase === 'database_selected' || phase === 'scanning') && (
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
            {(phase === 'idle' || phase === 'database_selected' || phase === 'scanning') && (
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
                              {folderScan.anlzFiles.length.toLocaleString()} ANLZ analysis file
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

            {/* ── In-progress states ── */}
            {(phase === 'starting_import' ||
              phase === 'matching_analysis' ||
              phase === 'parsing_analysis') && (
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Loader2 className="animate-spin text-primary" size={28} />
                </div>
                <h2 className="text-xl font-bold mb-2">
                  {phase === 'starting_import' && 'Uploading Database…'}
                  {phase === 'matching_analysis' && 'Matching Analysis Files…'}
                  {phase === 'parsing_analysis' && 'Parsing Analysis Data…'}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {phase === 'starting_import' &&
                    'Sending exportLibrary.db to DropDex and retrieving the track manifest.'}
                  {phase === 'matching_analysis' &&
                    'Matching local ANLZ files to the import manifest.'}
                  {phase === 'parsing_analysis' &&
                    'The server is parsing ANLZ analysis data. This may take a moment.'}
                </p>
                <button
                  onClick={() => setShowAbortDialog(true)}
                  className="mt-6 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}

            {phase === 'uploading_analysis' && (
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Loader2 className="animate-spin text-primary" size={28} />
                </div>
                <h2 className="text-xl font-bold mb-5">
                  {mode === 'zip_bundle' ? 'Uploading Bundle…' : 'Uploading Analysis Files…'}
                </h2>

                {/* Progress bar */}
                <div className="w-full h-2 bg-[var(--color-surface)] rounded-full overflow-hidden mb-3">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${uploadPct}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground mb-1">
                  {uploadPct}%
                </p>
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
                  <p className="text-xs text-muted-foreground">
                    {fmtBytes(selectedFile.size)}
                  </p>
                )}

                <button
                  onClick={() => setShowAbortDialog(true)}
                  className="mt-6 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel upload
                </button>
              </div>
            )}

            {/* ── Success ── */}
            {phase === 'success' && (
              <div className="text-center">
                <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="text-emerald-400" size={28} />
                </div>
                <h2 className="text-xl font-bold mb-1">
                  {withAnalysis ? 'Library Imported with Analysis!' : 'Library Imported!'}
                </h2>

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

                {/* Optional missing waveform files (doesn't affect analysis_status = completed) */}
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
                        <SummaryRow label="Missing detail waveform (2EX)" value={withAnalysis.missing_optional_2ex_count} />
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
                      These optional files are missing but do not affect playback. Re-import from the same USB to add them.
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
                <h2 className="text-xl font-bold mb-2">
                  {cancelledAfterDb
                    ? 'Library Saved (Analysis Cancelled)'
                    : 'Library Imported with Warnings'}
                </h2>
                {cancelledAfterDb ? (
                  <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                    Your library and playlists were saved. Analysis upload was cancelled — you
                    can re-import to add analysis data later.
                  </p>
                ) : (
                  withAnalysis && (
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
                              <SummaryRow label="Missing detail waveform (2EX)" value={withAnalysis.missing_optional_2ex_count} />
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
                  )
                )}

                <button
                  onClick={handleDone}
                  className="w-full py-4 bg-primary text-white rounded-xl font-bold transition-all active:scale-95"
                >
                  Done
                </button>
              </div>
            )}

            {/* ── Error ── */}
            {phase === 'error' && (
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
