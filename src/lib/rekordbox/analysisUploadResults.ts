import type { BatchUploadResponse } from '../api/rekordboxImport';
import type { MatchedAnalysisFile } from './analysisPaths';

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

  addBatchResponse(resp: BatchUploadResponse, batch: MatchedAnalysisFile[]): void {
    this._attemptedFiles += batch.length;
    this._attemptedBytes += batch.reduce((s, f) => s + f.file.size, 0);
    this._receivedFiles += resp.received_count;
    this._receivedBytes += resp.received_bytes;
    this._alreadyReceivedFiles += resp.already_received_count;
    this._errorFiles += resp.error_count ?? 0;
    this._rejectedFiles += resp.rejected_count;

    for (const fr of resp.files) {
      const isRejected = fr.status === 'rejected' || fr.status === 'error';
      const isDat = fr.canonical_path?.toUpperCase().endsWith('.DAT') ?? false;

      if (fr.status === 'already_received') {
        this._alreadyReceivedBytes += fr.file_size ?? 0;
      }
      if (isRejected && isDat) {
        this._rejectedDatFiles++;
      }
    }
  }

  recordFailedBatch(batch: MatchedAnalysisFile[]): void {
    this._failedBatches++;
    this._attemptedFiles += batch.length;
    this._attemptedBytes += batch.reduce((s, f) => s + f.file.size, 0);
  }

  get confirmedBytes(): number {
    return this._receivedBytes + this._alreadyReceivedBytes;
  }

  get confirmedFiles(): number {
    return this._receivedFiles + this._alreadyReceivedFiles;
  }

  get summary(): UploadSummary {
    let completionBlocked = false;
    let blockReason: string | null = null;

    if (this._failedBatches > 0) {
      completionBlocked = true;
      blockReason = `${this._failedBatches} batch request${this._failedBatches === 1 ? '' : 's'} failed after retries — analysis upload is incomplete.`;
    } else if (this._rejectedDatFiles > 0) {
      completionBlocked = true;
      blockReason = `${this._rejectedDatFiles} required DAT file${this._rejectedDatFiles === 1 ? '' : 's'} were rejected by the server.`;
    }

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
      completionBlocked,
      blockReason,
    };
  }
}
