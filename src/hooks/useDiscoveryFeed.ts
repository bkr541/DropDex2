import { useState, useEffect, useCallback } from 'react';
import { fetchTopArtistsForFeed, fetchSetlistsForArtistFeed } from '../lib/queries/discoveryFeed';
import { logger } from '../lib/logger';
import type { FeedArtist, DiscoverySetlistResult } from '../types';

export interface DiscoveryFeed {
  artists: FeedArtist[];
  setlistsByArtist: Map<string, DiscoverySetlistResult[]>;
  loading: boolean;
  /** Plain-language message when the top artists could not be loaded. */
  error: string | null;
  retry: () => void;
}

export function useDiscoveryFeed(): DiscoveryFeed {
  const [artists, setArtists] = useState<FeedArtist[]>([]);
  const [setlistsByArtist, setSetlistsByArtist] = useState<Map<string, DiscoverySetlistResult[]>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSetlistsByArtist(new Map());

    fetchTopArtistsForFeed(10)
      .then((topArtists) => {
        if (cancelled) return;
        setArtists(topArtists);
        setLoading(false);

        // Load each artist's setlists in parallel; update state as each resolves
        for (const artist of topArtists) {
          fetchSetlistsForArtistFeed(artist.id, 10)
            .then((setlists) => {
              if (!cancelled) {
                setSetlistsByArtist((prev) => new Map(prev).set(artist.id, setlists));
              }
            })
            .catch((cause: unknown) => {
              logger.warn('discovery.feed.setlists_failed', {
                artistId: artist.id,
                message: cause instanceof Error ? cause.message : String(cause),
              });
              // One artist failing should not leave its row loading forever.
              if (!cancelled) setSetlistsByArtist((prev) => new Map(prev).set(artist.id, []));
            });
        }
      })
      .catch((cause: unknown) => {
        logger.error('discovery.feed.load_failed', { message: cause instanceof Error ? cause.message : String(cause) });
        if (cancelled) return;
        setError('The top artists could not be loaded.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [retryNonce]);

  const retry = useCallback(() => setRetryNonce((value) => value + 1), []);
  return { artists, setlistsByArtist, loading, error, retry };
}
