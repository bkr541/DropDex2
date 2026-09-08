import { useEffect, useState } from 'react';
import { rouletteStemAssetService } from './stemAssetService';
import {
  stemTypeForRole,
  type StemAssetReadiness,
} from './stemAssets';
import type { RouletteSourceRole } from './rouletteSession';

interface StemReadinessState {
  parentTrackId: string | null;
  loading: boolean;
  readiness: StemAssetReadiness | null;
  error: string | null;
}

export function useRouletteStemReadiness(
  parentTrackId: string | null,
  role: RouletteSourceRole,
): Omit<StemReadinessState, 'parentTrackId'> {
  const [state, setState] = useState<StemReadinessState>({
    parentTrackId,
    loading: Boolean(parentTrackId),
    readiness: null,
    error: null,
  });

  useEffect(() => {
    if (!parentTrackId) {
      setState({ parentTrackId: null, loading: false, readiness: null, error: null });
      return undefined;
    }

    const controller = new AbortController();
    setState({ parentTrackId, loading: true, readiness: null, error: null });
    rouletteStemAssetService
      .getReadiness(parentTrackId, stemTypeForRole(role))
      .then((readiness) => {
        if (!controller.signal.aborted) {
          setState({ parentTrackId, loading: false, readiness, error: null });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            parentTrackId,
            loading: false,
            readiness: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => controller.abort();
  }, [parentTrackId, role]);

  if (state.parentTrackId !== parentTrackId) {
    return {
      loading: Boolean(parentTrackId),
      readiness: null,
      error: null,
    };
  }
  return {
    loading: state.loading,
    readiness: state.readiness,
    error: state.error,
  };
}
