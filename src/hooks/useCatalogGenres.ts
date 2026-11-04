import { useCallback, useEffect, useState } from 'react';
import { fetchCatalogGenres } from '../lib/queries/artists';
import { logger } from '../lib/logger';
import type { CatalogGenre } from '../types';

export function useCatalogGenres() {
  const [genres, setGenres] = useState<CatalogGenre[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCatalogGenres()
      .then((data) => { if (!cancelled) setGenres(data); })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('discovery.genres.load_failed', { message });
        if (!cancelled) setError(message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { genres, loading, error, retry };
}
