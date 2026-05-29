import { useState, useEffect } from 'react';
import { fetchTopArtistsForFeed, fetchSetlistsForArtistFeed } from '../lib/queries/discoveryFeed';
import type { FeedArtist, DiscoverySetlistResult } from '../types';

export function useDiscoveryFeed() {
  const [artists, setArtists] = useState<FeedArtist[]>([]);
  const [setlistsByArtist, setSetlistsByArtist] = useState<Map<string, DiscoverySetlistResult[]>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

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
                setSetlistsByArtist((prev) => {
                  const next = new Map(prev);
                  next.set(artist.id, setlists);
                  return next;
                });
              }
            })
            .catch(() => {
              // non-fatal per-artist failure
            });
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { artists, setlistsByArtist, loading };
}
