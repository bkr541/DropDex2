/**
 * Hook for bulk-fetching preview waveform data for tracks shown in the Tracks tab.
 *
 * Caching strategy:
 * - Module-level cache keyed by importId → (trackId → CacheValue)
 * - Cache survives tab switches, sorts, and filter changes within the same session
 * - Cache is invalidated when importId changes (different import = different dataset)
 * - Only IDs not already in the cache (and not in-flight) are queried
 * - Tracks confirmed absent from a successful chunk receive 'unavailable'
 * - Tracks in a FAILED chunk receive 'query_failed' (retryable, not shown as unavailable)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchTrackPreviewWaveforms } from '../lib/queries/analysisData';
import type { TrackPreviewWaveform } from '../lib/queries/analysisData';
import { chunkIds } from '../lib/queries/waveformValidation';
import { WAVEFORM_CHUNK_SIZE } from '../lib/queries/analysisData';

// ── Module-level cache ─────────────────────────────────────────────────────────

const UNAVAILABLE = 'unavailable' as const;
/** Transient query failure — safe to retry; must NOT be treated as confirmed absent. */
const QUERY_FAILED = 'query_failed' as const;

type CacheValue = TrackPreviewWaveform | typeof UNAVAILABLE | typeof QUERY_FAILED;

/** importId → (trackId → CacheValue) */
const waveformCache = new Map<string, Map<string, CacheValue>>();

function getImportCache(importId: string): Map<string, CacheValue> {
  if (!waveformCache.has(importId)) waveformCache.set(importId, new Map());
  return waveformCache.get(importId)!;
}

/**
 * Read a single entry from the module-level cache without triggering a fetch.
 * Returns undefined when the track has not been queried yet (cache miss).
 * Returns null when the track is confirmed to have no waveform row.
 * Returns a TrackPreviewWaveform when data is available.
 */
