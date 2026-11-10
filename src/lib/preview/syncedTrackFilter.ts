import type { PaginatedResult } from '../queries/rekordbox';
import { trackIdentityKey } from './trackIdentity';

export type SyncedFilterValue = 'all' | 'yes' | 'no';
type TrackIdentity = Parameters<typeof trackIdentityKey>[0];

export interface SyncedTrackFilter {
  value: Exclude<SyncedFilterValue, 'all'>;
  keys: ReadonlySet<string>;
}

export function matchesSyncedTrack(track: TrackIdentity, filter: SyncedTrackFilter): boolean {
  return filter.keys.has(trackIdentityKey(track)) === (filter.value === 'yes');
}

type ReadPage<T> = (offset: number, limit: number, signal?: AbortSignal) => Promise<PaginatedResult<T>>;

/** Collect matching rows before slicing so counts and offsets apply to the filtered list. */
export function syncedTrackPager<T>(readPage: ReadPage<T>, filter: SyncedTrackFilter | null, trackFrom: (row: T) => TrackIdentity): ReadPage<T> {
  if (!filter || (filter.value === 'no' && filter.keys.size === 0)) return readPage;
  let matches: T[] | undefined;
  return async (offset, limit, signal) => {
    if (!matches || offset === 0) {
      const filtered: T[] = [];
      if (filter.keys.size > 0) {
        for (let start = 0; ;) {
          signal?.throwIfAborted();
          const page = await readPage(start, 500, signal);
          filtered.push(...page.items.filter((row) => matchesSyncedTrack(trackFrom(row), filter)));
          if (!page.hasMore || page.items.length === 0) break;
          start += page.items.length;
        }
      }
      signal?.throwIfAborted();
      matches = filtered;
    }
    const items = matches.slice(offset, offset + limit);
    return { items, offset, limit, total: matches.length, hasMore: offset + items.length < matches.length };
  };
}
