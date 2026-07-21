import { useEffect, useRef, useState } from 'react';
import type { DiscoveryArtist } from '../types';
import { searchDiscoveryArtists } from '../lib/api/discovery';
import { isAbortError } from '../lib/api/responseValidation';

export function useArtistDiscoverySearch(query: string, accessToken: string | null) {
  const [results, setResults] = useState<DiscoveryArtist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    const trimmed = query.trim();

    if (trimmed.length < 2 || !accessToken) {
      setResults([]);
      setLoading(false);
      setError(null);
      return () => controller.abort();
    }

    const timer = window.setTimeout(() => {
      if (generation !== generationRef.current) return;
      setLoading(true);
      setError(null);
      searchDiscoveryArtists(trimmed, accessToken, controller.signal)
        .then((nextResults) => {
          if (generation !== generationRef.current) return;
          setResults(nextResults);
        })
        .catch((err: unknown) => {
          if (generation !== generationRef.current || isAbortError(err)) return;
          setError(err instanceof Error ? err.message : 'Search failed');
          setResults([]);
        })
        .finally(() => {
          if (generation === generationRef.current) setLoading(false);
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, accessToken]);

  return { results, loading, error };
}
