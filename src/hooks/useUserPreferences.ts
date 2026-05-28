import { useState, useEffect, useCallback } from 'react';
import { fetchUserGenres } from '../lib/queries/userPreferences';
import type { UserGenrePreference } from '../types';

export function useUserPreferences(userId: string | null) {
  const [genres, setGenres] = useState<UserGenrePreference[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) { setGenres([]); return; }
    setLoading(true);
    try {
      setGenres(await fetchUserGenres(userId));
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  return { genres, loading, refetch: load };
}
