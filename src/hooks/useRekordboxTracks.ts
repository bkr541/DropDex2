import { useCallback, useEffect, useRef, useState } from 'react';
import type { RekordboxTrack } from '../types';
import {
  fetchLibraryStats,
  fetchLibraryTracksPage,
  fetchRecentTracks,
  LIBRARY_TRACK_PAGE_SIZE,
  type LibraryStats,
  type LibraryTrackFilters,
} from '../lib/queries/rekordbox';

export function useRecentTracks(importId: string | null) {
  const [tracks, setTracks] = useState<RekordboxTrack[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!importId) {
      setTracks([]);
      return;
    }
    setLoading(true);
    fetchRecentTracks(importId)
      .then(setTracks)
      .catch(() => setTracks([]))
      .finally(() => setLoading(false));
  }, [importId]);

  return { tracks, loading };
}

export function useLibraryStats(importId: string | null) {
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!importId) {
      setStats(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    fetchLibraryStats(importId)
      .then((next) => {
        if (!cancelled) setStats(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStats(null);
        setError(err instanceof Error ? err.message : 'Failed to load library statistics');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [importId]);

  return { stats, loading, error };
}

interface UseLibraryTracksOptions extends LibraryTrackFilters {
  enabled?: boolean;
  debounceMs?: number;
  pageSize?: number;
}

export function useLibraryTracks(
  importId: string | null,
  {
    search = null,
    genre = null,
    artist = null,
    enabled = true,
    debounceMs = 0,
    pageSize = LIBRARY_TRACK_PAGE_SIZE,
  }: UseLibraryTracksOptions = {},
) {
  const [tracks, setTracks] = useState<RekordboxTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const normalizedSearch = search?.trim() || null;
  const normalizedGenre = genre?.trim() || null;
  const normalizedArtist = artist?.trim() || null;

  useEffect(() => {
    const generation = ++generationRef.current;
    let cancelled = false;

    if (!importId || !enabled) {
      setTracks([]);
      setTotal(0);
      setLoading(false);
      setLoadingMore(false);
      setError(null);
      return;
    }

    setTracks([]);
    setTotal(0);
    setLoading(true);
    setLoadingMore(false);
    setError(null);

    const timer = window.setTimeout(() => {
      fetchLibraryTracksPage(importId, 0, pageSize, {
        search: normalizedSearch,
        genre: normalizedGenre,
        artist: normalizedArtist,
      })
        .then((page) => {
          if (cancelled || generation !== generationRef.current) return;
          setTracks(page.items);
          setTotal(page.total);
        })
        .catch((err: unknown) => {
          if (cancelled || generation !== generationRef.current) return;
          setTracks([]);
          setTotal(0);
          setError(err instanceof Error ? err.message : 'Failed to load library tracks');
        })
        .finally(() => {
          if (!cancelled && generation === generationRef.current) setLoading(false);
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    importId,
    enabled,
    normalizedSearch,
    normalizedGenre,
    normalizedArtist,
    debounceMs,
    pageSize,
  ]);

  const loadMore = useCallback(async () => {
    if (!importId || !enabled || loading || loadingMore || tracks.length >= total) return;
    const generation = generationRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchLibraryTracksPage(importId, tracks.length, pageSize, {
        search: normalizedSearch,
        genre: normalizedGenre,
        artist: normalizedArtist,
      });
      if (generation !== generationRef.current) return;
      setTracks((current) => [...current, ...page.items]);
      setTotal(page.total);
    } catch (err) {
      if (generation === generationRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load more tracks');
      }
    } finally {
      if (generation === generationRef.current) setLoadingMore(false);
    }
  }, [
    importId,
    enabled,
    loading,
    loadingMore,
    tracks.length,
    total,
    pageSize,
    normalizedSearch,
    normalizedGenre,
    normalizedArtist,
  ]);

  return {
    tracks,
    total,
    loading,
    loadingMore,
    error,
    hasMore: tracks.length < total,
    loadMore,
  };
}

export function useRekordboxSearch(importId: string | null, query: string) {
  const normalizedQuery = query.trim();
  const result = useLibraryTracks(importId, {
    search: normalizedQuery,
    enabled: normalizedQuery.length > 0,
    debounceMs: 300,
  });

  return {
    results: result.tracks,
    total: result.total,
    loading: result.loading,
    loadingMore: result.loadingMore,
    error: result.error,
    hasMore: result.hasMore,
    loadMore: result.loadMore,
  };
}
