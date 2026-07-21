import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoverySetlistResult } from '../types';
import { fetchArtistSetlists } from '../lib/api/discovery';
import { isAbortError } from '../lib/api/responseValidation';

const PAGE_SIZE = 20;

function mergeUniqueSetlists(
  current: DiscoverySetlistResult[],
  incoming: DiscoverySetlistResult[],
): DiscoverySetlistResult[] {
  const seen = new Set(current.map((setlist) => setlist.id));
  return [...current, ...incoming.filter((setlist) => !seen.has(setlist.id))];
}

export function useArtistSetlists(artistId: string | null, accessToken: string | null) {
  const [setlists, setSetlists] = useState<DiscoverySetlistResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const offsetRef = useRef(0);
  const generationRef = useRef(0);
  const loadMoreControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;

    if (!artistId || !accessToken) {
      setSetlists([]);
      setTotal(0);
      setLoading(false);
      setLoadingMore(false);
      setError(null);
      setLoadMoreError(null);
      offsetRef.current = 0;
      return () => controller.abort();
    }

    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setLoadMoreError(null);
    offsetRef.current = 0;

    fetchArtistSetlists(artistId, accessToken, PAGE_SIZE, 0, controller.signal)
      .then((page) => {
        if (generation !== generationRef.current) return;
        setSetlists(page.results);
        setTotal(page.total);
        offsetRef.current = page.results.length;
      })
      .catch((err: unknown) => {
        if (generation !== generationRef.current || isAbortError(err)) return;
        setError(err instanceof Error ? err.message : 'Failed to load setlists');
        setSetlists([]);
        setTotal(0);
      })
      .finally(() => {
        if (generation === generationRef.current) setLoading(false);
      });

    return () => controller.abort();
  }, [artistId, accessToken, tick]);

  const refetch = useCallback(() => setTick((value) => value + 1), []);

  const loadMore = useCallback(async () => {
    if (!artistId || !accessToken || loadingMore || loading) return;

    const generation = generationRef.current;
    const controller = new AbortController();
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = controller;
    setLoadingMore(true);
    setLoadMoreError(null);

    try {
      const page = await fetchArtistSetlists(
        artistId,
        accessToken,
        PAGE_SIZE,
        offsetRef.current,
        controller.signal,
      );
      if (generation !== generationRef.current) return;
      setSetlists((previous) => mergeUniqueSetlists(previous, page.results));
      setTotal(page.total);
      offsetRef.current += page.results.length;
    } catch (err: unknown) {
      if (generation !== generationRef.current || isAbortError(err)) return;
      setLoadMoreError(err instanceof Error ? err.message : 'Failed to load more setlists');
    } finally {
      if (generation === generationRef.current) setLoadingMore(false);
      if (loadMoreControllerRef.current === controller) loadMoreControllerRef.current = null;
    }
  }, [artistId, accessToken, loadingMore, loading]);

  useEffect(() => () => loadMoreControllerRef.current?.abort(), []);

  const hasMore = setlists.length < total;

  return {
    setlists,
    total,
    loading,
    loadingMore,
    error,
    loadMoreError,
    refetch,
    loadMore,
    retryLoadMore: loadMore,
    hasMore,
  };
}
