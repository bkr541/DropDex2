import { useState, useEffect } from 'react';
import type { RekordboxImport } from '../types';
import { fetchAllImports } from '../lib/queries/rekordbox';

export function useImportList(userId: string | null) {
  const [imports, setImports] = useState<RekordboxImport[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!userId) {
      setImports([]);
      return;
    }
    setLoading(true);
    fetchAllImports(userId)
      .then(setImports)
      .catch(() => setImports([]))
      .finally(() => setLoading(false));
  }, [userId, tick]);

  const refetch = () => setTick((t) => t + 1);

  return { imports, loading, refetch };
}
