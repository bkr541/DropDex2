import { useEffect, useState } from 'react';
import { hasRouletteReadyStemPairCandidates } from '../../lib/queries/rouletteCandidates';

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
    void hasRouletteReadyStemPairCandidates()
      .then((available) => {
        if (cancelled) return;
        setState({
          loading: false,
          available,
          reason: available ? null : 'Prepare Roulette stems for at least two different tracks.',
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({
          loading: false,
          available: false,
          reason: 'Roulette could not verify prepared stem candidates.',
        });
      });

    return () => { cancelled = true; };
  }, [desktopRuntimeAvailable]);

  return state;
}
