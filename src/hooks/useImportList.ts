import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RekordboxImport } from '../types';
import { fetchAllImports, fetchImportById } from '../lib/queries/rekordbox';
import { isImportInFlight } from '../lib/rekordbox/importLifecycle';

const ACTIVE_IMPORT_POLL_MS = 5000;
const HIDDEN_IMPORT_POLL_MS = 15000;

export function useImportList(userId: string | null) {
  const [imports, setImports] = useState<RekordboxImport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const generationRef = useRef(0);
  const importsRef = useRef<RekordboxImport[]>([]);

  useEffect(() => {
    importsRef.current = imports;
  }, [imports]);

  useEffect(() => {
    if (!userId) {
      generationRef.current += 1;
      importsRef.current = [];
      setImports([]);
      setLoading(false);
      setError(null);
      return;
    }

    const generation = ++generationRef.current;
    let active = true;
    if (importsRef.current.length === 0) setLoading(true);
    setError(null);

    fetchAllImports(userId)
      .then((rows) => {
        if (!active || generation !== generationRef.current) return;
        importsRef.current = rows;
        setImports(rows);
      })
      .catch((err: Error) => {
        if (active && generation === generationRef.current) {
          setError(err.message || 'Failed to load import history.');
        }
      })
      .finally(() => {
        if (active && generation === generationRef.current) setLoading(false);
      });

    return () => {
      active = false;
      generationRef.current += 1;
    };
  }, [userId, tick]);

  const inFlightIds = useMemo(
    () => imports.filter(isImportInFlight).map((item) => item.id),
    [imports],
  );
  const inFlightKey = inFlightIds.join(',');

  useEffect(() => {
    if (!userId || inFlightIds.length === 0) return;

    let stopped = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const rows = await Promise.all(inFlightIds.map((id) => fetchImportById(id)));
        if (stopped) return;
        const updates = new Map(
          rows.filter((row): row is RekordboxImport => row != null).map((row) => [row.id, row]),
        );
        if (updates.size > 0) {
          setImports((current) => {
            const next = current.map((item) => updates.get(item.id) ?? item);
            importsRef.current = next;
            return next;
          });
        }
      } catch (pollError) {
        // Keep the last known durable state visible. The next poll or an explicit
        // refetch will recover without replacing the entire settings screen with
        // an intermittent progress error.
        if (import.meta.env.DEV) {
          console.debug('[DropDex] Import activity poll failed:', pollError);
        }
      } finally {
        if (!stopped) {
          timeout = setTimeout(
            poll,
            document.visibilityState === 'hidden' ? HIDDEN_IMPORT_POLL_MS : ACTIVE_IMPORT_POLL_MS,
          );
        }
      }
    };

    timeout = setTimeout(poll, 750);
    return () => {
      stopped = true;
      if (timeout) clearTimeout(timeout);
    };
  // inFlightKey intentionally represents the stable set of active jobs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, inFlightKey]);

  const refetch = useCallback(() => setTick((current) => current + 1), []);

  return { imports, loading, error, refetch };
}