export function getCachedWaveform(
  importId: string,
  trackId: string,
): TrackPreviewWaveform | null | undefined {
  const v = waveformCache.get(importId)?.get(trackId);
  if (v === undefined) return undefined;
  if (v === UNAVAILABLE) return null;
  if (v === QUERY_FAILED) return undefined; // treat as cache miss for callers
  return v;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export interface UseTrackPreviewWaveformsResult {
  /** Waveforms keyed by track ID for all tracks that have data. */
  waveforms: Map<string, TrackPreviewWaveform>;
  /** Track IDs confirmed to have no waveform row in the database. */
  unavailableIds: Set<string>;
  /**
   * Track IDs whose waveform query failed transiently (network/Supabase error).
   * These are NOT the same as unavailable — their waveforms may load on retry.
   */
  failedQueryIds: Set<string>;
  /** Number of in-flight chunk requests. */
  loadingBatchCount: number;
  /** Non-fatal batch errors — one chunk failure does not block others. */
  errors: string[];
  /**
   * Clear the query_failed cache entries for the given IDs (or all failed IDs
   * if none specified) so the next render triggers a fresh fetch.
   */
  retryFailedChunks: (ids?: string[]) => void;
}

/**
 * Fetch and cache preview waveforms for all currently visible track IDs.
 *
 * @param importId - The active import ID. Cache is scoped per import.
 * @param trackIds - IDs of tracks currently visible in the UI.
 */
export function useTrackPreviewWaveforms(
  importId: string | null,
  trackIds: string[],
): UseTrackPreviewWaveformsResult {
  const [waveforms, setWaveforms] = useState<Map<string, TrackPreviewWaveform>>(new Map());
  const [unavailableIds, setUnavailableIds] = useState<Set<string>>(new Set());
  const [failedQueryIds, setFailedQueryIds] = useState<Set<string>>(new Set());
  const [loadingBatchCount, setLoadingBatchCount] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  // Incremented by retryFailedChunks to re-trigger the fetch effect.
  const [retryTrigger, setRetryTrigger] = useState(0);

  // Set of IDs currently being fetched to prevent duplicate requests.
  const inflightRef = useRef<Set<string>>(new Set());

  // Stable key representing the de-duped, sorted set of visible IDs.
  // The effect re-runs only when the actual set of IDs changes.
  const trackIdsKey = useMemo(
    () => [...new Set(trackIds)].sort().join(','),
    [trackIds],
  );

  // Reset state when the import changes.
  useEffect(() => {
    if (!importId) {
      setWaveforms(new Map());
      setUnavailableIds(new Set());
      setFailedQueryIds(new Set());
      setErrors([]);
      setLoadingBatchCount(0);
      inflightRef.current = new Set();
      return;
    }

    // Hydrate state from the module-level cache (fast path when returning to tab).
    const cache = getImportCache(importId);
    const newWaveforms = new Map<string, TrackPreviewWaveform>();
    const newUnavailable = new Set<string>();
    const newFailed = new Set<string>();
    for (const [id, val] of cache) {
      if (val === UNAVAILABLE) newUnavailable.add(id);
      else if (val === QUERY_FAILED) newFailed.add(id);
      else newWaveforms.set(id, val);
    }
    setWaveforms(newWaveforms);
    setUnavailableIds(newUnavailable);
    setFailedQueryIds(newFailed);
    setErrors([]);
    setLoadingBatchCount(0);
    inflightRef.current = new Set();
  }, [importId]);

  // Fetch waveforms for newly visible IDs.
  useEffect(() => {
    if (!importId || !trackIdsKey) return;

    const cache = getImportCache(importId);

    // Fetch IDs not yet cached (or previously query_failed will be re-fetched
    // only after retryFailedChunks clears them from the cache).
    const idsToFetch = [...new Set(trackIds)].filter(
      (id) => !cache.has(id) && !inflightRef.current.has(id),
    );
    if (idsToFetch.length === 0) return;

    // Mark as in-flight.
    for (const id of idsToFetch) inflightRef.current.add(id);

    const chunks = chunkIds(idsToFetch, WAVEFORM_CHUNK_SIZE);
    setLoadingBatchCount((n) => n + chunks.length);

    (async () => {
      const { waveforms: fetched, successfulTrackIds, errors: fetchErrors } =
        await fetchTrackPreviewWaveforms(idsToFetch);

      // Remove from in-flight set.
      for (const id of idsToFetch) inflightRef.current.delete(id);

      // ── Cache update ────────────────────────────────────────────────────────
      // Successful rows: cache the waveform data.
      for (const [id, wf] of fetched) cache.set(id, wf);

      // Confirmed-absent: in a successful chunk but no DB row returned.
      // Only mark unavailable for IDs in successful chunks — not failed ones.
      for (const id of successfulTrackIds) {
        if (!fetched.has(id)) cache.set(id, UNAVAILABLE);
      }

      // Failed-chunk IDs: transient error — cache as QUERY_FAILED so they
      // don't re-fetch on every render, but are NOT marked as unavailable.
      const failedIds = new Set<string>();
      for (const e of fetchErrors) {
        for (const id of e.trackIds) {
          cache.set(id, QUERY_FAILED);
          failedIds.add(id);
        }
      }

      // ── React state update ──────────────────────────────────────────────────
      setWaveforms((prev) => {
        const next = new Map(prev);
        for (const [id, wf] of fetched) next.set(id, wf);
        return next;
      });
      setUnavailableIds((prev) => {
        const next = new Set(prev);
        for (const id of successfulTrackIds) {
          if (!fetched.has(id)) next.add(id);
        }
        return next;
      });
      setFailedQueryIds((prev) => {
        if (failedIds.size === 0) return prev;
        const next = new Set(prev);
        for (const id of failedIds) next.add(id);
        return next;
      });

      if (fetchErrors.length > 0) {
        setErrors((prev) => [
          ...prev,
          ...fetchErrors.map(
            (e) => `Chunk ${e.chunkIndex} (${e.trackIds.length} IDs): ${e.error}`,
          ),
        ]);
      }
      setLoadingBatchCount((n) => Math.max(0, n - chunks.length));
    })();
  // trackIdsKey is derived from trackIds — using it instead avoids array-reference churn.
  // retryTrigger re-activates the effect after retryFailedChunks clears cache entries.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importId, trackIdsKey, retryTrigger]);

  const retryFailedChunks = useCallback((ids?: string[]) => {
    if (!importId) return;
    const cache = getImportCache(importId);
    const toRetry = ids ?? [...cache.keys()].filter((id) => cache.get(id) === QUERY_FAILED);
    if (toRetry.length === 0) return;
    for (const id of toRetry) cache.delete(id);
    setFailedQueryIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const id of toRetry) next.delete(id);
      return next;
    });
    setErrors([]);
    // Increment trigger so the fetch effect re-runs even though trackIdsKey
    // and importId are unchanged — the cleared IDs are now cache misses again.
    setRetryTrigger((n) => n + 1);
  }, [importId]);

  return { waveforms, unavailableIds, failedQueryIds, loadingBatchCount, errors, retryFailedChunks };
}
