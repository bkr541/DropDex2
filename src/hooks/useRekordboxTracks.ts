import { useState, useEffect } from 'react';
import type { RekordboxTrack } from '../types';
import { fetchRecentTracks, searchTracks } from '../lib/queries/rekordbox';

export function useRecentTracks(importId: string | null) {
  const [tracks, setTracks] = useState<RekordboxTrack[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!importId) {
      setTracks([]);
      return;
    }
    setLoading(true);
    fetchRecentTracks(importId)
      .then(setTracks)
      .catch(() => setTracks([]))
      .finally(() => setLoading(false));
  }, [importId]);

  return { tracks, loading };
}

export function useRekordboxSearch(importId: string | null, query: string) {
  const [results, setResults] = useState<RekordboxTrack[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!importId || !query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      searchTracks(importId, query)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [importId, query]);

  return { results, loading };
}
