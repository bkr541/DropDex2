/**
 * Shared batch-upload utilities used by both the initial import and the
 * resume analysis flows.
 */

import { supabase } from '../supabase';
import { uploadRekordboxAnalysisBatch } from '../api/rekordboxImport';
import type { BatchUploadResponse } from '../api/rekordboxImport';
import type { MatchedAnalysisFile } from './analysisPaths';
import {
  AbortableTimerRegistry,
  throwIfCancelled,
  waitForAbortableDelay,
} from './abortableRetry';

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const msg = err.message;
  if (msg.includes('HTTP 401') || msg.includes('HTTP 403') ||
      msg.includes('HTTP 404') || msg.includes('HTTP 413') ||
      msg.includes('HTTP 422')) return false;
  return true;
}

export interface UploadRetryOptions {
  retryTimers?: AbortableTimerRegistry;
  isLocallyAborted?: () => boolean;
}

/**
 * Upload one batch of ANLZ files with request-level retry (exponential
 * back-off). Returns the response, or null if all non-cancellation attempts
 * fail. AbortError is always re-thrown and never recorded as an upload failure.
 */
export async function uploadBatchWithRetry(
  importId: string,
  batch: MatchedAnalysisFile[],
  fallbackToken: string,
  signal: AbortSignal,
  maxAttempts = 3,
  options: UploadRetryOptions = {},
): Promise<BatchUploadResponse | null> {
  const retryTimers = options.retryTimers ?? new AbortableTimerRegistry();
  const isLocallyAborted = options.isLocallyAborted ?? (() => false);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfCancelled(signal, isLocallyAborted);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      throwIfCancelled(signal, isLocallyAborted);
      const tok = session?.access_token ?? fallbackToken;
      return await uploadRekordboxAnalysisBatch(importId, batch, tok, signal);
    } catch (err) {
      if (isAbortError(err) || signal.aborted || isLocallyAborted()) {
        throw new DOMException('Upload aborted', 'AbortError');
      }
      if (attempt >= maxAttempts || !isRetryableError(err)) {
        console.warn('[DropDex] Batch upload failed after', attempt, 'attempt(s):', err);
        return null;
      }

      const backoffMs = Math.pow(2, attempt - 1) * 1000 + Math.random() * 500;
      await waitForAbortableDelay(backoffMs, signal, retryTimers, isLocallyAborted);
      throwIfCancelled(signal, isLocallyAborted);
    }
  }
  return null;
}
