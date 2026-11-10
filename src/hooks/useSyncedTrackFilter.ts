import { useCallback, useMemo, useState } from 'react';
import { matchesSyncedTrack, type SyncedFilterValue, type SyncedTrackFilter } from '../lib/preview/syncedTrackFilter';
import { useSyncedPreviewKeys } from './useSyncedPreviewKeys';

const OPTIONS = [{ value: 'all', label: 'All' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];

export function useSyncedTrackFilter(enabled = true, preload = false) {
  const [value, setValue] = useState<SyncedFilterValue>('all');
  const active = enabled && value !== 'all';
  const cloud = useSyncedPreviewKeys(enabled && (preload || active));
  const loading = active && cloud.loading;
  const error = active && cloud.failed ? 'Could not load DropDex Cloud sync status.' : null;
  const blocked = loading || Boolean(error);
  const filter = useMemo<SyncedTrackFilter | null>(() => (
    active && value !== 'all' && !blocked ? { value, keys: cloud.keys } : null
  ), [active, blocked, cloud.keys, value]);

  const matches = useCallback((track: Parameters<typeof matchesSyncedTrack>[0]) => (
    !active || (filter !== null && matchesSyncedTrack(track, filter))
  ), [active, filter]);

  return {
    value, cloud, filter, loading, error, blocked, matches,
    dropdown: { label: 'Synced', value, options: OPTIONS, onChange: (next: string) => setValue(next as SyncedFilterValue) },
  };
}
