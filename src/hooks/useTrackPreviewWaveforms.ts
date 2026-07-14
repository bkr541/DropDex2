/**
 * Track-scoped waveform loading with a shared bounded cache.
 *
 * The hook never infers absence from a failed query. Every track has a typed
 * state, request results are gated by import, track ID, and request token, and
 * confirmed absence is periodically rechecked so a completed reparse becomes
 * visible without a full-page reload.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoundedTtlCache } from '../lib/cache/boundedTtlCache';
import {
  fetchTrackPreviewWaveforms,
  WAVEFORM_CHUNK_SIZE,
} from '../lib/queries/analysisData';
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

const CACHE_MAX_ENTRIES = 2_000;
const CACHE_TTL_LOADED_MS = 10 * 60_000;
const CACHE_TTL_INVALID_MS = 5 * 60_000;
const CACHE_TTL_ERROR_MS = 15_000;
const CACHE_TTL_UNAVAILABLE_MS = 30_000;

const waveformCache = new BoundedTtlCache<string, ResolvedWaveformLoadState>({
  maxEntries: CACHE_MAX_ENTRIES,
  ttlMs: CACHE_TTL_LOADED_MS,
});

function cacheKey(importId: string, trackId: string): string {
  return `${importId}\u0000${trackId}`;
}

function cacheTtl(state: ResolvedWaveformLoadState): number {
  switch (state.status) {
    case 'loaded':
      return CACHE_TTL_LOADED_MS;
    case 'invalid':
      return CACHE_TTL_INVALID_MS;
    case 'error':
      return CACHE_TTL_ERROR_MS;
    case 'unavailable':
      return CACHE_TTL_UNAVAILABLE_MS;
  }
}

export function getCachedWaveformState(
  importId: string,
  trackId: string,
): ResolvedWaveformLoadState | undefined {
  return waveformCache.get(cacheKey(importId, trackId));
}

export function setCachedWaveformState(
  importId: string,
  state: ResolvedWaveformLoadState,
): void {
  waveformCache.set(cacheKey(importId, state.trackId), state, cacheTtl(state));
}

/** Invalidate one import, selected tracks, or the entire shared waveform cache. */
export function invalidatePreviewWaveformCache(
  importId?: string,
  trackIds?: string[],
): void {
  if (!importId) {
    waveformCache.clear();
    return;
  }
  const selected = trackIds ? new Set(trackIds) : null;
  const prefix = `${importId}\u0000`;
  waveformCache.deleteWhere((key) => {
    if (!key.startsWith(prefix)) return false;
    if (!selected) return true;
    return selected.has(key.slice(prefix.length));
  });
}

export interface UseTrackPreviewWaveformsResult {
  /** Current state keyed by track ID. */
  states: Map<string, WaveformLoadState>;
  /** Number of in-flight query chunks started by this hook instance. */
  loadingBatchCount: number;
  /** Retry one or more failures or confirmed-unavailable results. */
  retry: (trackIds?: string[]) => void;
  /** Stable helper that returns an idle state for an unseen track. */
  getState: (trackId: string | null | undefined) => WaveformLoadState;
}

