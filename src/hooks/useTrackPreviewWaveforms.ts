/**
 * Hook for bulk-fetching preview waveform data for tracks shown in the Tracks tab.
 *
 * Caching strategy:
 * - Module-level cache keyed by importId → (trackId → TrackPreviewWaveform | 'unavailable')
 * - Cache survives tab switches, sorts, and filter changes within the same session
 * - Cache is invalidated when importId changes (different import = different dataset)
 * - Only IDs not already in the cache (and not in-flight) are queried
 * - Tracks with no waveform row receive an explicit 'unavailable' marker
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchTrackPreviewWaveforms } from '../lib/queries/analysisData';
import type { TrackPreviewWaveform } from '../lib/queries/analysisData';
import { chunkIds } from '../lib/queries/waveformValidation';
import { WAVEFORM_CHUNK_SIZE } from '../lib/queries/analysisData';

// ── Module-level cache ─────────────────────────────────────────────────────────

const UNAVAILABLE = 'unavailable' as const;
type CacheValue = TrackPreviewWaveform | typeof UNAVAILABLE;

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
  return v;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export interface UseTrackPreviewWaveformsResult {
  /** Waveforms keyed by track ID for all tracks that have data. */
  waveforms: Map<string, TrackPreviewWaveform>;
  /** Track IDs confirmed to have no waveform row in the database. */
  unavailableIds: Set<string>;
  /** Number of in-flight chunk requests. */
  loadingBatchCount: number;
  /** Non-fatal batch errors — one chunk failure does not block others. */
  errors: string[];
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
  const [loadingBatchCount, setLoadingBatchCount] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

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
      setErrors([]);
      setLoadingBatchCount(0);
      inflightRef.current = new Set();
      return;
    }

    // Hydrate state from the module-level cache (fast path when returning to tab).
    const cache = getImportCache(importId);
    const newWaveforms = new Map<string, TrackPreviewWaveform>();
    const newUnavailable = new Set<string>();
    for (const [id, val] of cache) {
      if (val === UNAVAILABLE) newUnavailable.add(id);
      else newWaveforms.set(id, val);
    }
    setWaveforms(newWaveforms);
    setUnavailableIds(newUnavailable);
    setErrors([]);
    setLoadingBatchCount(0);
    inflightRef.current = new Set();
  }, [importId]);

  // Fetch waveforms for newly visible IDs.
  useEffect(() => {
    if (!importId || !trackIdsKey) return;

    const cache = getImportCache(importId);

    // Only fetch IDs that are not cached and not currently in-flight.
    const idsToFetch = [...new Set(trackIds)].filter(
      (id) => !cache.has(id) && !inflightRef.current.has(id),
    );
    if (idsToFetch.length === 0) return;

    // Mark as in-flight.
    for (const id of idsToFetch) inflightRef.current.add(id);

    const chunks = chunkIds(idsToFetch, WAVEFORM_CHUNK_SIZE);
    setLoadingBatchCount((n) => n + chunks.length);

    (async () => {
      const { waveforms: fetched, errors: fetchErrors } =
        await fetchTrackPreviewWaveforms(idsToFetch);

      // Remove from in-flight set.
      for (const id of idsToFetch) inflightRef.current.delete(id);

      // Determine which fetched IDs had no matching row.
      const fetchedIds = new Set(fetched.keys());

      // Update module-level cache.
      for (const [id, wf] of fetched) cache.set(id, wf);
      for (const id of idsToFetch) {
        if (!fetchedIds.has(id)) cache.set(id, UNAVAILABLE);
      }

      // Update React state.
      setWaveforms((prev) => {
        const next = new Map(prev);
        for (const [id, wf] of fetched) next.set(id, wf);
        return next;
      });
      setUnavailableIds((prev) => {
        const next = new Set(prev);
        for (const id of idsToFetch) {
          if (!fetchedIds.has(id)) next.add(id);
        }
        return next;
      });
      if (fetchErrors.length > 0) {
        setErrors((prev) => [
          ...prev,
          ...fetchErrors.map((e) => `Chunk ${e.chunkIndex}: ${e.error}`),
        ]);
        // Remove from in-flight even on error so they can be retried next render.
        for (const id of idsToFetch) inflightRef.current.delete(id);
      }
      setLoadingBatchCount((n) => Math.max(0, n - chunks.length));
    })();
  // trackIdsKey is derived from trackIds — using it instead avoids array-reference churn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importId, trackIdsKey]);

  return { waveforms, unavailableIds, loadingBatchCount, errors };
}
