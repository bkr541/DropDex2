import { useCallback, useEffect, useState } from 'react';
import type { RekordboxTrack } from '../../types';
import { rouletteStemAssetService } from './stemAssetService';
import {
  ROULETTE_SEPARATOR_VERSION,
  rouletteStemPreparationService,
} from './stemPreparationService';

export type RouletteTrackPreparationUiStatus =
  | 'loading'
  | 'unavailable'
  | 'preparing'
  | 'ready'
  | 'failed';

interface PreparationUiState {
  trackId: string;
  status: RouletteTrackPreparationUiStatus;
  message: string | null;
  localBusy: boolean;
}

function statusFromReadiness(
  vocals: Awaited<ReturnType<typeof rouletteStemAssetService.getReadiness>>,
  instrumental: Awaited<ReturnType<typeof rouletteStemAssetService.getReadiness>>,
): Pick<PreparationUiState, 'status' | 'message'> {
  if (vocals.status === 'ready' && instrumental.status === 'ready') {
    return { status: 'ready', message: null };
  }
  if (vocals.status === 'failed' || instrumental.status === 'failed') {
    return {
      status: 'failed',
      message: vocals.reason ?? instrumental.reason ?? 'Stem preparation failed. Retry the track.',
    };
  }
  if (vocals.status === 'preparing' || instrumental.status === 'preparing') {
    return {
      status: 'preparing',
      message: 'Stem preparation is incomplete. Retry to resume local processing.',
    };
  }
  return { status: 'unavailable', message: null };
}

export function useRouletteTrackStemPreparation(track: RekordboxTrack) {
  const [state, setState] = useState<PreparationUiState>({
    trackId: track.id,
    status: 'loading',
    message: null,
    localBusy: false,
  });

  const refresh = useCallback(async () => {
    const [vocals, instrumental] = await Promise.all([
      rouletteStemAssetService.getReadiness(track.id, 'vocals', {
        expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION,
      }),
      rouletteStemAssetService.getReadiness(track.id, 'instrumental', {
        expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION,
      }),
    ]);
    const derived = statusFromReadiness(vocals, instrumental);
    setState((current) => ({
      trackId: track.id,
      ...derived,
      localBusy: current.trackId === track.id ? current.localBusy : false,
    }));
  }, [track.id]);

  useEffect(() => {
    let cancelled = false;
    setState({ trackId: track.id, status: 'loading', message: null, localBusy: false });
    void Promise.all([
      rouletteStemAssetService.getReadiness(track.id, 'vocals', {
        expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION,
      }),
      rouletteStemAssetService.getReadiness(track.id, 'instrumental', {
        expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION,
      }),
    ]).then(([vocals, instrumental]) => {
      if (cancelled) return;
      setState({ trackId: track.id, ...statusFromReadiness(vocals, instrumental), localBusy: false });
    }).catch((error) => {
      if (cancelled) return;
      setState({
        trackId: track.id,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        localBusy: false,
      });
    });
    return () => { cancelled = true; };
  }, [track.id]);

  const prepare = useCallback(async () => {
    setState((current) => ({
      trackId: track.id,
      status: 'preparing',
      message: null,
      localBusy: true,
    }));
    const outcome = await rouletteStemPreparationService.prepare(track);
    setState((current) => ({ ...current, localBusy: false, message: outcome.message }));
    await refresh();
    return outcome;
  }, [refresh, track]);

  const cancel = useCallback(async () => {
    const cancelled = await rouletteStemPreparationService.cancel(track.id);
    if (cancelled) {
      setState((current) => ({ ...current, message: 'Cancelling local stem preparation…' }));
    }
    return cancelled;
  }, [track.id]);

  if (state.trackId !== track.id) {
    return { status: 'loading' as const, message: null, localBusy: false, prepare, cancel, refresh };
  }
  return { ...state, prepare, cancel, refresh };
}
