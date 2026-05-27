import { useState, useEffect } from 'react';
import type { PlaylistTrackItem } from '../lib/queries/rekordbox';
import { fetchPlaylistTracks } from '../lib/queries/rekordbox';

export function useRekordboxPlaylistTracks(playlistId: string | null) {
  const [tracks, setTracks] = useState<PlaylistTrackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!playlistId) {
      setTracks([]);
      return;
    }
    setLoading(true);
    setError(null);
    fetchPlaylistTracks(playlistId)
      .then(setTracks)
      .catch((err: Error) => setError(err.message ?? 'Failed to load tracks'))
      .finally(() => setLoading(false));
  }, [playlistId]);

  return { tracks, loading, error };
}
