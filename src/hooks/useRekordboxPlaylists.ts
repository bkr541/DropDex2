import { useEffect, useRef, useState } from 'react';
import type { PlaylistWithCount } from '../lib/queries/rekordbox';
import { fetchPlaylists } from '../lib/queries/rekordbox';

export function useRekordboxPlaylists(importId: string | null) {
  const [playlists, setPlaylists] = useState<PlaylistWithCount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    let cancelled = false;

    if (!importId) {
      setPlaylists([]);
      setLoading(false);
      setError(null);
      return;
    }

    // Clear the prior import immediately so a slower response from that scope can
    // never remain selectable while the new import's playlists are resolving.
    setPlaylists([]);
    setLoading(true);
    setError(null);

    void fetchPlaylists(importId)
      .then((nextPlaylists) => {
        if (cancelled || generation !== generationRef.current) return;
        setPlaylists(nextPlaylists);
      })
      .catch((err: unknown) => {
        if (cancelled || generation !== generationRef.current) return;
        setPlaylists([]);
        setError(err instanceof Error ? err.message : 'Failed to load playlists');
      })
      .finally(() => {
        if (!cancelled && generation === generationRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [importId]);

  return { playlists, loading, error };
}
