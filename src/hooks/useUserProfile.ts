import { useState, useEffect, useCallback } from 'react';
import { fetchUserProfile } from '../lib/queries/userProfile';
import type { UserProfile } from '../types';

export function useUserProfile(userId: string | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) { setProfile(null); return; }
    setLoading(true);
    try {
      setProfile(await fetchUserProfile(userId));
    } catch {
      // non-fatal — hero shows fallback
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  return { profile, loading, refetch: load };
}
