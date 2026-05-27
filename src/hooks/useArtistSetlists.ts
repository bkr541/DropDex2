import { useState, useEffect, useCallback } from 'react';
import type { DiscoverySetlistResult } from '../types';
import { fetchArtistSetlists } from '../lib/api/discovery';

export function useArtistSetlists(artistId: string | null, accessToken: string | null) {
  const [setlists, setSetlists] = useState<DiscoverySetlistResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!artistId || !accessToken) {
      setSetlists([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    fetchArtistSetlists(artistId, accessToken)
      .then((page) => {
        setSetlists(page.results);
        setTotal(page.total);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load setlists');
        setSetlists([]);
      })
      .finally(() => setLoading(false));
  }, [artistId, accessToken, tick]);

  // Stable callback — safe to include in downstream effect dep arrays
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  return { setlists, total, loading, error, refetch };
}
