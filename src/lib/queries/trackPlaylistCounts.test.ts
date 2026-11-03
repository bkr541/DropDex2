import { beforeEach, describe, expect, it, vi } from 'vitest';

const pages = vi.hoisted(() => ({ queue: [] as Array<{ data: unknown; error: { message: string } | null }>, calls: [] as Array<{ ids: string[]; from: number; to: number }> }));

vi.mock('../supabase', () => {
  const chain = (ids: string[] = []) => ({
    select: () => chain(),
    in: (_column: string, values: string[]) => chain(values),
    order: () => chain(ids),
    range: (from: number, to: number) => {
      pages.calls.push({ ids, from, to });
      return Promise.resolve(pages.queue.shift() ?? { data: [], error: null });
    },
  });
  return { supabase: { from: () => chain() } };
});

import { countPlaylistsPerTrack, fetchTrackPlaylistCounts } from './trackPlaylistCounts';

beforeEach(() => {
  pages.queue = [];
  pages.calls = [];
});

describe('countPlaylistsPerTrack', () => {
  it('counts the different playlists each track is in, and 0 for a track in none', () => {
    const counts = countPlaylistsPerTrack([
      { track_id: 'a', playlist_id: 'p1' },
      { track_id: 'a', playlist_id: 'p2' },
      { track_id: 'b', playlist_id: 'p1' },
    ], ['a', 'b', 'c']);
    expect([...counts]).toEqual([['a', 2], ['b', 1], ['c', 0]]);
  });

  it('counts a track placed twice in the same playlist once', () => {
    const counts = countPlaylistsPerTrack([
      { track_id: 'a', playlist_id: 'p1' },
      { track_id: 'a', playlist_id: 'p1' },
    ], ['a']);
    expect(counts.get('a')).toBe(1);
  });

  it('ignores rows for tracks that were not asked about', () => {
    expect(countPlaylistsPerTrack([{ track_id: 'z', playlist_id: 'p1' }], ['a']).has('z')).toBe(false);
  });
});

describe('fetchTrackPlaylistCounts', () => {
  it('returns a count for every requested track, including tracks in no playlist', async () => {
    pages.queue = [{ data: [{ track_id: 'a', playlist_id: 'p1' }, { track_id: 'a', playlist_id: 'p2' }], error: null }];
    const counts = await fetchTrackPlaylistCounts(['a', 'b']);
    expect([...counts]).toEqual([['a', 2], ['b', 0]]);
  });

  it('asks for tracks in small groups and de-duplicates the ids', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `t${i}`);
    await fetchTrackPlaylistCounts([...ids, ...ids]);
    expect(pages.calls).toHaveLength(3);
    expect(pages.calls.map((call) => call.ids.length).sort((a, b) => b - a)).toEqual([40, 40, 20]);
  });

  it('keeps reading when a group has more rows than one page holds', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ track_id: 'a', playlist_id: `p${i}` }));
    pages.queue = [{ data: fullPage, error: null }, { data: [{ track_id: 'a', playlist_id: 'p1000' }], error: null }];
    const counts = await fetchTrackPlaylistCounts(['a']);
    expect(counts.get('a')).toBe(1001);
    expect(pages.calls.map((call) => [call.from, call.to])).toEqual([[0, 999], [1000, 1999]]);
  });

  it('fails with the underlying message so it can be logged', async () => {
    pages.queue = [{ data: null, error: { message: 'permission denied' } }];
    await expect(fetchTrackPlaylistCounts(['a'])).rejects.toThrow('permission denied');
  });

  it('does not ask the server when there are no tracks', async () => {
    expect((await fetchTrackPlaylistCounts([])).size).toBe(0);
    expect(pages.calls).toHaveLength(0);
  });
});
