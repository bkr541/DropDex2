import { useState, useEffect, useCallback, useRef } from 'react';
import type { DiscoverySetlistResult } from '../types';
import { fetchArtistSetlists } from '../lib/api/discovery';

const PAGE_SIZE = 20;

export function useArtistSetlists(artistId: string | null, accessToken: string | null) {
  const [setlists, setSetlists] = useState<DiscoverySetlistResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!artistId || !accessToken) {
      setSetlists([]);
      setTotal(0);
      offsetRef.current = 0;
      return;
    }
    setLoading(true);
    setError(null);
    offsetRef.current = 0;
    fetchArtistSetlists(artistId, accessToken, PAGE_SIZE, 0)
      .then((page) => {
        setSetlists(page.results);
        setTotal(page.total);
        offsetRef.current = page.results.length;
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load setlists');
        setSetlists([]);
      })
      .finally(() => setLoading(false));
  }, [artistId, accessToken, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  const loadMore = useCallback(() => {
    if (!artistId || !accessToken || loadingMore || loading) return;
    setLoadingMore(true);
    fetchArtistSetlists(artistId, accessToken, PAGE_SIZE, offsetRef.current)
      .then((page) => {
        setSetlists((prev) => [...prev, ...page.results]);
        setTotal(page.total);
        offsetRef.current += page.results.length;
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [artistId, accessToken, loadingMore, loading]);

  const hasMore = setlists.length < total;

  return { setlists, total, loading, loadingMore, error, refetch, loadMore, hasMore };
}
