import type { DiscoveryFeed } from '../../hooks/useDiscoveryFeed';
import type { DiscoveryForYou } from '../../hooks/useDiscoveryForYou';

export interface HomeFeedState {
  /** The top artists, the genre catalog or the personal shelves are still loading, so the page would change shape when they arrive. */
  pending: boolean;
  /** Some top artist's latest sets have not arrived yet, so the Fresh sets row is not final. */
  setlistsPending: boolean;
}

/**
 * When the Discovery home is settled. The page shows a skeleton until `pending` is false, so the personal rows and the hero do not
 * appear above content that is already on screen. The personal rows wait for the genre catalog, and the catalog may load after the feed.
 */
export function homeFeedState(
  feed: Pick<DiscoveryFeed, 'loading' | 'error' | 'artists' | 'setlistsByArtist'>,
  forYou: Pick<DiscoveryForYou, 'loading'>,
  genresLoading: boolean,
  genreCount: number,
): HomeFeedState {
  // The personal rows only start once the catalog has genres, so with an empty catalog there is nothing more to wait for.
  const forYouPending = forYou.loading && (genresLoading || genreCount > 0);
  const pending = feed.loading || genresLoading || forYouPending;
  const setlistsPending = !feed.error && feed.artists.some((artist) => !feed.setlistsByArtist.has(artist.id));
  return { pending, setlistsPending };
}
