import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaylistTrackItem, PlaylistStats } from '../lib/queries/rekordbox';
import {
  fetchPlaylistStats,
  fetchPlaylistTracksPage,
  PLAYLIST_TRACK_PAGE_SIZE,
} from '../lib/queries/rekordbox';

export function useRekordboxPlaylistTracks(playlistId: string | null) {
  const [tracks, setTracks] = useState<PlaylistTrackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<PlaylistStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    let cancelled = false;

    if (!playlistId) {
      setTracks([]);
      setTotal(0);
      setStats(null);
      setLoading(false);
      setLoadingMore(false);
      setStatsLoading(false);
      setError(null);
      return;
    }

    setTracks([]);
    setTotal(0);
    setStats(null);
    setLoading(true);
    setStatsLoading(true);
    setError(null);

    void Promise.all([
      fetchPlaylistTracksPage(playlistId, 0, PLAYLIST_TRACK_PAGE_SIZE)
        .then((page) => {
          if (cancelled || generation !== generationRef.current) return;
          setTracks(page.items);
          setTotal(page.total);
        })
        .finally(() => {
          if (!cancelled && generation === generationRef.current) setLoading(false);
        }),
      fetchPlaylistStats(playlistId)
        .then((nextStats) => {
          if (!cancelled && generation === generationRef.current) setStats(nextStats);
        })
        .finally(() => {
          if (!cancelled && generation === generationRef.current) setStatsLoading(false);
        }),
    ]).catch((err: unknown) => {
      if (cancelled || generation !== generationRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load playlist');
    });

    return () => {
      cancelled = true;
    };
  }, [playlistId]);

  const loadMore = useCallback(async () => {
    if (!playlistId || loading || loadingMore || tracks.length >= total) return;
    const generation = generationRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchPlaylistTracksPage(
        playlistId,
        tracks.length,
        PLAYLIST_TRACK_PAGE_SIZE,
      );
      if (generation !== generationRef.current) return;
      setTracks((current) => [...current, ...page.items]);
      setTotal(page.total);
    } catch (err) {
      if (generation === generationRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load more playlist tracks');
      }
    } finally {
      if (generation === generationRef.current) setLoadingMore(false);
    }
  }, [playlistId, loading, loadingMore, tracks.length, total]);

  return {
    tracks,
    total,
    stats,
    loading,
    loadingMore,
    statsLoading,
    error,
    hasMore: tracks.length < total,
    loadMore,
  };
}

export function usePlaylistStats(playlistId: string | null) {
  const [stats, setStats] = useState<PlaylistStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!playlistId) {
      setStats(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    fetchPlaylistStats(playlistId)
      .then((next) => {
        if (!cancelled) setStats(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStats(null);
          setError(err instanceof Error ? err.message : 'Failed to load playlist statistics');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [playlistId]);

  return { stats, loading, error };
}
