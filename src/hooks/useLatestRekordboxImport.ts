import { useState, useEffect } from 'react';
import type { RekordboxImport } from '../types';
import { fetchActiveImport } from '../lib/queries/rekordbox';

export function useLatestRekordboxImport(userId: string | null) {
  const [data, setData] = useState<RekordboxImport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!userId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchActiveImport(userId)
      .then(setData)
      .catch((err: Error) => setError(err.message ?? 'Failed to load library'))
      .finally(() => setLoading(false));
  }, [userId, tick]);

  const refetch = () => setTick((t) => t + 1);

  return { data, loading, error, refetch };
}
