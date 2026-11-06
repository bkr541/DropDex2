/** One artist as the Discovery shelves show them. */
export interface ShelfArtist {
  id: string;
  name: string;
  normalized_name: string | null;
  profile_image_url: string | null;
  /** The supporting line under the name, such as the genres they share with you. */
  subtitle: string | null;
}

export interface ArtistGenreLink {
  artistId: string;
  genreId: string;
  artist: Omit<ShelfArtist, 'subtitle'>;
}

export type ShelfKind = 'favorites' | 'similar' | 'because' | 'genre';

export interface ForYouShelf {
  id: string;
  kind: ShelfKind;
  title: string;
  caption: string;
  artists: ShelfArtist[];
  /** Set on a genre shelf, so "See all" can open the whole genre. */
  genreId?: string;
}

/**
 * How much a shared genre says about two artists being alike: a narrow genre counts for more than a huge
 * one, so sharing "Melodic Dubstep" matters more than sharing "Electronic".
 */
export function genreWeight(artistCount: number): number {
  return 1 / Math.log2(2 + Math.max(0, artistCount));
}

interface RankInput {
  links: readonly ArtistGenreLink[];
  /** The genres to look for, e.g. the genres of one favorite artist. */
  sourceGenreIds: ReadonlySet<string>;
  /** Artists never to suggest (the favorites themselves). */
  excludeIds: ReadonlySet<string>;
  /** How many artists are tagged with each genre. */
  genreArtistCounts: ReadonlyMap<string, number>;
  genreNames: ReadonlyMap<string, string>;
  limit: number;
}

/** Artists that share genres with the source, the most alike first (ties A to Z). */
export function rankSimilarArtists({ links, sourceGenreIds, excludeIds, genreArtistCounts, genreNames, limit }: RankInput): ShelfArtist[] {
  const byArtist = new Map<string, { artist: ArtistGenreLink['artist']; score: number; shared: string[] }>();
  for (const link of links) {
    if (excludeIds.has(link.artistId) || !sourceGenreIds.has(link.genreId)) continue;
    const entry = byArtist.get(link.artistId) ?? { artist: link.artist, score: 0, shared: [] };
    if (!entry.shared.includes(link.genreId)) {
      entry.shared.push(link.genreId);
      entry.score += genreWeight(genreArtistCounts.get(link.genreId) ?? 0);
    }
    byArtist.set(link.artistId, entry);
  }
  return [...byArtist.values()]
    .sort((a, b) => b.score - a.score || a.artist.name.localeCompare(b.artist.name))
    .slice(0, limit)
    .map(({ artist, shared }) => ({
      ...artist,
      subtitle: shared.map((id) => genreNames.get(id)).filter(Boolean).slice(0, 2).join(' · ') || null,
    }));
}

/** A small seeded random number generator, so the same seed always gives the same order. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The items in a shuffled order that stays the same for a given seed (we use the day, so picks change daily). */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const random = seededRandom(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Whole days since 1970, used as the seed for "today's picks". */
export function dayNumber(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 86_400_000);
}

/** A small whole number made from text, used to vary a shuffle per genre. */
export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}