export function useTrackPreviewWaveforms(
  importId: string | null,
  trackIds: string[],
): UseTrackPreviewWaveformsResult {
  const [states, setStates] = useState<Map<string, WaveformLoadState>>(
    new Map(),
  );
  const [loadingBatchCount, setLoadingBatchCount] = useState(0);
  const [retryTrigger, setRetryTrigger] = useState(0);

  const activeImportRef = useRef<string | null>(importId);
  const activeTrackIdsRef = useRef<Set<string>>(new Set(trackIds));
  const inFlightRef = useRef<Map<string, number>>(new Map());
  const requestTokensRef = useRef<Map<string, number>>(new Map());
  const activeBatchCountsRef = useRef<Map<number, number>>(new Map());
  const nextRequestTokenRef = useRef(0);
  const unavailableRecheckTimerRef = useRef<number | null>(null);

  activeImportRef.current = importId;
  activeTrackIdsRef.current = new Set(trackIds);

  const trackIdsKey = useMemo(
    () => [...new Set(trackIds.filter(Boolean))].sort().join(','),
    [trackIds],
  );
  const requestedIds = useMemo(
    () => (trackIdsKey ? trackIdsKey.split(',') : []),
    [trackIdsKey],
  );

  useEffect(
    () => () => {
      if (unavailableRecheckTimerRef.current !== null) {
        window.clearTimeout(unavailableRecheckTimerRef.current);
        unavailableRecheckTimerRef.current = null;
      }
    },
    [],
  );

  // Import changes invalidate all in-flight UI commits from the previous import.
  useEffect(() => {
    if (unavailableRecheckTimerRef.current !== null) {
      window.clearTimeout(unavailableRecheckTimerRef.current);
      unavailableRecheckTimerRef.current = null;
    }
    inFlightRef.current = new Map();
    requestTokensRef.current = new Map();
    activeBatchCountsRef.current = new Map();
    setLoadingBatchCount(0);

    if (!importId) {
      setStates(new Map());
      return;
    }

    const hydrated = new Map<string, WaveformLoadState>();
    for (const trackId of requestedIds) {
      const cached = getCachedWaveformState(importId, trackId);
      if (cached) hydrated.set(trackId, cached);
    }
    setStates(hydrated);
    // requested IDs are handled by the fetch effect; this reset is import-scoped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importId]);

  useEffect(() => {
    if (!importId || !trackIdsKey) return;

    const cachedForActiveIds = requestedIds
      .map((trackId) => getCachedWaveformState(importId, trackId))
      .filter(
        (state): state is ResolvedWaveformLoadState => state !== undefined,
      );
    if (cachedForActiveIds.length > 0) {
      setStates((previous) => {
        const next = new Map(previous);
        for (const state of cachedForActiveIds) next.set(state.trackId, state);
        return next;
      });
    }

    const idsToFetch = requestedIds.filter(
      (trackId) =>
        !getCachedWaveformState(importId, trackId) &&
        !inFlightRef.current.has(trackId),
    );
    if (idsToFetch.length === 0) return;

    const requestToken = ++nextRequestTokenRef.current;
    for (const trackId of idsToFetch) {
      inFlightRef.current.set(trackId, requestToken);
      requestTokensRef.current.set(trackId, requestToken);
    }

    setStates((previous) => {
      const next = new Map(previous);
      for (const trackId of idsToFetch)
        next.set(trackId, loadingWaveformState(trackId));
      return next;
    });

    const chunkCount = chunkIds(idsToFetch, WAVEFORM_CHUNK_SIZE).length;
    activeBatchCountsRef.current.set(requestToken, chunkCount);
    setLoadingBatchCount(
      [...activeBatchCountsRef.current.values()].reduce(
        (sum, count) => sum + count,
        0,
      ),
    );

    void fetchTrackPreviewWaveforms(idsToFetch)
      .then((result) => {
        const visibleUpdates: ResolvedWaveformLoadState[] = [];
        let hasUnavailable = false;

        for (const trackId of idsToFetch) {
          const ownsInFlightSlot =
            inFlightRef.current.get(trackId) === requestToken;
          if (ownsInFlightSlot) inFlightRef.current.delete(trackId);
          if (
            !shouldAcceptWaveformResult(
              requestTokensRef.current.get(trackId),
              requestToken,
            )
          ) {
            continue;
          }

          const state = result.states.get(trackId) ?? {
            status: 'error' as const,
            trackId,
            error: 'Waveform request completed without a track-scoped result.',
            retryable: true as const,
          };

          setCachedWaveformState(importId, state);
          hasUnavailable ||= state.status === 'unavailable';

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

        // A parser may still be finishing in the background. Recheck confirmed
        // absence after its short negative-cache TTL instead of pinning it forever.
        if (hasUnavailable) {
          if (unavailableRecheckTimerRef.current !== null) {
            window.clearTimeout(unavailableRecheckTimerRef.current);
          }
          unavailableRecheckTimerRef.current = window.setTimeout(() => {
            unavailableRecheckTimerRef.current = null;
            if (activeImportRef.current !== importId) return;
            setRetryTrigger((value) => value + 1);
          }, CACHE_TTL_UNAVAILABLE_MS + 50);
        }
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Failed to load waveform.';
        const visibleUpdates: ResolvedWaveformLoadState[] = [];

        for (const trackId of idsToFetch) {
          const ownsInFlightSlot =
            inFlightRef.current.get(trackId) === requestToken;
          if (ownsInFlightSlot) inFlightRef.current.delete(trackId);
          if (
            !shouldAcceptWaveformResult(
              requestTokensRef.current.get(trackId),
              requestToken,
            )
          ) {
            continue;
          }
          const state: ResolvedWaveformLoadState = {
            status: 'error',
            trackId,
            error: message,
            retryable: true,
          };
          setCachedWaveformState(importId, state);
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
        if (!activeBatchCountsRef.current.delete(requestToken)) return;
        setLoadingBatchCount(
          [...activeBatchCountsRef.current.values()].reduce(
            (sum, count) => sum + count,
            0,
          ),
        );
      });
  }, [importId, requestedIds, trackIdsKey, retryTrigger]);

  const retry = useCallback(
    (ids?: string[]) => {
      if (!importId) return;
      const candidates = ids ?? requestedIds;
      const retryIds = candidates.filter((trackId) => {
        const status = getCachedWaveformState(importId, trackId)?.status;
        return status === 'error' || status === 'unavailable';
      });
      if (retryIds.length === 0) return;

      invalidatePreviewWaveformCache(importId, retryIds);
      for (const trackId of retryIds) {
        inFlightRef.current.delete(trackId);
        requestTokensRef.current.set(trackId, ++nextRequestTokenRef.current);
      }

      setStates((previous) => {
        const next = new Map(previous);
        for (const trackId of retryIds)
          next.set(trackId, loadingWaveformState(trackId));
        return next;
      });
      setRetryTrigger((value) => value + 1);
    },
    [importId, requestedIds],
  );

  const getState = useCallback(
    (trackId: string | null | undefined) =>
      waveformStateForTrack(states, trackId),
    [states],
  );

  return { states, loadingBatchCount, retry, getState };
}
