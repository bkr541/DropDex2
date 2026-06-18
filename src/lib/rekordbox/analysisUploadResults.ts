import type { BatchUploadResponse, BatchFileResult } from '../api/rekordboxImport';
import type { MatchedAnalysisFile } from './analysisPaths';

// Reasons that definitively indicate a permanent rejection — do not retry.
const PERMANENT_REJECT_REASONS = new Set([
  'path_mismatch',
  'invalid_extension',
  'path_traversal',
  'file_too_large',
  'invalid_path',
  'duplicate',
  'unauthorized',
  'wrong_import',
]);

// Lowercase substrings in reject_reason that signal a transient, retriable failure.
const TRANSIENT_REASON_PATTERNS = [
  'try again',
  'upload failed',
  'storage',
  'timeout',
  'retry',
  'temporary',
  'transient',
];

/**
 * Returns true when a BatchFileResult represents a transient failure that
 * should be retried at the file level.
 *
 * - status "error" is always transient (server-side storage/processing failure).
 * - status "request_failed" is always transient (HTTP-level failure, no server response).
 * - status "rejected" is transient only when reject_reason contains a known
 *   transient pattern (e.g. "Upload failed. Please try again.").
 * - Permanent validation failures (path_mismatch, invalid_extension, etc.) return false.
 */
export function isTransientFileFailure(fr: BatchFileResult): boolean {
  if (fr.status === 'received' || fr.status === 'already_received') return false;
  if (fr.status === 'error' || fr.status === 'request_failed') return true;
  if (fr.status === 'rejected' || fr.status === 'failed') {
    const reason = (fr.reject_reason ?? '').toLowerCase();
    if (!reason) return false;
    if (PERMANENT_REJECT_REASONS.has(reason)) return false;
    return TRANSIENT_REASON_PATTERNS.some((p) => reason.includes(p));
  }
  return false;
}

// Internal per-file record used for retry correction tracking.
interface FileRecord {
  /**
   * Lifecycle statuses:
   *   'received'         — server accepted the file (new upload)
   *   'already_received' — server already had this file
   *   'error'            — server-side storage/processing failure (always transient)
   *   'rejected'         — server validation failure (may or may not be transient)
   *   'failed'           — server returned "failed" status
   *   'request_failed'   — HTTP request itself failed; no per-file response received
   */
  status: string;
  isDat: boolean;
  /** File size from the client-side File object at upload time. */
  clientSize: number;
  serverFileSize: number | null;
  rejectReason: string | null;
}

export interface UploadSummary {
  attemptedFiles: number;
  attemptedBytes: number;
  receivedFiles: number;
  /** Server-confirmed bytes for newly-received files. */
  receivedBytes: number;
  alreadyReceivedFiles: number;
  /** Bytes of files the server already had (computed from file results). */
  alreadyReceivedBytes: number;
  rejectedFiles: number;
  /** DAT files specifically rejected — these block completion. */
  rejectedDatFiles: number;
  errorFiles: number;
  failedBatchCount: number;
  /** True when calling /complete would be unsafe or misleading. */
  completionBlocked: boolean;
  blockReason: string | null;
}

/**
 * Accumulates BatchUploadResponse results across all concurrent batches.
 * Thread-safe for sequential accumulation (JS is single-threaded).
 *
 * Per-file tracking (via _knownFiles) enables two additional capabilities:
 *   1. correctFileRetrySuccess — correct counts when a previously-failed file
 *      succeeds on a file-level retry without double-counting.
 *   2. retryableFilePaths — enumerate files eligible for a file-level retry.
 */
export class UploadAccumulator {
  private _receivedFiles = 0;
  private _receivedBytes = 0;
  private _alreadyReceivedFiles = 0;
  private _alreadyReceivedBytes = 0;
  private _rejectedFiles = 0;
  private _rejectedDatFiles = 0;
  private _errorFiles = 0;
  private _failedBatches = 0;
  private _attemptedFiles = 0;
  private _attemptedBytes = 0;
  // Per-file outcome keyed by lowercase canonical path.
  private _knownFiles = new Map<string, FileRecord>();

