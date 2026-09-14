import { useEffect, useState } from 'react';
import { fetchRouletteCandidateReadiness } from '../../lib/queries/rouletteCandidates';

export interface RouletteMatchingAvailabilityState {
  loading: boolean;
  available: boolean;
  reason: string | null;
}

export function useRouletteMatchingAvailability(
  desktopRuntimeAvailable: boolean,
): RouletteMatchingAvailabilityState {
  const [state, setState] = useState<RouletteMatchingAvailabilityState>({
    loading: desktopRuntimeAvailable,
    available: false,
    reason: null,
  });

  useEffect(() => {
    if (!desktopRuntimeAvailable) {
      setState({ loading: false, available: false, reason: null });
      return undefined;
    }

    let cancelled = false;
    setState({ loading: true, available: false, reason: null });
    void fetchRouletteCandidateReadiness()
      .then((readiness) => {
        if (cancelled) return;
        setState({
          loading: false,
          available: readiness.available,
          reason: readiness.available
            ? null
            : readiness.reason === 'no-active-library'
              ? 'Import a Rekordbox library to use Roulette.'
              : 'No musically compatible Roulette pair is available yet.',
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({
          loading: false,
          available: false,
          reason: 'Roulette could not verify musical candidate readiness.',
        });
      });

    return () => { cancelled = true; };
  }, [desktopRuntimeAvailable]);

  return state;
}
