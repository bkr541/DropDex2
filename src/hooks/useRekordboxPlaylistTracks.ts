import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlaylistTrackItem, PlaylistStats } from '../lib/queries/rekordbox';
import {
  fetchPlaylistStats,
  fetchPlaylistTracksPage,
  PLAYLIST_TRACK_PAGE_SIZE,
} from '../lib/queries/rekordbox';
import { syncedTrackPager, type SyncedTrackFilter } from '../lib/preview/syncedTrackFilter';
import { subscribeToRekordboxAnalysisProgress } from '../lib/rekordbox/analysisProgressEvents';

export function useRekordboxPlaylistTracks(playlistId: string | null, syncedFilter: SyncedTrackFilter | null = null, tracksEnabled = true) {
  const [tracks, setTracks] = useState<PlaylistTrackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<PlaylistStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const tracksRef = useRef<PlaylistTrackItem[]>([]);

  tracksRef.current = tracks;
  const readPage = useMemo(() => syncedTrackPager<PlaylistTrackItem>(
    (offset, limit, signal) => fetchPlaylistTracksPage(playlistId!, offset, limit, signal),
    syncedFilter,
    (row) => row.track,
  ), [playlistId, syncedFilter]);

  useEffect(() => subscribeToRekordboxAnalysisProgress(() => {
    if (!playlistId || !tracksEnabled) return;
    const generation = generationRef.current;
    const visibleCount = Math.max(PLAYLIST_TRACK_PAGE_SIZE, tracksRef.current.length);
    void readPage(0, visibleCount)
      .then((page) => {
        if (generation !== generationRef.current) return;
        setTracks(page.items);
        setTotal(page.total);
      })
      .catch(() => undefined);
  }), [playlistId, readPage, tracksEnabled]);

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
    setLoading(tracksEnabled);
    setLoadingMore(false);
    setStatsLoading(true);
    setError(null);

    const controller = new AbortController();
    void Promise.all([
      tracksEnabled ? readPage(0, PLAYLIST_TRACK_PAGE_SIZE, controller.signal)
        .then((page) => {
          if (cancelled || generation !== generationRef.current) return;
          setTracks(page.items);
          setTotal(page.total);
        })
        .finally(() => {
          if (!cancelled && generation === generationRef.current) setLoading(false);
        }) : Promise.resolve(),
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
      controller.abort();
    };
  }, [playlistId, readPage, tracksEnabled]);

  const loadMore = useCallback(async () => {
    if (!playlistId || !tracksEnabled || loading || loadingMore || tracks.length >= total) return;
    const generation = generationRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await readPage(tracks.length, PLAYLIST_TRACK_PAGE_SIZE);
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
  }, [playlistId, readPage, tracksEnabled, loading, loadingMore, tracks.length, total]);

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
