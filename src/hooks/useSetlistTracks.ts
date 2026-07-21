import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoverySetTracklistDetail } from '../types';
import { fetchSetlistTracks, importSetlistTracksHtml, scrapeSetlistTracks } from '../lib/api/discovery';
import { isAbortError } from '../lib/api/responseValidation';

export function useSetlistTracks(
  setResultId: string | null,
  accessToken: string | null,
) {
  const [detail, setDetail] = useState<DiscoverySetTracklistDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoScrapedRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const beginOperation = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    return { controller, generation };
  }, []);

  const isCurrent = useCallback(
    (controller: AbortController, generation: number) =>
      controllerRef.current === controller && generationRef.current === generation,
    [],
  );

  const load = useCallback(async () => {
    if (!setResultId || !accessToken) return;
    const { controller, generation } = beginOperation();
    setLoading(true);
    setScraping(false);
    setError(null);

    try {
      const result = await fetchSetlistTracks(setResultId, accessToken, controller.signal);
      if (!isCurrent(controller, generation)) return;
      setDetail(result);
      setLoading(false);

      const status = result.setlist.detail_scrape_status;
      const expectedTrackCount = result.setlist.track_count ?? 0;
      const parsedTrackCount = result.setlist.parsed_track_count ?? 0;
      const hasTracks = result.tracks.length > 0;
      const completedButEmpty =
        status === 'completed'
        && !hasTracks
        && expectedTrackCount > 0
        && parsedTrackCount === 0;
      const shouldAutoScrape =
        !hasTracks
        && status !== 'failed'
        && (status !== 'completed' || completedButEmpty)
        && autoScrapedRef.current !== setResultId;

      if (!shouldAutoScrape) return;

      autoScrapedRef.current = setResultId;
      setScraping(true);
      const scraped = await scrapeSetlistTracks(
        setResultId,
        accessToken,
        completedButEmpty,
        controller.signal,
      );
      if (!isCurrent(controller, generation)) return;
      setDetail(scraped);
    } catch (err: unknown) {
      if (!isCurrent(controller, generation) || isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to load tracks');
    } finally {
      if (isCurrent(controller, generation)) {
        setLoading(false);
        setScraping(false);
      }
    }
  }, [accessToken, beginOperation, isCurrent, setResultId]);

  useEffect(() => {
    controllerRef.current?.abort();
    generationRef.current += 1;
    setDetail(null);
    setError(null);
    setLoading(false);
    setScraping(false);
    autoScrapedRef.current = null;
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  const runScrape = useCallback(async (failureMessage: string) => {
    if (!setResultId || !accessToken) return;
    const { controller, generation } = beginOperation();
    setScraping(true);
    setLoading(false);
    setError(null);
    try {
      const result = await scrapeSetlistTracks(
        setResultId,
        accessToken,
        true,
        controller.signal,
      );
      if (!isCurrent(controller, generation)) return;
      setDetail(result);
    } catch (err: unknown) {
      if (!isCurrent(controller, generation) || isAbortError(err)) return;
      setError(err instanceof Error ? err.message : failureMessage);
    } finally {
      if (isCurrent(controller, generation)) setScraping(false);
    }
  }, [accessToken, beginOperation, isCurrent, setResultId]);

  const refresh = useCallback(() => runScrape('Refresh failed'), [runScrape]);
  const retry = useCallback(() => runScrape('Retry failed'), [runScrape]);

  const importHtml = useCallback(async (html: string) => {
    if (!setResultId || !accessToken) return;
    const { controller, generation } = beginOperation();
    setScraping(true);
    setLoading(false);
    try {
      const result = await importSetlistTracksHtml(
        setResultId,
        accessToken,
        html,
        controller.signal,
      );
      if (!isCurrent(controller, generation)) return;
      setDetail(result);
      setError(null);
    } catch (err: unknown) {
      if (!isCurrent(controller, generation) || isAbortError(err)) return;
      throw err;
    } finally {
      if (isCurrent(controller, generation)) setScraping(false);
    }
  }, [accessToken, beginOperation, isCurrent, setResultId]);

  return { detail, loading, scraping, error, refresh, retry, importHtml };
}
