import { useState, useEffect } from 'react';
import { fetchArtistDetail } from '../lib/api/discovery';
import type { DiscoveryArtistDetail } from '../types';

export function useArtistDetail(artistId: string | null, accessToken: string | null) {
  const [detail, setDetail] = useState<DiscoveryArtistDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!artistId || !accessToken) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchArtistDetail(artistId, accessToken)
      .then((d) => { if (!cancelled) { setDetail(d); setLoading(false); } })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load artist detail');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [artistId, accessToken]);

  return { detail, loading, error };
}
