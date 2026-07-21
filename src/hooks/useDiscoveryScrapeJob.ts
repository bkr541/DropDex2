import { useEffect, useRef, useState } from 'react';
import type { DiscoveryScrapeJob } from '../types';
import { fetchDiscoveryScrapeJob } from '../lib/api/discovery';
import { isAbortError } from '../lib/api/responseValidation';

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES = new Set(['completed', 'failed']);

export function useDiscoveryScrapeJob(jobId: string | null, accessToken: string | null) {
  const [job, setJob] = useState<DiscoveryScrapeJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    let timerId: number | null = null;
    let controller: AbortController | null = null;
    let stopped = false;

    if (!jobId || !accessToken) {
      setJob(null);
      setLoading(false);
      setError(null);
      return () => undefined;
    }

    const scheduleNext = () => {
      if (stopped || generation !== generationRef.current) return;
      timerId = window.setTimeout(() => void poll(false), POLL_INTERVAL_MS);
    };

    const poll = async (initial: boolean) => {
      if (stopped || generation !== generationRef.current) return;
      controller = new AbortController();
      try {
        const nextJob = await fetchDiscoveryScrapeJob(jobId, accessToken, controller.signal);
        if (stopped || generation !== generationRef.current) return;

        setJob((previous) => {
          if (previous && TERMINAL_STATUSES.has(previous.status)) return previous;
          return nextJob;
        });
        setError(null);
        if (!TERMINAL_STATUSES.has(nextJob.status)) scheduleNext();
      } catch (err: unknown) {
        if (stopped || generation !== generationRef.current || isAbortError(err)) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch job status');
        scheduleNext();
      } finally {
        if (initial && !stopped && generation === generationRef.current) setLoading(false);
      }
    };

    setJob(null);
    setLoading(true);
    setError(null);
    void poll(true);

    return () => {
      stopped = true;
      controller?.abort();
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [jobId, accessToken]);

  return { job, loading, error };
}
