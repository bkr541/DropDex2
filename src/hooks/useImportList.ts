import { useState, useEffect, useRef } from 'react';
import type { RekordboxImport } from '../types';
import { fetchAllImports } from '../lib/queries/rekordbox';

export function useImportList(userId: string | null) {
  const [imports, setImports] = useState<RekordboxImport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!userId) {
      generationRef.current += 1;
      setImports([]);
      setLoading(false);
      setError(null);
      return;
    }
    const generation = ++generationRef.current;
    let active = true;
    setLoading(true);
    setError(null);
    fetchAllImports(userId)
      .then((rows) => { if (active && generation === generationRef.current) setImports(rows); })
      .catch((err: Error) => {
        if (active && generation === generationRef.current) {
          setError(err.message || 'Failed to load import history.');
        }
      })
      .finally(() => {
        if (active && generation === generationRef.current) setLoading(false);
      });
    return () => { active = false; generationRef.current += 1; };
  }, [userId, tick]);

  const refetch = () => setTick((t) => t + 1);

  return { imports, loading, error, refetch };
}
