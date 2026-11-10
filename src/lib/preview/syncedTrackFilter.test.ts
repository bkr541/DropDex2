import { describe, expect, it, vi } from 'vitest';
import { syncedTrackPager } from './syncedTrackFilter';

const track = (id: string, contentId = id) => ({
  id, title: id, artist: null, file_path: null, duration_seconds: null, rekordbox_content_id: contentId,
});

function source<T>(rows: T[]) {
  return vi.fn(async (offset: number, limit: number) => {
    // Make the source return smaller pages to exercise offsets across page boundaries.
    const items = rows.slice(offset, offset + Math.min(limit, 2));
    return { items, total: rows.length, offset, limit, hasMore: offset + items.length < rows.length };
  });
}

describe('Synced track pagination', () => {
  it('finds a synced copy on a later page using its identity across imports', async () => {
    const syncedLater = track('new-import-id', 'same-content');
    const read = source([track('1'), track('2'), syncedLater, track('4')]);
    const pager = syncedTrackPager(read, { value: 'yes', keys: new Set(['c:same-content']) }, (row) => row);

    expect(await pager(0, 1)).toMatchObject({ items: [syncedLater], total: 1, hasMore: false });
    expect(read.mock.calls.map(([offset]) => offset)).toEqual([0, 2]);
  });

  it('paginates only unsynced playlist placements in their original order', async () => {
    const rows = ['1', '2', '3', '4', '5'].map((id, position) => ({ position, track: track(id) }));
    const read = source(rows);
    const pager = syncedTrackPager(read, { value: 'no', keys: new Set(['c:1', 'c:3', 'c:5']) }, (row) => row.track);
    expect(await pager(0, 1)).toMatchObject({ items: [rows[1]], total: 2, hasMore: true });
    expect(await pager(1, 1)).toMatchObject({ items: [rows[3]], total: 2, hasMore: false });
    expect(read.mock.calls.map(([offset]) => offset)).toEqual([0, 2, 4]);
  });

  it('keeps ordinary paging for All and returns no Yes results when no copies are ready', async () => {
    const read = source([track('1')]);
    expect(syncedTrackPager(read, null, (row) => row)).toBe(read);
    const pager = syncedTrackPager(read, { value: 'yes', keys: new Set() }, (row) => row);
    expect(await pager(0, 200)).toMatchObject({ items: [], total: 0, hasMore: false });
    expect(read).not.toHaveBeenCalled();
  });
});
