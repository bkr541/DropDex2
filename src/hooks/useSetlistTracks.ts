import { useState, useEffect, useCallback, useRef } from 'react';
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

  // Tracks which setResultId has already had an auto-scrape attempted this
  // session so we never loop: auto-scrape fires at most once per setlist load.
  const autoScrapedRef = useRef<string | null>(null);

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

    const status = result.setlist.detail_scrape_status;
    const expectedTrackCount = result.setlist.track_count ?? 0;
    const parsedTrackCount = result.setlist.parsed_track_count ?? 0;
    const hasTracks = result.tracks.length > 0;

    // A record stuck as "completed" with zero parsed tracks while the source
    // reports track_count > 0 is an invalid state — the previous scrape silently
    // failed (bot-block, stale DOM, selector change). Force a fresh scrape with
    // refresh=true to overwrite the bad status.
    const completedButEmpty =
      status === 'completed' &&
      !hasTracks &&
      expectedTrackCount > 0 &&
      parsedTrackCount === 0;

    const shouldAutoScrape =
      !hasTracks &&
      status !== 'failed' &&
      (status !== 'completed' || completedButEmpty) &&
      autoScrapedRef.current !== setResultId;

    if (shouldAutoScrape) {
      autoScrapedRef.current = setResultId;
      setScraping(true);
      try {
        // Pass refresh=true for stuck completed-but-empty records so the
        // backend re-scrapes unconditionally instead of returning cached state.
        const scraped = await scrapeSetlistTracks(
          setResultId,
          accessToken,
          completedButEmpty,
        );
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
    // Reset per-setlist auto-scrape guard when setResultId changes so a newly
    // selected setlist can auto-scrape even if the previous one already did.
    autoScrapedRef.current = null;
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

  // retry always forces a fresh scrape (refresh=true) so stuck or failed
  // records are re-attempted unconditionally rather than returning cached state.
  const retry = useCallback(async () => {
    if (!setResultId || !accessToken || scraping) return;
    setScraping(true);
    setError(null);
    try {
      const result = await scrapeSetlistTracks(setResultId, accessToken, true);
      setDetail(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setScraping(false);
    }
  }, [setResultId, accessToken, scraping]);

  return { detail, loading, scraping, error, refresh, retry };
}
