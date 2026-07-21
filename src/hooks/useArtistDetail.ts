import { useEffect, useRef, useState } from 'react';
import { fetchArtistDetail } from '../lib/api/discovery';
import { isAbortError } from '../lib/api/responseValidation';
import type { DiscoveryArtistDetail } from '../types';

export function useArtistDetail(artistId: string | null, accessToken: string | null) {
  const [detail, setDetail] = useState<DiscoveryArtistDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();

    if (!artistId || !accessToken) {
      setDetail(null);
      setLoading(false);
      setError(null);
      return () => controller.abort();
    }

    setLoading(true);
    setError(null);
    fetchArtistDetail(artistId, accessToken, controller.signal)
      .then((nextDetail) => {
        if (generation !== generationRef.current) return;
        setDetail(nextDetail);
      })
      .catch((err: unknown) => {
        if (generation !== generationRef.current || isAbortError(err)) return;
        setError(err instanceof Error ? err.message : 'Failed to load artist detail');
        setDetail(null);
      })
      .finally(() => {
        if (generation === generationRef.current) setLoading(false);
      });

    return () => controller.abort();
  }, [artistId, accessToken]);

  return { detail, loading, error };
}
