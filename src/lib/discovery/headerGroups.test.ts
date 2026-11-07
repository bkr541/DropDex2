import { describe, expect, it } from 'vitest';
import type { DiscoverySetlistResult, FeedArtist } from '../../types';
import type { ForYouShelf } from './forYou';
import { buildFreshWeek, pickCandidates, setsPerYear } from './headerGroups';

const today = new Date(2026, 10, 7); // 7 Nov 2026
const set = (id: string, set_date: string | null) => ({ id, set_date }) as DiscoverySetlistResult;
const artist = (id: string, genres: string[]): FeedArtist => ({ id, name: `Artist ${id}`, normalized_name: null, profile_image_url: null, setlist_count: 5, genres: genres.map((g) => ({ id: g, name: g })) });

describe('Fresh This Week', () => {
  it('counts only the last seven days, per day, oldest first', () => {
    const week = buildFreshWeek(
      [artist('a', ['Riddim']), artist('b', ['Riddim', 'Bass'])],
      new Map([['a', [set('1', '2026-11-07'), set('2', '2026-11-07'), set('3', '2026-10-20')]], ['b', [set('4', '2026-11-01'), set('5', null)]]]),
      today,
    );
    expect(week.newSets).toBe(3);
    expect(week.perDay).toEqual([1, 0, 0, 0, 0, 0, 2]);
    expect(week.artistsWithNewSets).toBe(2);
    expect(week.trendingGenre).toEqual({ name: 'Riddim', artists: 2 });
    expect(week.sets.map((s) => s.setlist.id)).toEqual(['1', '2', '4']);
  });

  it('reports nothing new when no set is that recent', () => {
    expect(buildFreshWeek([artist('a', [])], new Map([['a', [set('1', '2026-01-01')]]]), today).newSets).toBe(0);
  });
});

describe('Picked for You', () => {
  const shelf = (kind: ForYouShelf['kind'], title: string, ids: string[]): ForYouShelf => ({
    id: title, kind, title, caption: '', artists: ids.map((id) => ({ id, name: id, normalized_name: null, profile_image_url: null, subtitle: null })),
  });

  it('skips favorites, never repeats an artist and says why each was picked', () => {
    const picks = pickCandidates([shelf('favorites', 'Your artists', ['f']), shelf('because', 'If you like ILLENIUM', ['a', 'b']), shelf('genre', 'More Riddim', ['b', 'c'])], 1);
    expect(picks.map((p) => p.artist.id).sort()).toEqual(['a', 'b', 'c']);
    expect(picks.find((p) => p.artist.id === 'b')?.reason).toBe('Because you like ILLENIUM');
    expect(picks.find((p) => p.artist.id === 'c')?.reason).toBe('From your favorite genre, Riddim');
  });

  it('keeps the same order within a day', () => {
    const shelves = [shelf('similar', 'Artists like your favorites', ['a', 'b', 'c', 'd'])];
    expect(pickCandidates(shelves, 5).map((p) => p.artist.id)).toEqual(pickCandidates(shelves, 5).map((p) => p.artist.id));
  });
});

describe('sets per year', () => {
  it('buckets the last six years, oldest first', () => {
    const years = setsPerYear([set('1', '2026-02-01'), set('2', '2026-03-01'), set('3', '2023-05-05'), set('4', '2010-01-01')], 6, today);
    expect(years.labels).toEqual(['21', '22', '23', '24', '25', '26']);
    expect(years.values).toEqual([0, 0, 1, 0, 0, 2]);
  });
});