  addBatchResponse(resp: BatchUploadResponse, batch: MatchedAnalysisFile[]): void {
    this._attemptedFiles += batch.length;
    this._attemptedBytes += batch.reduce((s, f) => s + f.file.size, 0);
    this._receivedFiles += resp.received_count;
    this._receivedBytes += resp.received_bytes;
    this._alreadyReceivedFiles += resp.already_received_count;
    this._errorFiles += resp.error_count ?? 0;
    this._rejectedFiles += resp.rejected_count;

    const clientSizeByPath = new Map<string, number>(
      batch.map((mf) => [mf.canonicalPath.toLowerCase(), mf.file.size]),
    );

    for (const fr of resp.files) {
      const key = (fr.canonical_path ?? '').toLowerCase();
      // Skip empty keys and duplicate entries — a file is registered only once.
      if (!key || this._knownFiles.has(key)) continue;

      const isDat = (fr.canonical_path ?? '').toUpperCase().endsWith('.DAT');
      const isFailure = fr.status === 'rejected' || fr.status === 'error' || fr.status === 'failed';

      if (fr.status === 'already_received') {
        this._alreadyReceivedBytes += fr.file_size ?? 0;
      }
      if (isFailure && isDat) {
        this._rejectedDatFiles++;
      }

      this._knownFiles.set(key, {
        status: fr.status,
        isDat,
        clientSize: clientSizeByPath.get(key) ?? fr.file_size ?? 0,
        serverFileSize: fr.file_size,
        rejectReason: fr.reject_reason,
      });
    }
  }

  /**
   * Record an HTTP-level batch failure where no per-file response was received.
   *
   * Every file in the batch is registered in `_knownFiles` as 'request_failed'
   * (a transient, retryable status). Files already in `_knownFiles` with a
   * terminal status (received / already_received) are not downgraded.
   *
   * `_attemptedFiles` / `_attemptedBytes` are incremented only for files that
   * are new to `_knownFiles` to avoid double-counting on repeated failures.
   */
  recordFailedBatch(batch: MatchedAnalysisFile[]): void {
    this._failedBatches++;

    for (const mf of batch) {
      const key = mf.canonicalPath.toLowerCase();
      const existing = this._knownFiles.get(key);

      if (existing) {
        // Already tracked — update to request_failed only if still in a
        // non-terminal failure state (don't downgrade a successful record).
        if (existing.status !== 'received' && existing.status !== 'already_received') {
          existing.status = 'request_failed';
          existing.rejectReason = 'Request failed';
        }
        // Do NOT re-increment _attemptedFiles / _attemptedBytes for known files.
        continue;
      }

      // New file — register and count it.
      const isDat = mf.canonicalPath.toUpperCase().endsWith('.DAT');
      this._knownFiles.set(key, {
        status: 'request_failed',
        isDat,
        clientSize: mf.file.size,
        serverFileSize: null,
        rejectReason: 'Request failed',
      });
      this._attemptedFiles++;
      this._attemptedBytes += mf.file.size;
    }
  }

  /**
   * Update the per-file record after a retry that also failed at the file level.
   * Call this when a file-level retry attempt receives an error or rejection
   * response, to keep the record's status and error reason current.
   *
   * This does NOT change aggregate counters — the file was already counted as a
   * failure. It only refreshes the stored reason for observability.
   */
  updateFileRetryFailure(
    canonicalPath: string,
    newStatus: string,
    rejectReason: string | null,
  ): void {
    const key = canonicalPath.toLowerCase();
    const record = this._knownFiles.get(key);
    if (!record) return;
    if (record.status === 'received' || record.status === 'already_received') return;
    record.status = newStatus;
    record.rejectReason = rejectReason;
  }

