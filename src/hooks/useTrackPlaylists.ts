import { useState, useEffect } from 'react';
import type { TrackPlaylistMembership } from '../lib/queries/rekordbox';
import { fetchTrackPlaylists } from '../lib/queries/rekordbox';

export function useTrackPlaylists(importId: string | null, trackId: string | null) {
  const [memberships, setMemberships] = useState<TrackPlaylistMembership[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!importId || !trackId) {
      setMemberships([]);
      return;
    }
    setLoading(true);
    fetchTrackPlaylists(importId, trackId)
      .then(setMemberships)
      .catch(() => setMemberships([]))
      .finally(() => setLoading(false));
  }, [importId, trackId]);

  return { memberships, loading };
}
