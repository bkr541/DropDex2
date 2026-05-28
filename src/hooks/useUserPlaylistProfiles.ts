import { useState, useEffect, useCallback } from 'react';
import { fetchAllPlaylistProfiles } from '../lib/queries/userPlaylists';
import type { UserPlaylistProfile } from '../types';

export function useUserPlaylistProfiles(userId: string | null) {
  const [profiles, setProfiles] = useState<Map<string, UserPlaylistProfile>>(new Map());
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setProfiles(new Map());
      return;
    }
    setLoading(true);
    try {
      const all = await fetchAllPlaylistProfiles(userId);
      setProfiles(new Map(all.map((p) => [p.playlist_identity_key, p])));
    } catch {
      // non-fatal — show no customizations on error
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const upsertLocal = useCallback((profile: UserPlaylistProfile) => {
    setProfiles((prev) => {
      const next = new Map(prev);
      next.set(profile.playlist_identity_key, profile);
      return next;
    });
  }, []);

  return { profiles, loading, refetch: load, upsertLocal };
}
