import { useCallback, useEffect, useState } from 'react';
import { fetchUserArtists, fetchUserGenres } from '../lib/queries/userPreferences';
import { fetchArtistsInGenre } from '../lib/queries/artists';
import { fetchArtistsSharingGenres, fetchGenreIdsForArtists } from '../lib/queries/discoveryForYou';
import { dayNumber, genreWeight, hashString, rankSimilarArtists, seededShuffle, type ForYouShelf, type ShelfArtist } from '../lib/discovery/forYou';
import { logger } from '../lib/logger';
import type { CatalogGenre } from '../types';

export interface DiscoveryForYou {
  /** True when the user has saved at least one favorite artist or genre. */
  hasTaste: boolean;
  /** The user's favorite genres that exist in the catalog, in their order. */
  favoriteGenres: CatalogGenre[];
  shelves: ForYouShelf[];
  loading: boolean;
  /** Plain-language message when the personal shelves could not be built. */
  error: string | null;
  retry: () => void;
}

const SHELF_SIZE = 20;
const BECAUSE_SHELVES = 2;
const GENRE_SHELVES = 3;
/** Per favorite artist, how many of their narrowest genres we look for similar artists in. */
const GENRES_PER_ARTIST = 3;

const EMPTY: DiscoveryForYou = { hasTaste: false, favoriteGenres: [], shelves: [], loading: false, error: null, retry: () => undefined };

/**
 * Builds the personal shelves from what the user saved in their profile (up to 10 favorite artists and 5
 * favorite genres): their artists, artists like them, and more from each favorite genre.
 */
export function useDiscoveryForYou(userId: string | null, catalogGenres: CatalogGenre[]): DiscoveryForYou {
  const [state, setState] = useState<Omit<DiscoveryForYou, 'retry'>>({ ...EMPTY, loading: !!userId });
  const [attempt, setAttempt] = useState(0);
  const catalogReady = catalogGenres.length > 0;

  useEffect(() => {
    if (!userId) { setState({ ...EMPTY }); return undefined; }
    if (!catalogReady) return undefined;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    (async () => {
      const [artistPrefs, genrePrefs] = await Promise.all([fetchUserArtists(userId), fetchUserGenres(userId)]);
      const genreById = new Map(catalogGenres.map((genre) => [genre.id, genre]));
      const genreNames = new Map(catalogGenres.map((genre) => [genre.id, genre.name]));
      const genreCounts = new Map(catalogGenres.map((genre) => [genre.id, genre.artistCount]));

      const favoriteArtists: ShelfArtist[] = artistPrefs
        .filter((pref) => pref.artist)
        .map((pref) => ({ id: String(pref.artist!.id), name: pref.artist!.name, normalized_name: pref.artist!.normalized_name, profile_image_url: pref.artist!.profile_image_url, subtitle: 'Your favorite' }));
      const favoriteGenres = genrePrefs
        .map((pref) => genreById.get(String(pref.genre_id)))
        .filter((genre): genre is CatalogGenre => !!genre);
      const favoriteIds = new Set(favoriteArtists.map((artist) => artist.id));

      const shelves: ForYouShelf[] = [];
      if (favoriteArtists.length > 0) {
        shelves.push({ id: 'favorites', kind: 'favorites', title: 'Your artists', caption: 'From your profile', artists: favoriteArtists });
      }

      // Artists like the favorites: look in each favorite's narrowest genres, then rank by what they share.
      const genresByArtist = await fetchGenreIdsForArtists(favoriteArtists.map((artist) => artist.id));
      const lookFor = (artistId: string) => new Set(
        [...(genresByArtist.get(artistId) ?? [])]
          .sort((a, b) => genreWeight(genreCounts.get(b) ?? 0) - genreWeight(genreCounts.get(a) ?? 0))
          .slice(0, GENRES_PER_ARTIST),
      );
      const searchGenres = new Set<string>();
      for (const artist of favoriteArtists) for (const id of lookFor(artist.id)) searchGenres.add(id);
      const links = await fetchArtistsSharingGenres([...searchGenres]);
      const common = { links, excludeIds: favoriteIds, genreArtistCounts: genreCounts, genreNames, limit: SHELF_SIZE };

      if (favoriteArtists.length > 1) {
        const similar = rankSimilarArtists({ ...common, sourceGenreIds: searchGenres });
        if (similar.length > 0) shelves.push({ id: 'similar', kind: 'similar', title: 'Artists like your favorites', caption: `Based on ${favoriteArtists.length} favorites`, artists: similar });
      }
      for (const artist of favoriteArtists.slice(0, BECAUSE_SHELVES)) {
        const because = rankSimilarArtists({ ...common, sourceGenreIds: lookFor(artist.id) });
        if (because.length > 0) shelves.push({ id: `because-${artist.id}`, kind: 'because', title: `If you like ${artist.name}`, caption: 'Shared genres', artists: because });
      }

      // More from each favorite genre: a daily shuffle, so the shelf has something new to try each day.
      const day = dayNumber();
      const genreShelves = await Promise.all(favoriteGenres.slice(0, GENRE_SHELVES).map(async (genre) => {
        const inGenre = (await fetchArtistsInGenre(genre.id)).filter((artist) => !favoriteIds.has(artist.id));
        const artists: ShelfArtist[] = seededShuffle(inGenre, day + hashString(genre.id)).slice(0, SHELF_SIZE).map((artist) => ({ ...artist, subtitle: genre.name }));
        return { id: `genre-${genre.id}`, kind: 'genre' as const, title: `More ${genre.name}`, caption: `${genre.artistCount} artists`, artists, genreId: genre.id };
      }));
      shelves.push(...genreShelves.filter((shelf) => shelf.artists.length > 0));

      if (cancelled) return;
      setState({ hasTaste: favoriteArtists.length + favoriteGenres.length > 0, favoriteGenres, shelves, loading: false, error: null });
    })().catch((cause: unknown) => {
      logger.error('discovery.foryou.load_failed', { message: cause instanceof Error ? cause.message : String(cause) });
      if (!cancelled) setState({ ...EMPTY, error: 'Your personal picks could not be loaded.' });
    });

    return () => { cancelled = true; };
  }, [userId, catalogGenres, catalogReady, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