  /**
   * Correct the accumulated counts when a file that previously failed succeeds
   * on a file-level retry. Do NOT call addBatchResponse for retry batches —
   * call this per-file instead to avoid double-counting _attemptedFiles.
   *
   * Idempotent: calling for an already-succeeded file is a no-op.
   */
  correctFileRetrySuccess(
    canonicalPath: string,
    newStatus: 'received' | 'already_received',
    serverFileSize: number | null,
  ): void {
    const key = canonicalPath.toLowerCase();
    const record = this._knownFiles.get(key);
    if (!record) return;

    const oldStatus = record.status;
    if (oldStatus === 'received' || oldStatus === 'already_received') return;

    // Undo the old failure counter.
    if (oldStatus === 'error') {
      this._errorFiles = Math.max(0, this._errorFiles - 1);
      if (record.isDat) this._rejectedDatFiles = Math.max(0, this._rejectedDatFiles - 1);
    } else if (oldStatus === 'rejected' || oldStatus === 'failed') {
      this._rejectedFiles = Math.max(0, this._rejectedFiles - 1);
      if (record.isDat) this._rejectedDatFiles = Math.max(0, this._rejectedDatFiles - 1);
    }
    // 'request_failed' has no corresponding aggregate counter — it is purely
    // tracked via _knownFiles; no counter to decrement here.

    // Add to success counters.
    const size = serverFileSize ?? record.clientSize;
    if (newStatus === 'received') {
      this._receivedFiles++;
      this._receivedBytes += size;
    } else {
      this._alreadyReceivedFiles++;
      this._alreadyReceivedBytes += size;
    }

    // Update the record so subsequent calls for the same path are no-ops.
    record.status = newStatus;
    record.serverFileSize = serverFileSize;
  }

  /**
   * Returns the lowercase canonical paths of files that failed with a
   * transient error and are eligible for a file-level retry.
   */
  get retryableFilePaths(): string[] {
    const result: string[] = [];
    for (const [path, record] of this._knownFiles) {
      const isFailure =
        record.status === 'error' ||
        record.status === 'rejected' ||
        record.status === 'failed' ||
        record.status === 'request_failed';
      if (!isFailure) continue;
      // Re-construct a minimal BatchFileResult to reuse isTransientFileFailure.
      const pseudoFr: BatchFileResult = {
        canonical_path: path,
        status: record.status,
        sha256: null,
        file_size: record.serverFileSize,
        reject_reason: record.rejectReason,
      };
      if (isTransientFileFailure(pseudoFr)) result.push(path);
    }
    return result;
  }

  get confirmedBytes(): number {
    return this._receivedBytes + this._alreadyReceivedBytes;
  }

  get confirmedFiles(): number {
    return this._receivedFiles + this._alreadyReceivedFiles;
  }

  /**
   * Lowercase canonical paths of files that were accepted by the server
   * (status "received" or "already_received"). Used for manifest reconciliation.
   */
  get successfullyUploadedPaths(): Set<string> {
    const result = new Set<string>();
    for (const [path, record] of this._knownFiles) {
      if (record.status === 'received' || record.status === 'already_received') {
        result.add(path);
      }
    }
    return result;
  }

  get summary(): UploadSummary {
    // Upload failures (rejected DAT files, failed batches) do NOT block calling
    // /complete. The backend marks individual tracks as missing_required and
    // returns analysis_status "partial", allowing all valid tracks to be parsed.
    return {
      attemptedFiles: this._attemptedFiles,
      attemptedBytes: this._attemptedBytes,
      receivedFiles: this._receivedFiles,
      receivedBytes: this._receivedBytes,
      alreadyReceivedFiles: this._alreadyReceivedFiles,
      alreadyReceivedBytes: this._alreadyReceivedBytes,
      rejectedFiles: this._rejectedFiles,
      rejectedDatFiles: this._rejectedDatFiles,
      errorFiles: this._errorFiles,
      failedBatchCount: this._failedBatches,
      completionBlocked: false,
      blockReason: null,
    };
  }
}
