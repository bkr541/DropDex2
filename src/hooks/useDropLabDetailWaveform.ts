import { useCallback, useEffect, useRef, useState } from 'react';
import { BoundedTtlCache } from '../lib/cache/boundedTtlCache';
import { supabase } from '../lib/supabase';
import {
  buildDetailWaveformState,
  idleWaveformState,
  loadingWaveformState,
  type ResolvedWaveformLoadState,
  type WaveformLoadState,
} from '../lib/queries/waveformValidation';

const DETAIL_CACHE_MAX_ENTRIES = 250;
const DETAIL_CACHE_TTL_LOADED_MS = 10 * 60_000;
const DETAIL_CACHE_TTL_INVALID_MS = 5 * 60_000;

const detailCache = new BoundedTtlCache<string, ResolvedWaveformLoadState>({
  maxEntries: DETAIL_CACHE_MAX_ENTRIES,
  ttlMs: DETAIL_CACHE_TTL_LOADED_MS,
});

export function invalidateDetailWaveformCache(
  importId?: string,
  trackIds?: string[],
): void {
  if (!importId) {
    detailCache.clear();
    return;
  }
  const selected = trackIds ? new Set(trackIds) : null;
  const prefix = `${importId}\u0000`;
  detailCache.deleteWhere((key) => {
    if (!key.startsWith(prefix)) return false;
    if (!selected) return true;
    const trackId = key.slice(prefix.length).split('\u0000', 1)[0];
    return selected.has(trackId);
  });
}

async function parseDetailBlob(blob: Blob): Promise<unknown> {
  let decompressionError: unknown = null;

  if ('DecompressionStream' in window) {
    try {
      const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
      const text = await new Response(stream).text();
      return JSON.parse(text) as unknown;
    } catch (error) {
      decompressionError = error;
    }
  }

  // Development fixtures or migrated storage objects may be plain JSON.
  try {
    return JSON.parse(await blob.text()) as unknown;
  } catch (plainJsonError) {
    const detail =
      decompressionError instanceof Error
        ? decompressionError.message
        : plainJsonError instanceof Error
          ? plainJsonError.message
          : 'Unknown decode error';
    throw new Error(`Detailed waveform could not be decoded: ${detail}`);
  }
}

export interface DropLabDetailWaveformResult {
  /** Best waveform available for rendering, usually detail with preview fallback. */
  displayState: WaveformLoadState;
  /** State of the detail-storage request itself. */
  detailState: WaveformLoadState;
  usedFallback: boolean;
  retry: () => void;
}

export function useDropLabDetailWaveform(
  importId: string | null,
  trackId: string | null,
  previewState: WaveformLoadState | undefined,
): DropLabDetailWaveformResult {
  const initialPreview = previewState ?? idleWaveformState(trackId);
  const [displayState, setDisplayState] =
    useState<WaveformLoadState>(initialPreview);
  const [detailState, setDetailState] = useState<WaveformLoadState>(
    idleWaveformState(trackId),
  );
  const [usedFallback, setUsedFallback] = useState(false);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    // Invalidate every older request before any early return. This prevents a
    // detail response for Track A from landing after selection moved to Track B.
    const requestId = ++requestIdRef.current;
    const currentPreview = previewState ?? idleWaveformState(trackId);
    setDisplayState(currentPreview);
    setUsedFallback(false);

    if (!importId || !trackId) {
      setDetailState(idleWaveformState(trackId));
      return;
    }

    if (currentPreview.status !== 'loaded') {
      setDetailState(idleWaveformState(trackId));
      return;
    }

    const previewWaveform = currentPreview.waveform;
    if (
      !previewWaveform.detailStorageBucket ||
      !previewWaveform.detailStoragePath
    ) {
      // Do not cache absence. Analysis may still be finishing and a later
      // preview-row refresh can expose a newly generated detail object.
      setDetailState({ status: 'unavailable', trackId });
      setUsedFallback(true);
      return;
    }

    const cacheKey = [
      importId,
      trackId,
      previewWaveform.parserVersion ?? 'unknown-parser',
      previewWaveform.detailStorageBucket,
      previewWaveform.detailStoragePath,
    ].join('\u0000');
    const cached = detailCache.get(cacheKey);
    if (cached) {
      setDetailState(cached);
      if (cached.status === 'loaded') {
        setDisplayState(cached);
        setUsedFallback(false);
      } else {
        setDisplayState(currentPreview);
        setUsedFallback(true);
      }
      return;
    }

    setDetailState(loadingWaveformState(trackId));

    void (async () => {
      const { data, error } = await supabase.storage
        .from(previewWaveform.detailStorageBucket!)
        .download(previewWaveform.detailStoragePath!);
      if (error || !data) {
        throw new Error(
          error?.message ?? 'Detailed waveform download returned no data.',
        );
      }

      try {
        const payload = await parseDetailBlob(data);
        return buildDetailWaveformState(trackId, previewWaveform, payload);
      } catch (decodeError) {
        return {
          status: 'invalid' as const,
          trackId,
          error:
            decodeError instanceof Error
              ? decodeError.message
              : 'Detailed waveform could not be decoded.',
          reason: 'invalid' as const,
          retryable: false as const,
        };
      }
    })()
      .then((resolved) => {
        if (requestId !== requestIdRef.current || resolved.trackId !== trackId)
          return;
        setDetailState(resolved);
        if (resolved.status === 'loaded') {
          detailCache.set(cacheKey, resolved, DETAIL_CACHE_TTL_LOADED_MS);
          setDisplayState(resolved);
          setUsedFallback(false);
        } else {
          // Invalid detail is deterministic for a specific parser-versioned
          // object, but it is bounded and expires so a repaired object can win.
          if (resolved.status === 'invalid') {
            detailCache.set(cacheKey, resolved, DETAIL_CACHE_TTL_INVALID_MS);
          }
          setDisplayState(currentPreview);
          setUsedFallback(true);
        }
      })
      .catch((error: unknown) => {
        if (requestId !== requestIdRef.current) return;
        const failure: ResolvedWaveformLoadState = {
          status: 'error',
          trackId,
          error:
            error instanceof Error
              ? error.message
              : 'Detailed waveform failed to load.',
          retryable: true,
        };
        // Transport failures are intentionally not cached. A retry should make
        // a real network request rather than rediscovering a cached failure.
        setDetailState(failure);
        setDisplayState(currentPreview);
        setUsedFallback(true);
      });
  }, [importId, trackId, previewState, retryTrigger]);

  const retry = useCallback(() => {
    if (
      !trackId ||
      (detailState.status !== 'error' && detailState.status !== 'unavailable')
    )
      return;
    if (importId) invalidateDetailWaveformCache(importId, [trackId]);
    setRetryTrigger((value) => value + 1);
  }, [detailState.status, importId, trackId]);

  return { displayState, detailState, usedFallback, retry };
}
