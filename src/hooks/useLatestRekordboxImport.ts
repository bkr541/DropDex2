import { useState, useEffect, useRef, useCallback } from 'react';
import type { RekordboxImport } from '../types';
import { fetchActiveImport } from '../lib/queries/rekordbox';

export function useLatestRekordboxImport(userId: string | null) {
  const [data, setData] = useState<RekordboxImport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!userId) {
      generationRef.current += 1;
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const generation = ++generationRef.current;
    let active = true;
    setLoading(true);
    setError(null);
    fetchActiveImport(userId)
      .then((row) => { if (active && generation === generationRef.current) setData(row); })
      .catch((err: Error) => {
        if (active && generation === generationRef.current) {
          setError(err.message ?? 'Failed to load library');
        }
      })
      .finally(() => {
        if (active && generation === generationRef.current) setLoading(false);
      });
    return () => { active = false; generationRef.current += 1; };
  }, [userId, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  return { data, loading, error, refetch };
}
