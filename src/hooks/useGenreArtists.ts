import { useCallback, useEffect, useState } from 'react';
import { fetchArtistsInGenre } from '../lib/queries/artists';
import { logger } from '../lib/logger';
import type { GenreBrowseArtist } from '../types';

export function useGenreArtists(genreId: string | null) {
  const [artists, setArtists] = useState<GenreBrowseArtist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!genreId) {
      setArtists([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setArtists([]);
    fetchArtistsInGenre(genreId)
      .then((data) => { if (!cancelled) setArtists(data); })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('discovery.genres.artists_failed', { genreId, message });
        if (!cancelled) setError(message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [genreId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { artists, loading, error, retry };
}
