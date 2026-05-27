import { useState, useEffect } from 'react';
import type { DiscoveryArtist } from '../types';
import { searchDiscoveryArtists } from '../lib/api/discovery';

export function useArtistDiscoverySearch(query: string, accessToken: string | null) {
  const [results, setResults] = useState<DiscoveryArtist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || !accessToken) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    // Debounce: only fire request after 300 ms of inactivity
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      searchDiscoveryArtists(trimmed, accessToken)
        .then(setResults)
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'Search failed');
          setResults([]);
        })
        .finally(() => setLoading(false));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query, accessToken]);

  return { results, loading, error };
}
