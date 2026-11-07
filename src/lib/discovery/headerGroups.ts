import { seededShuffle } from './forYou';
import type { ForYouShelf, ShelfArtist } from './forYou';
import type { DiscoverySetlistResult, FeedArtist } from '../../types';

/** A calendar day as YYYY-MM-DD in local time, which is how set dates are written. */
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export interface FreshSet {
  setlist: DiscoverySetlistResult;
  artistName: string | null;
}

export interface FreshWeek {
  /** Sets dated in the last seven days. */
  newSets: number;
  /** Artists with at least one of those sets. */
  artistsWithNewSets: number;
  /** The genre most of those artists share. */
  trendingGenre: { name: string; artists: number } | null;
  /** Sets per day for the last seven days, oldest first, ending today. */
  perDay: number[];
  dayLabels: string[];
  /** The new sets, newest first. */
  sets: FreshSet[];
}

/** "Fresh This Week": what the top artists have added in the last seven days. */
export function buildFreshWeek(
  artists: readonly FeedArtist[],
  setlistsByArtist: ReadonlyMap<string, readonly DiscoverySetlistResult[]>,
  today: Date = new Date(),
): FreshWeek {
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - i));
    return { key: dayKey(date), label: date.toLocaleDateString('en-US', { weekday: 'narrow' }) };
  });
  const index = new Map(days.map((day, i) => [day.key, i]));
  const perDay = days.map(() => 0);
  const sets: FreshSet[] = [];
  const genreArtists = new Map<string, { name: string; ids: Set<string> }>();
  const artistIds = new Set<string>();

  for (const artist of artists) {
    for (const setlist of setlistsByArtist.get(artist.id) ?? []) {
      const slot = setlist.set_date ? index.get(setlist.set_date.slice(0, 10)) : undefined;
      if (slot === undefined) continue;
      perDay[slot] += 1;
      sets.push({ setlist, artistName: artist.name });
      artistIds.add(artist.id);
      for (const genre of artist.genres) {
        const entry = genreArtists.get(genre.id) ?? { name: genre.name, ids: new Set<string>() };
        entry.ids.add(artist.id);
        genreArtists.set(genre.id, entry);
      }
    }
  }

  const top = [...genreArtists.values()].sort((a, b) => b.ids.size - a.ids.size || a.name.localeCompare(b.name))[0];
  sets.sort((a, b) => (b.setlist.set_date ?? '').localeCompare(a.setlist.set_date ?? ''));
  return {
    newSets: sets.length,
    artistsWithNewSets: artistIds.size,
    trendingGenre: top ? { name: top.name, artists: top.ids.size } : null,
    perDay,
    dayLabels: days.map((day) => day.label),
    sets,
  };
}

export interface PickCandidate {
  artist: ShelfArtist;
  /** Why this artist, e.g. "Because you like ILLENIUM". */
  reason: string;
}

/**
 * "Picked for You": artists the user has not saved yet, from the shelves built out of their favorites, in an order that changes
 * once a day. The first one is today's pick; the rest are what "Another pick" cycles through.
 */
export function pickCandidates(shelves: readonly ForYouShelf[], day: number, limit = 8): PickCandidate[] {
  const seen = new Set<string>();
  const found: PickCandidate[] = [];
  const reasonFor = (shelf: ForYouShelf) => {
    if (shelf.kind === 'because') return `Because you like ${shelf.title.replace(/^If you like /, '')}`;
    if (shelf.kind === 'genre') return `From your favorite genre, ${shelf.title.replace(/^More /, '')}`;
    return 'Like your favorite artists';
  };
  for (const shelf of shelves) {
    if (shelf.kind === 'favorites') continue;
    for (const artist of shelf.artists) {
      if (seen.has(artist.id)) continue;
      seen.add(artist.id);
      found.push({ artist, reason: reasonFor(shelf) });
    }
  }
  return seededShuffle(found, day).slice(0, limit);
}

/** Sets per year for the last `count` years, oldest first, ending this year. */
export function setsPerYear(setlists: readonly DiscoverySetlistResult[], count = 6, now: Date = new Date()) {
  const last = now.getFullYear();
  const years = Array.from({ length: count }, (_, i) => last - (count - 1 - i));
  const values = years.map(() => 0);
  for (const setlist of setlists) {
    const year = Number(setlist.set_date?.slice(0, 4));
    const slot = years.indexOf(year);
    if (slot >= 0) values[slot] += 1;
  }
  return { values, labels: years.map((year) => String(year).slice(2)) };
}
