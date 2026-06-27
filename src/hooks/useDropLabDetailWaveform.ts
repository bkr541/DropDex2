import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  buildDetailWaveformState,
  idleWaveformState,
  loadingWaveformState,
  type ResolvedWaveformLoadState,
  type WaveformLoadState,
} from '../lib/queries/waveformValidation';

const detailCache = new Map<string, ResolvedWaveformLoadState>();

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
    const detail = decompressionError instanceof Error
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
  const [displayState, setDisplayState] = useState<WaveformLoadState>(initialPreview);
  const [detailState, setDetailState] = useState<WaveformLoadState>(idleWaveformState(trackId));
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
    if (!previewWaveform.detailStorageBucket || !previewWaveform.detailStoragePath) {
      setDetailState({ status: 'unavailable', trackId });
      setUsedFallback(true);
      return;
    }

    const cacheKey = [
      importId,
      trackId,
      previewWaveform.detailStorageBucket,
      previewWaveform.detailStoragePath,
    ].join(':');
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
        throw new Error(error?.message ?? 'Detailed waveform download returned no data.');
      }

      try {
        const payload = await parseDetailBlob(data);
        return buildDetailWaveformState(trackId, previewWaveform, payload);
      } catch (decodeError) {
        return {
          status: 'invalid' as const,
          trackId,
          error: decodeError instanceof Error
            ? decodeError.message
            : 'Detailed waveform could not be decoded.',
          reason: 'invalid' as const,
          retryable: false as const,
        };
      }
    })()
      .then((resolved) => {
        if (requestId !== requestIdRef.current || resolved.trackId !== trackId) return;
        setDetailState(resolved);
        if (resolved.status === 'loaded') {
          detailCache.set(cacheKey, resolved);
          setDisplayState(resolved);
          setUsedFallback(false);
        } else {
          // Invalid detail data is deterministic for this storage object. Cache
          // that terminal state so unrelated rerenders or revisits do not keep
          // downloading and decoding the same malformed payload.
          detailCache.set(cacheKey, resolved);
          setDisplayState(currentPreview);
          setUsedFallback(true);
        }
      })
      .catch((error: unknown) => {
        if (requestId !== requestIdRef.current) return;
        const failure: ResolvedWaveformLoadState = {
          status: 'error',
          trackId,
          error: error instanceof Error ? error.message : 'Detailed waveform failed to load.',
          retryable: true,
        };
        setDetailState(failure);
        setDisplayState(currentPreview);
        setUsedFallback(true);
      });
  }, [importId, trackId, previewState, retryTrigger]);

  const retry = useCallback(() => {
    if (!trackId || detailState.status !== 'error') return;
    setRetryTrigger((value) => value + 1);
  }, [detailState.status, trackId]);

  return { displayState, detailState, usedFallback, retry };
}
