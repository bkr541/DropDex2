import { useState, useEffect } from 'react';
import { fetchArtistsByGenres } from '../lib/queries/artists';
import type { SearchArtist } from '../types';

export function useArtistsByGenre(genres: string[]) {
  const [artists, setArtists] = useState<SearchArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const key = genres.join('\0');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchArtistsByGenres(genres)
      .then((data) => { if (!cancelled) setArtists(data); })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load artists');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { artists, loading, error };
}
