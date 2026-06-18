// Non-standard HTML attribute used for folder selection
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface InputHTMLAttributes<T> {
    webkitdirectory?: '' | boolean;
  }
}

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, AlertTriangle, CheckCircle2, FolderOpen, Loader2, RefreshCw, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  completeRekordboxImport,
  fetchRekordboxAnalysisStatus,
} from '../lib/api/rekordboxImport';
import type { AnalysisStatusResponse, CompleteResponse } from '../lib/api/rekordboxImport';
import { buildBatches, isAnlzFile } from '../lib/rekordbox/analysisPaths';
import { buildResumeTargets, buildResumeMatchResult } from '../lib/rekordbox/resumeAnalysis';
import type { ResumeMatchResult, ResumeTarget } from '../lib/rekordbox/resumeAnalysis';
import { UploadAccumulator, isTransientFileFailure } from '../lib/rekordbox/analysisUploadResults';
import { isAbortError, uploadBatchWithRetry } from '../lib/rekordbox/uploadBatch';

// ── Types ─────────────────────────────────────────────────────────────────────

type ResumePhase =
  | 'fetching_status'
  | 'scan_prompt'
  | 'uploading'
  | 'parsing'
  | 'done'
  | 'done_partial'
  | 'error';

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
  const [phase, setPhase] = useState<ResumePhase>('fetching_status');
  const [status, setStatus] = useState<AnalysisStatusResponse | null>(null);
  const [targets, setTargets] = useState<ResumeTarget[]>([]);
  const [matchResult, setMatchResult] = useState<ResumeMatchResult | null>(null);
  const [progress, setProgress] = useState<ResumeProgress>({ filesUploaded: 0, filesTotal: 0, bytesUploaded: 0, bytesTotal: 0 });
  const [completeResp, setCompleteResp] = useState<CompleteResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [retryingCount, setRetryingCount] = useState(0);
  const [wrongDrive, setWrongDrive] = useState(false);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Fetch analysis status on open
  useEffect(() => {
    if (!isOpen) return;
    setPhase('fetching_status');
    setStatus(null);
    setTargets([]);
    setMatchResult(null);
    setCompleteResp(null);
    setErrorMessage('');
    setWrongDrive(false);
    setRetryingCount(0);
    setProgress({ filesUploaded: 0, filesTotal: 0, bytesUploaded: 0, bytesTotal: 0 });

    const ac = new AbortController();
    controllerRef.current = ac;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const tok = session?.access_token ?? '';
        const resp = await fetchRekordboxAnalysisStatus(importId, tok);
        if (ac.signal.aborted) return;

        setStatus(resp);
        const t = buildResumeTargets(resp);
        setTargets(t);

        if (t.length === 0) {
          // Nothing missing — just re-trigger parsing to clean up any parse failures.
          await runParsing(importId, tok, ac);
        } else {
          setPhase('scan_prompt');
        }
      } catch (err) {
        if (isAbortError(err)) return;
        setErrorMessage(err instanceof Error ? err.message : 'Failed to fetch analysis status.');
        setPhase('error');
      }
    })();

    return () => { ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, importId]);

  async function runParsing(impId: string, tok: string, ac: AbortController) {
    setPhase('parsing');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const finalTok = session?.access_token ?? tok;
      const resp = await completeRekordboxImport(impId, finalTok, ac.signal);
      if (ac.signal.aborted) return;
      setCompleteResp(resp);
      setPhase(resp.analysis_status === 'completed' ? 'done' : 'done_partial');
    } catch (err) {
      if (isAbortError(err)) return;
      setErrorMessage(err instanceof Error ? err.message : 'Analysis reprocessing failed.');
      setPhase('error');
    }
  }

  function handleClose() {
    controllerRef.current?.abort();
    onClose();
  }

  function handleDone() {
    controllerRef.current?.abort();
    onSuccess();
    onClose();
  }

  const handleFolderChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(isAnlzFile);
    e.target.value = '';

    const result = buildResumeMatchResult(files, targets);
    setMatchResult(result);

    if (result.matched.length === 0) {
      setWrongDrive(true);
      return;
    }

    setWrongDrive(false);

    // ── Begin upload ──────────────────────────────────────────────────────────
    const ac = new AbortController();
    controllerRef.current = ac;

    const { data: { session } } = await supabase.auth.getSession();
    const tok = session?.access_token ?? '';

    const batches = buildBatches(result.matched, BATCH_SIZE, MAX_BYTES_PER_BATCH);
    const totalFiles = result.matched.length;
    const totalBytes = result.matched.reduce((s, f) => s + f.file.size, 0);

    setProgress({ filesUploaded: 0, filesTotal: totalFiles, bytesUploaded: 0, bytesTotal: totalBytes });
    setPhase('uploading');

    const accumulator = new UploadAccumulator();

    // Upload in concurrent groups
    let uploadAborted = false;
    for (let batchStart = 0; batchStart < batches.length && !uploadAborted; batchStart += MAX_CONCURRENT) {
      const group = batches.slice(batchStart, batchStart + MAX_CONCURRENT);
      await Promise.all(group.map(async (batch) => {
        if (ac.signal.aborted) { uploadAborted = true; return; }
        const resp = await uploadBatchWithRetry(importId, batch, tok, ac.signal);
        if (resp === null) {
          accumulator.recordFailedBatch(batch);
        } else {
          accumulator.addBatchResponse(resp, batch);
        }
        setProgress((p) => ({
          ...p,
          filesUploaded: accumulator.confirmedFiles,
          bytesUploaded: accumulator.confirmedBytes,
        }));
      }));
      if (ac.signal.aborted) uploadAborted = true;
    }

    // File-level retry for transient failures
    if (!uploadAborted) {
      const filesByLowerPath = new Map(result.matched.map((mf) => [mf.canonicalPath.toLowerCase(), mf]));
      for (let ri = 0; ri < FILE_RETRY_DELAYS_MS.length && !uploadAborted; ri++) {
        const retryPaths = accumulator.retryableFilePaths;
        if (retryPaths.length === 0) break;
        setRetryingCount(retryPaths.length);
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, FILE_RETRY_DELAYS_MS[ri]);
          ac.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
        });
        if (ac.signal.aborted) { uploadAborted = true; break; }
        const retryBatch = retryPaths.map((p) => filesByLowerPath.get(p)).filter((mf): mf is NonNullable<typeof mf> => mf !== undefined);
        if (retryBatch.length === 0) break;
        const retryResp = await uploadBatchWithRetry(importId, retryBatch, tok, ac.signal, 1);
        if (retryResp === null) break;
        for (const fr of retryResp.files) {
          if (fr.status === 'received' || fr.status === 'already_received') {
            accumulator.correctFileRetrySuccess(fr.canonical_path, fr.status as 'received' | 'already_received', fr.file_size);
          }
        }
        setProgress((p) => ({ ...p, filesUploaded: accumulator.confirmedFiles, bytesUploaded: accumulator.confirmedBytes }));
      }
      setRetryingCount(0);
    }

    if (uploadAborted) return;

    await runParsing(importId, tok, ac);
  }, [importId, targets]);

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
            className="relative z-10 w-full max-w-sm glass rounded-3xl p-7 shadow-2xl border border-[var(--color-border-subtle)]"
          >
            {/* Close button */}
            {(phase === 'scan_prompt' || phase === 'error' || phase === 'done_partial') && (
              <button
                onClick={handleClose}
                className="absolute top-5 right-5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={18} />
              </button>
            )}

            {/* ── Fetching status ── */}
            {phase === 'fetching_status' && (
              <div className="text-center py-4">
                <Loader2 className="animate-spin text-primary mx-auto mb-4" size={32} />
                <h2 className="text-lg font-bold mb-1">Checking Analysis Status</h2>
                <p className="text-sm text-muted-foreground">Loading missing file list…</p>
              </div>
            )}

            {/* ── Scan prompt ── */}
            {phase === 'scan_prompt' && status && (
              <div className="text-center">
                <div className="w-14 h-14 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
                  <RefreshCw className="text-amber-400" size={24} />
                </div>
                <h2 className="text-xl font-bold mb-2">Resume Analysis</h2>
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

                {wrongDrive && (
                  <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-left">
                    <p className="text-xs text-red-400 font-semibold mb-1">No matching files found</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      The selected folder doesn't contain any of the missing ANLZ files. Make sure you're selecting the PIONEER folder on the correct USB drive.
                    </p>
                  </div>
                )}

                {matchResult && !wrongDrive && (
                  <div className="mb-4 p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-left space-y-1.5">
                    <StatusRow label="Found on USB" value={matchResult.matched.length} />
                    {matchResult.stillMissingRequired.length > 0 && (
                      <StatusRow label="Still missing (required)" value={matchResult.stillMissingRequired.length} warn />
                    )}
                    {matchResult.stillMissingOptional.length > 0 && (
                      <StatusRow label="Still missing (optional)" value={matchResult.stillMissingOptional.length} />
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
              <div className="text-center py-4">
                <div className="relative w-14 h-14 mx-auto mb-5">
                  <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                  <div className="relative w-14 h-14 bg-primary/15 rounded-full flex items-center justify-center">
                    <Loader2 className="animate-spin text-primary" size={24} />
                  </div>
                </div>
                <h2 className="text-lg font-bold mb-1">Uploading Missing Files</h2>
                <p className="text-sm text-muted-foreground">
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
              </div>
            )}

            {/* ── Parsing ── */}
            {phase === 'parsing' && (
              <div className="text-center py-4">
                <div className="relative w-14 h-14 mx-auto mb-5">
                  <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                  <div className="relative w-14 h-14 bg-primary/15 rounded-full flex items-center justify-center">
                    <Loader2 className="animate-spin text-primary" size={24} />
                  </div>
                </div>
                <h2 className="text-lg font-bold mb-1">Reprocessing Analysis</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Parsing waveform, cue, and beat data for affected tracks…
                </p>
              </div>
            )}

            {/* ── Done (completed) ── */}
            {phase === 'done' && completeResp && (
              <div className="text-center">
                <div className="w-14 h-14 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
                  <CheckCircle2 className="text-emerald-400" size={26} />
                </div>
                <h2 className="text-xl font-bold mb-2">Analysis Complete</h2>
                <p className="text-sm text-muted-foreground mb-5">
                  {completeResp.completed_count.toLocaleString()} tracks fully parsed.
                </p>
                <div className="grid grid-cols-2 gap-2 mb-5">
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
                  className="w-full py-4 bg-primary text-white rounded-xl font-bold transition-all active:scale-95"
                >
                  Done
                </button>
              </div>
            )}

            {/* ── Done partial ── */}
            {phase === 'done_partial' && completeResp && (
              <div className="text-center">
                <div className="w-14 h-14 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
                  <AlertTriangle className="text-amber-400" size={26} />
                </div>
                <h2 className="text-xl font-bold mb-2">Analysis Updated</h2>
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                  {completeResp.completed_count.toLocaleString()} tracks fully parsed
                  {completeResp.missing_required_count > 0 && ` · ${completeResp.missing_required_count.toLocaleString()} still missing required files`}.
                </p>

                <div className="grid grid-cols-2 gap-2 mb-4">
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
                    {completeResp.missing_required_count.toLocaleString()} track{completeResp.missing_required_count !== 1 ? 's' : ''} still lack required DAT files. Reconnect the USB and run Resume Analysis again to retry.
                  </p>
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
                <div className="w-14 h-14 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
                  <AlertCircle className="text-red-400" size={26} />
                </div>
                <h2 className="text-xl font-bold mb-2">Resume Failed</h2>
                <p className="text-sm text-muted-foreground leading-relaxed px-2 mb-6">
                  {errorMessage}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setPhase('fetching_status');
                      setErrorMessage('');
                    }}
                    className="flex-1 py-3 bg-primary text-white rounded-xl font-bold transition-all active:scale-95"
                  >
                    Retry
                  </button>
                  <button
                    onClick={handleClose}
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
