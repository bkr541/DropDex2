import { useState, useEffect, useCallback } from 'react';
import type { DiscoverySetTracklistDetail } from '../types';
import { fetchSetlistTracks, scrapeSetlistTracks } from '../lib/api/discovery';

export function useSetlistTracks(
  setResultId: string | null,
  accessToken: string | null,
) {
  const [detail, setDetail] = useState<DiscoverySetTracklistDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!setResultId || !accessToken) return;
    setLoading(true);
    setError(null);

    let result: DiscoverySetTracklistDetail;
    try {
      result = await fetchSetlistTracks(setResultId, accessToken);
      setDetail(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tracks');
      setLoading(false);
      return;
    }
    setLoading(false);

    // Auto-scrape when no tracks exist and status isn't already terminal
    const status = result.setlist.detail_scrape_status;
    if (result.tracks.length === 0 && status !== 'completed' && status !== 'failed') {
      setScraping(true);
      try {
        const scraped = await scrapeSetlistTracks(setResultId, accessToken, false);
        setDetail(scraped);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Scrape failed');
      } finally {
        setScraping(false);
      }
    }
  }, [setResultId, accessToken]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setLoading(false);
    setScraping(false);
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    if (!setResultId || !accessToken || scraping) return;
    setScraping(true);
    setError(null);
    try {
      const result = await scrapeSetlistTracks(setResultId, accessToken, true);
      setDetail(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setScraping(false);
    }
  }, [setResultId, accessToken, scraping]);

  const retry = useCallback(async () => {
    if (!setResultId || !accessToken || scraping) return;
    setScraping(true);
    setError(null);
    try {
      const result = await scrapeSetlistTracks(setResultId, accessToken, false);
      setDetail(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setScraping(false);
    }
  }, [setResultId, accessToken, scraping]);

  return { detail, loading, scraping, error, refresh, retry };
}
