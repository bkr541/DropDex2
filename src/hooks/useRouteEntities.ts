import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RekordboxImport, RekordboxTrack } from '../types';
import type { PlaylistWithCount } from '../lib/queries/rekordbox';
import { fetchImportById, fetchPlaylistById, fetchTracksByIds } from '../lib/queries/rekordbox';

interface RouteEntityState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useRouteTracks(trackIds: string[]): {
  tracksById: Map<string, RekordboxTrack>;
  loading: boolean;
  error: string | null;
  retry: () => void;
} {
  const requestKey = [...new Set(trackIds.filter(Boolean))].sort().join('\u0000');
  const normalizedIds = useMemo(
    () => requestKey ? requestKey.split('\u0000') : [],
    [requestKey],
  );
  const [tracksById, setTracksById] = useState<Map<string, RekordboxTrack>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    let active = true;

    if (normalizedIds.length === 0) {
      setTracksById(new Map());
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    fetchTracksByIds(normalizedIds)
      .then((tracks) => {
        if (!active || generation !== generationRef.current) return;
        setTracksById(new Map(tracks.map((track) => [track.id, track])));
      })
      .catch((caught: unknown) => {
        if (!active || generation !== generationRef.current) return;
        setTracksById(new Map());
        setError(caught instanceof Error ? caught.message : 'Failed to load track.');
      })
      .finally(() => {
        if (active && generation === generationRef.current) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [normalizedIds, requestKey, retryToken]);

  const retry = useCallback(() => setRetryToken((value) => value + 1), []);
  return { tracksById, loading, error, retry };
}

function useRouteEntity<T>(
  id: string | null,
  loader: (id: string) => Promise<T | null>,
): RouteEntityState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    let active = true;
    if (!id) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    setData(null);
    setLoading(true);
    setError(null);
    loader(id)
      .then((value) => {
        if (active && generation === generationRef.current) setData(value);
      })
      .catch((caught: unknown) => {
        if (!active || generation !== generationRef.current) return;
        setError(caught instanceof Error ? caught.message : 'Failed to load route data.');
      })
      .finally(() => {
        if (active && generation === generationRef.current) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, loader, retryToken]);

  return {
    data,
    loading,
    error,
    retry: useCallback(() => setRetryToken((value) => value + 1), []),
  };
}

export function useRoutePlaylist(playlistId: string | null): RouteEntityState<PlaylistWithCount> {
  return useRouteEntity(playlistId, fetchPlaylistById);
}

export function useRouteImport(importId: string | null): RouteEntityState<RekordboxImport> {
  return useRouteEntity(importId, fetchImportById);
}
