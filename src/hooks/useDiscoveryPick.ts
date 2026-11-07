import { useEffect, useState } from 'react';
import { fetchArtistSetlistSummary } from '../lib/queries/discoveryFeed';
import { fetchGenreIdsForArtists } from '../lib/queries/discoveryForYou';
import { genreWeight } from '../lib/discovery/forYou';
import { setsPerYear } from '../lib/discovery/headerGroups';
import { logger } from '../lib/logger';
import type { CatalogGenre } from '../types';

export interface PickDetails {
  totalSets: number;
  /** The artist's narrowest genre, the one that says the most about them. */
  topGenre: { name: string; artists: number } | null;
  years: { values: number[]; labels: string[] };
}

/** The numbers behind the "Picked for You" header for one artist. Null while loading or if they could not be loaded. */
export function useDiscoveryPick(artistId: string | null, catalogGenres: readonly CatalogGenre[]): PickDetails | null {
  const [state, setState] = useState<{ artistId: string; details: PickDetails } | null>(null);

  useEffect(() => {
    if (!artistId) return undefined;
    let cancelled = false;
    (async () => {
      const [summary, genreIds] = await Promise.all([fetchArtistSetlistSummary(artistId, 200), fetchGenreIdsForArtists([artistId])]);
      const byId = new Map(catalogGenres.map((genre) => [genre.id, genre]));
      const genres = (genreIds.get(artistId) ?? []).map((id) => byId.get(id)).filter((genre): genre is CatalogGenre => !!genre);
      const top = genres.sort((a, b) => genreWeight(b.artistCount) - genreWeight(a.artistCount))[0];
      if (cancelled) return;
      setState({
        artistId,
        details: { totalSets: summary.total, topGenre: top ? { name: top.name, artists: top.artistCount } : null, years: setsPerYear(summary.items) },
      });
    })().catch((cause: unknown) => {
      logger.warn('discovery.pick.load_failed', { artistId, message: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => { cancelled = true; };
  }, [artistId, catalogGenres]);

  return state && state.artistId === artistId ? state.details : null;
}
