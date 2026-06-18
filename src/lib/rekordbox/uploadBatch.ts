/**
 * Shared batch-upload utilities used by both the initial import and the
 * resume analysis flows.
 */

import { supabase } from '../supabase';
import { uploadRekordboxAnalysisBatch } from '../api/rekordboxImport';
import type { BatchUploadResponse } from '../api/rekordboxImport';
import type { MatchedAnalysisFile } from './analysisPaths';

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

/**
 * Upload one batch of ANLZ files with request-level retry (exponential
 * back-off). Returns the response, or null if all attempts fail.
 * Throws on AbortError so the caller can detect cancellation.
 */
export async function uploadBatchWithRetry(
  importId: string,
  batch: MatchedAnalysisFile[],
  fallbackToken: string,
  signal: AbortSignal,
  maxAttempts = 3,
): Promise<BatchUploadResponse | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token ?? fallbackToken;
      return await uploadRekordboxAnalysisBatch(importId, batch, tok, signal);
    } catch (err) {
      if (isAbortError(err)) throw err;
      if (attempt >= maxAttempts || !isRetryableError(err)) {
        console.warn('[DropDex] Batch upload failed after', attempt, 'attempt(s):', err);
        return null;
      }
      const backoffMs = Math.pow(2, attempt - 1) * 1000 + Math.random() * 500;
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  return null;
}
