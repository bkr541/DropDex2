import { useState, useEffect } from 'react';
import type { PlaylistWithCount } from '../lib/queries/rekordbox';
import { fetchPlaylists } from '../lib/queries/rekordbox';

export function useRekordboxPlaylists(importId: string | null) {
  const [playlists, setPlaylists] = useState<PlaylistWithCount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!importId) {
      setPlaylists([]);
      return;
    }
    setLoading(true);
    setError(null);
    fetchPlaylists(importId)
      .then(setPlaylists)
      .catch((err: Error) => setError(err.message ?? 'Failed to load playlists'))
      .finally(() => setLoading(false));
  }, [importId]);

  return { playlists, loading, error };
}
