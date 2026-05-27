import { useState, useEffect } from 'react';
import type { DiscoveryScrapeJob } from '../types';
import { fetchDiscoveryScrapeJob } from '../lib/api/discovery';

const POLL_INTERVAL_MS = 2000;

export function useDiscoveryScrapeJob(jobId: string | null, accessToken: string | null) {
  const [job, setJob] = useState<DiscoveryScrapeJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId || !accessToken) {
      setJob(null);
      return;
    }

    let cancelled = false;
    let intervalId: number | null = null;

    const poll = () => {
      if (cancelled) return;
      fetchDiscoveryScrapeJob(jobId, accessToken)
        .then((data) => {
          if (cancelled) return;
          setJob(data);
          if (data.status === 'completed' || data.status === 'failed') {
            if (intervalId !== null) window.clearInterval(intervalId);
          }
        })
        .catch(() => {
          if (!cancelled && intervalId !== null) window.clearInterval(intervalId);
        });
    };

    setLoading(true);
    setError(null);

    fetchDiscoveryScrapeJob(jobId, accessToken)
      .then((data) => {
        if (cancelled) return;
        setJob(data);
        setLoading(false);
        if (data.status !== 'completed' && data.status !== 'failed') {
          intervalId = window.setInterval(poll, POLL_INTERVAL_MS);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch job status');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [jobId, accessToken]);

  return { job, loading, error };
}
