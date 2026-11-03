import { useEffect, useState } from 'react';
import { fetchSpotifyAccountStatus } from '../lib/api/externalAccounts';

/**
 * Whether the user's linked Spotify account can show playlists.
 * `null` while it is being checked, `false` when there is no token or no playlist access.
 */
export function useSpotifyAvailability(accessToken: string | null): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!accessToken) {
      setAvailable(false);
      return;
    }
    const controller = new AbortController();
    fetchSpotifyAccountStatus(accessToken, controller.signal)
      .then((status) => setAvailable(status.status === 'linked' && status.playlist_access))
      .catch(() => {
        if (!controller.signal.aborted) setAvailable(false);
      });
    return () => controller.abort();
  }, [accessToken]);

  return available;
}
