/**
 * Track-scoped waveform loading with a shared per-import cache.
 *
 * The hook never infers absence from a failed query. Every track has a typed
 * state, and request results are gated by import, track ID, and request token.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchTrackPreviewWaveforms, WAVEFORM_CHUNK_SIZE } from '../lib/queries/analysisData';
import {
  chunkIds,
  loadingWaveformState,
  waveformStateForTrack,
  type ResolvedWaveformLoadState,
  type WaveformLoadState,
} from '../lib/queries/waveformValidation';
import {
  shouldAcceptWaveformResult,
  shouldExposeWaveformResult,
} from '../lib/queries/waveformRequestGuard';

/** importId → (trackId → terminal state) */
const waveformCache = new Map<string, Map<string, ResolvedWaveformLoadState>>();

function getImportCache(importId: string): Map<string, ResolvedWaveformLoadState> {
  let cache = waveformCache.get(importId);
  if (!cache) {
    cache = new Map();
    waveformCache.set(importId, cache);
  }
  return cache;
}

export function getCachedWaveformState(
  importId: string,
  trackId: string,
): ResolvedWaveformLoadState | undefined {
  return waveformCache.get(importId)?.get(trackId);
}

export function setCachedWaveformState(
  importId: string,
  state: ResolvedWaveformLoadState,
): void {
  getImportCache(importId).set(state.trackId, state);
}

export interface UseTrackPreviewWaveformsResult {
  /** Current state keyed by track ID. */
  states: Map<string, WaveformLoadState>;
  /** Number of in-flight query chunks started by this hook instance. */
  loadingBatchCount: number;
  /** Retry one or more retryable failures. */
  retry: (trackIds?: string[]) => void;
  /** Stable helper that returns an idle state for an unseen track. */
  getState: (trackId: string | null | undefined) => WaveformLoadState;
}

export function useTrackPreviewWaveforms(
  importId: string | null,
  trackIds: string[],
): UseTrackPreviewWaveformsResult {
  const [states, setStates] = useState<Map<string, WaveformLoadState>>(new Map());
  const [loadingBatchCount, setLoadingBatchCount] = useState(0);
  const [retryTrigger, setRetryTrigger] = useState(0);

  const activeImportRef = useRef<string | null>(importId);
  const activeTrackIdsRef = useRef<Set<string>>(new Set(trackIds));
  const inFlightRef = useRef<Map<string, number>>(new Map());
  const requestTokensRef = useRef<Map<string, number>>(new Map());
  const nextRequestTokenRef = useRef(0);

  activeImportRef.current = importId;
  activeTrackIdsRef.current = new Set(trackIds);

  const trackIdsKey = useMemo(
    () => [...new Set(trackIds.filter(Boolean))].sort().join(','),
    [trackIds],
  );

  // Import changes invalidate all in-flight UI commits from the previous import.
  useEffect(() => {
    inFlightRef.current = new Map();
    requestTokensRef.current = new Map();
    setLoadingBatchCount(0);

    if (!importId) {
      setStates(new Map());
      return;
    }

    const cache = getImportCache(importId);
    const hydrated = new Map<string, WaveformLoadState>();
    for (const [trackId, state] of cache) hydrated.set(trackId, state);
    setStates(hydrated);
  }, [importId]);

  useEffect(() => {
    if (!importId || !trackIdsKey) return;

    const requestedIds = [...new Set(trackIds.filter(Boolean))];
    const cache = getImportCache(importId);

    // Another mounted consumer may have warmed the shared cache. Mirror those
    // entries before deciding what still needs a request.
    const cachedForActiveIds = requestedIds
      .map((trackId) => cache.get(trackId))
      .filter((state): state is ResolvedWaveformLoadState => state !== undefined);
    if (cachedForActiveIds.length > 0) {
      setStates((previous) => {
        const next = new Map(previous);
        for (const state of cachedForActiveIds) next.set(state.trackId, state);
        return next;
      });
    }

    const idsToFetch = requestedIds.filter(
      (trackId) => !cache.has(trackId) && !inFlightRef.current.has(trackId),
    );
    if (idsToFetch.length === 0) return;

    const requestToken = ++nextRequestTokenRef.current;
    for (const trackId of idsToFetch) {
      inFlightRef.current.set(trackId, requestToken);
      requestTokensRef.current.set(trackId, requestToken);
    }

    setStates((previous) => {
      const next = new Map(previous);
      for (const trackId of idsToFetch) next.set(trackId, loadingWaveformState(trackId));
      return next;
    });

    const chunkCount = chunkIds(idsToFetch, WAVEFORM_CHUNK_SIZE).length;
    setLoadingBatchCount((count) => count + chunkCount);

    void fetchTrackPreviewWaveforms(idsToFetch)
      .then((result) => {
        const visibleUpdates: ResolvedWaveformLoadState[] = [];

        for (const trackId of idsToFetch) {
          if (!shouldAcceptWaveformResult(requestTokensRef.current.get(trackId), requestToken)) {
            continue;
          }

          const state = result.states.get(trackId) ?? {
            status: 'error' as const,
            trackId,
            error: 'Waveform request completed without a track-scoped result.',
            retryable: true as const,
          };

          cache.set(trackId, state);
          inFlightRef.current.delete(trackId);

          if (
            shouldExposeWaveformResult(
              activeImportRef.current,
              importId,
              activeTrackIdsRef.current,
              trackId,
            )
          ) {
            visibleUpdates.push(state);
          }
        }

        if (visibleUpdates.length > 0) {
          setStates((previous) => {
            const next = new Map(previous);
            for (const state of visibleUpdates) next.set(state.trackId, state);
            return next;
          });
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to load waveform.';
        const visibleUpdates: ResolvedWaveformLoadState[] = [];

        for (const trackId of idsToFetch) {
          if (!shouldAcceptWaveformResult(requestTokensRef.current.get(trackId), requestToken)) {
            continue;
          }
          const state: ResolvedWaveformLoadState = {
            status: 'error',
            trackId,
            error: message,
            retryable: true,
          };
          cache.set(trackId, state);
          inFlightRef.current.delete(trackId);
          if (
            shouldExposeWaveformResult(
              activeImportRef.current,
              importId,
              activeTrackIdsRef.current,
              trackId,
            )
          ) {
            visibleUpdates.push(state);
          }
        }

        if (visibleUpdates.length > 0) {
          setStates((previous) => {
            const next = new Map(previous);
            for (const state of visibleUpdates) next.set(state.trackId, state);
            return next;
          });
        }
      })
      .finally(() => {
        setLoadingBatchCount((count) => Math.max(0, count - chunkCount));
      });
  // `trackIdsKey` intentionally replaces the array reference in the dependency list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importId, trackIdsKey, retryTrigger]);

  const retry = useCallback((ids?: string[]) => {
    if (!importId) return;
    const cache = getImportCache(importId);
    const candidates = ids ?? [...cache.keys()];
    const retryIds = candidates.filter((trackId) => cache.get(trackId)?.status === 'error');
    if (retryIds.length === 0) return;

    for (const trackId of retryIds) {
      cache.delete(trackId);
      inFlightRef.current.delete(trackId);
      requestTokensRef.current.set(trackId, ++nextRequestTokenRef.current);
    }

    setStates((previous) => {
      const next = new Map(previous);
      for (const trackId of retryIds) next.set(trackId, loadingWaveformState(trackId));
      return next;
    });
    setRetryTrigger((value) => value + 1);
  }, [importId]);

  const getState = useCallback(
    (trackId: string | null | undefined) => waveformStateForTrack(states, trackId),
    [states],
  );

  return { states, loadingBatchCount, retry, getState };
}
