import { useEffect, useState } from 'react';
import type { RekordboxTrack } from '../../types';
import { fetchRouletteTrack } from '../../lib/queries/rouletteCandidates';

interface RouletteSourceTrackState {
  parentTrackId: string | null;
  track: RekordboxTrack | null;
  loading: boolean;
  error: string | null;
}

export function useRouletteSourceTrack(parentTrackId: string | null) {
  const [state, setState] = useState<RouletteSourceTrackState>({
    parentTrackId,
    track: null,
    loading: Boolean(parentTrackId),
    error: null,
  });

  useEffect(() => {
    if (!parentTrackId) {
      setState({ parentTrackId: null, track: null, loading: false, error: null });
      return undefined;
    }

    let cancelled = false;
    setState({ parentTrackId, track: null, loading: true, error: null });
    void fetchRouletteTrack(parentTrackId)
      .then((track) => {
        if (!cancelled) {
          setState({
            parentTrackId,
            track,
            loading: false,
            error: track ? null : 'Parent track is no longer available.',
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            parentTrackId,
            track: null,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => { cancelled = true; };
  }, [parentTrackId]);

  if (state.parentTrackId !== parentTrackId) {
    return { track: null, loading: Boolean(parentTrackId), error: null };
  }
  return { track: state.track, loading: state.loading, error: state.error };
}
