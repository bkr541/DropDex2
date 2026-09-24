import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRouletteAvailabilitySnapshot } from '../../lib/queries/rouletteCandidates';
import { subscribeToRekordboxAnalysisProgress } from '../../lib/rekordbox/analysisProgressEvents';

export const ROULETTE_AVAILABILITY_REFRESH_MS = 30_000;

export interface RouletteMatchingAvailabilityState {
  loading: boolean;
  available: boolean;
  compatiblePairCount: number;
  vocalCandidateCount: number;
  instrumentalCandidateCount: number;
  canChangeVocal: boolean;
  canChangeInstrumental: boolean;
  canRouletteBoth: boolean;
  reason: string | null;
}

const EMPTY_STATE: RouletteMatchingAvailabilityState = {
  loading: false,
  available: false,
  compatiblePairCount: 0,
  vocalCandidateCount: 0,
  instrumentalCandidateCount: 0,
  canChangeVocal: false,
  canChangeInstrumental: false,
  canRouletteBoth: false,
  reason: null,
};

export function useRouletteMatchingAvailability(
  enabled: boolean,
  currentVocalTrackId?: string | null,
  currentInstrumentalTrackId?: string | null,
): RouletteMatchingAvailabilityState {
  const [state, setState] = useState<RouletteMatchingAvailabilityState>({
    ...EMPTY_STATE,
    loading: enabled,
  });
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setState(EMPTY_STATE);
      return;
    }
    const requestId = ++requestSequence.current;
    setState((current) => ({ ...current, loading: true }));
    try {
      const readiness = await fetchRouletteAvailabilitySnapshot(
        currentVocalTrackId,
        currentInstrumentalTrackId,
      );
      if (requestSequence.current !== requestId) return;
      setState({
        loading: false,
        available: readiness.available,
        compatiblePairCount: readiness.compatiblePairCount,
        vocalCandidateCount: readiness.vocalCandidateCount,
        instrumentalCandidateCount: readiness.instrumentalCandidateCount,
        canChangeVocal: readiness.actions.canChangeVocal,
        canChangeInstrumental: readiness.actions.canChangeInstrumental,
        canRouletteBoth: readiness.actions.canRouletteBoth,
        reason: readiness.available
          ? null
          : readiness.reason === 'no-active-library'
            ? 'Import a Rekordbox library to use Roulette.'
            : 'No musically compatible Roulette pair is available yet.',
      });
    } catch {
      if (requestSequence.current !== requestId) return;
      setState({ ...EMPTY_STATE, reason: 'Roulette could not verify musical candidate readiness.' });
    }
  }, [currentInstrumentalTrackId, currentVocalTrackId, enabled]);

  useEffect(() => {
    if (!enabled) {
      requestSequence.current += 1;
      setState(EMPTY_STATE);
      return undefined;
    }
    void refresh();
    const unsubscribeAnalysis = subscribeToRekordboxAnalysisProgress(() => { void refresh(); });
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => { void refresh(); }, ROULETTE_AVAILABILITY_REFRESH_MS);
    return () => {
      requestSequence.current += 1;
      unsubscribeAnalysis();
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [enabled, refresh]);

  return state;
}
