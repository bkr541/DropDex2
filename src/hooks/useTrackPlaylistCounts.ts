import { useCallback, useEffect, useMemo, useState } from 'react';
import { BoundedTtlCache } from '../lib/cache/boundedTtlCache';
import { logger } from '../lib/logger';
import { fetchTrackPlaylistCounts } from '../lib/queries/trackPlaylistCounts';

const countCache = new BoundedTtlCache<string, number>({ maxEntries: 5_000, ttlMs: 2 * 60_000 });

export interface TrackPlaylistCounts {
  /** Playlist count for each track that has loaded. */
  counts: Map<string, number>;
  loading: boolean;
  /** Plain-language message if the counts could not be loaded. */
  error: string | null;
  retry: () => void;
}

/**
 * How many playlists each of these tracks is in. Counts already loaded are reused, so scrolling
 * back or loading more tracks only asks for the new ones.
 */
export function useTrackPlaylistCounts(trackIds: string[], enabled = true): TrackPlaylistCounts {
  const key = useMemo(() => [...new Set(trackIds)].join(','), [trackIds]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (!enabled || ids.length === 0) {
      setCounts(new Map());
      setLoading(false);
      setError(null);
      return;
    }
    const known = new Map<string, number>();
    const missing: string[] = [];
    for (const id of ids) {
      const cached = countCache.get(id);
      if (cached === undefined) missing.push(id);
      else known.set(id, cached);
    }
    setCounts(known);
    setError(null);
    if (missing.length === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchTrackPlaylistCounts(missing)
      .then((fetched) => {
        for (const [id, count] of fetched) countCache.set(id, count);
        if (!cancelled) setCounts(new Map([...known, ...fetched]));
      })
      .catch((cause: unknown) => {
        logger.error('library.playlist_counts.load_failed', {
          trackCount: missing.length,
          error: cause instanceof Error ? cause.message : String(cause),
        });
        if (!cancelled) setError('Playlist counts could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [enabled, key, retryNonce]);

  const retry = useCallback(() => setRetryNonce((value) => value + 1), []);
  return { counts, loading, error, retry };
}
