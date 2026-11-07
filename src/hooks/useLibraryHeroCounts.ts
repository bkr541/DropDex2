import { useEffect, useState } from 'react';
import { logger } from '../lib/logger';
import { fetchLibraryCueCount } from '../lib/queries/libraryHeroCounts';
import { fetchPlaylists } from '../lib/queries/rekordbox';
import { useSyncedPreviewKeys } from './useSyncedPreviewKeys';
import { useUsbDevices } from './useUsbDevices';

export interface LibraryHeroCounts {
  /** Each is null until it has loaded, or if it could not be loaded. */
  playlists: number | null;
  cuePoints: number | null;
  usbs: number | null;
  inCloud: number | null;
}

/** The counts the Home hero shows that the page does not already have: playlists, cue points, saved USBs and tracks in the DropDex Cloud. */
export function useLibraryHeroCounts(importId: string | null, userId: string | null): LibraryHeroCounts {
  const [state, setState] = useState<{ importId: string; playlists: number | null; cuePoints: number | null } | null>(null);
  const usbs = useUsbDevices(userId);
  const synced = useSyncedPreviewKeys(true);

  useEffect(() => {
    if (!importId) return undefined;
    let cancelled = false;
    const settle = <T,>(promise: Promise<T>, name: string) => promise.catch((cause: unknown) => {
      logger.warn('library.hero.count_failed', { name, message: cause instanceof Error ? cause.message : String(cause) });
      return null;
    });
    Promise.all([
      settle(fetchPlaylists(importId).then((rows) => rows.length), 'playlists'),
      settle(fetchLibraryCueCount(importId), 'cue_points'),
    ]).then(([playlists, cuePoints]) => {
      if (!cancelled) setState({ importId, playlists, cuePoints });
    });
    return () => { cancelled = true; };
  }, [importId]);

  const current = state && state.importId === importId ? state : null;
  return {
    playlists: current?.playlists ?? null,
    cuePoints: current?.cuePoints ?? null,
    usbs: usbs.loading || usbs.error ? null : usbs.devices.length,
    inCloud: synced.failed ? null : synced.keys.size,
  };
}
