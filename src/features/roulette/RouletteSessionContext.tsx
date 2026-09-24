import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createInitialRouletteSessionState,
  rouletteSessionReducer,
  type RouletteSessionAction,
  type RouletteSessionState,
  type RouletteSourceRole,
  type RouletteSourceSelection,
} from './rouletteSession';
import {
  createRouletteActionExecutor,
  type RouletteMatchingActions,
} from './rouletteActions';
import { useRouletteAudioRuntime, type RoulettePlaybackUiState } from './useRouletteAudioRuntime';
import {
  roulettePreviewPreparationService,
} from './roulettePreviewPreparationService';
import {
  roulettePreparedAssetRef,
  type RoulettePreviewPreparationState,
} from './roulettePreview';
import { fetchRouletteTrack } from '../../lib/queries/rouletteCandidates';
import type { RekordboxTrack } from '../../types';
import {
  createRouletteHqPairController,
  INITIAL_ROULETTE_HQ_STATE,
  type RouletteHqPairUiState,
} from './rouletteHqPairController';
import { rouletteStemPreparationService } from './stemPreparationService';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { useRouletteRuntimeReadiness } from './useRouletteRuntimeReadiness';

export interface RouletteSessionActions extends RouletteMatchingActions {
  play(): Promise<boolean>;
  stop(options?: { resetVisuals?: boolean }): void;
  setDeckGain(role: RouletteSourceRole, gain: number): void;
  toggleDeckMute(role: RouletteSourceRole): void;
  toggleDeckSolo(role: RouletteSourceRole): void;
  reconnectSource(role: RouletteSourceRole): Promise<boolean>;
  retrySource(role: RouletteSourceRole): Promise<boolean>;
  prepareHighQuality(): Promise<boolean>;
  reconnectHighQuality(): Promise<boolean>;
  cancelHighQuality(): Promise<boolean>;
}

interface RouletteSessionContextValue {
  state: RouletteSessionState;
  playback: RoulettePlaybackUiState;
  previewStates: Record<RouletteSourceRole, RoulettePreviewPreparationState | null>;
  hq: RouletteHqPairUiState;
  matchingAvailable: boolean;
  matchingUnavailableReason: string | null;
  playbackAvailable: boolean;
  actions: RouletteSessionActions;
  cancelPending(): void;
}

const RouletteSessionContext = createContext<RouletteSessionContextValue | null>(null);

const EMPTY_PREVIEW_STATES: Record<RouletteSourceRole, RoulettePreviewPreparationState | null> = {
  vocal: null,
  instrumental: null,
};

export function rouletteDesktopMatchingAvailable(
  desktop: Window['dropdexDesktop'] | undefined = typeof window !== 'undefined' ? window.dropdexDesktop : undefined,
): boolean {
  return desktop?.isElectron === true;
}

function selectionFromPreviewState(
  preview: RoulettePreviewPreparationState,
): RouletteSourceSelection | null {
  if (preview.status !== 'ready' || !preview.asset || !preview.window) return null;
  return {
    parentTrackId: preview.trackId,
    stemRef: roulettePreparedAssetRef(preview.asset),
    stemStatus: 'ready',
    window: preview.window,
  };
}

export function RouletteSessionProvider({ children }: { children: ReactNode }) {
  const [state, reactDispatch] = useReducer(
    rouletteSessionReducer,
    undefined,
    createInitialRouletteSessionState,
  );
  const [previewStates, setPreviewStates] = useState(EMPTY_PREVIEW_STATES);
  const [hq, setHq] = useState<RouletteHqPairUiState>(INITIAL_ROULETTE_HQ_STATE);
  const { status: usbStatus, volumeName: usbVolumeName, connectedAt: usbConnectedAt } = useUsbConnection();
  const runtimeReadiness = useRouletteRuntimeReadiness();
  const stateRef = useRef(state);
  const dispatch = useCallback((action: RouletteSessionAction) => {
    stateRef.current = rouletteSessionReducer(stateRef.current, action);
    reactDispatch(action);
  }, []);
  const autoUsbResumeRef = useRef(new Set<string>());
  const sourceRecoveryRef = useRef<Record<RouletteSourceRole, Promise<boolean> | null>>({
    vocal: null,
    instrumental: null,
  });
  stateRef.current = state;

  const getSources = useCallback(() => stateRef.current.sources, []);
  const audio = useRouletteAudioRuntime({ dispatch, getSources });
  const matchingExecutor = useMemo(() => createRouletteActionExecutor({
    getState: () => stateRef.current,
    dispatch,
    prepareSources: audio.prepareSources,
    commitPreparedSources: audio.commitPreparedResult,
  }), [audio.commitPreparedResult, audio.prepareSources]);
  const pairIdentity = [
    state.sources.vocal.parentTrackId ?? '',
    state.sources.instrumental.parentTrackId ?? '',
  ].join('|');
  const previousPairIdentityRef = useRef(pairIdentity);

  useEffect(() => {
    if (previousPairIdentityRef.current !== pairIdentity) {
      previousPairIdentityRef.current = pairIdentity;
      setHq(INITIAL_ROULETTE_HQ_STATE);
    }
  }, [pairIdentity]);

  useEffect(() => () => matchingExecutor.cancel(), [matchingExecutor]);

  useEffect(() => roulettePreviewPreparationService.subscribe((next) => {
    setPreviewStates((current) => ({ ...current, [next.role]: next }));
  }), []);

  useEffect(() => {
    setPreviewStates({
      vocal: state.sources.vocal.parentTrackId
        ? roulettePreviewPreparationService.getState(state.sources.vocal.parentTrackId, 'vocal')
        : null,
      instrumental: state.sources.instrumental.parentTrackId
        ? roulettePreviewPreparationService.getState(state.sources.instrumental.parentTrackId, 'instrumental')
        : null,
    });
  }, [state.sources.instrumental.parentTrackId, state.sources.vocal.parentTrackId]);

  const pairReady = state.sources.vocal.stemStatus === 'ready'
    && state.sources.instrumental.stemStatus === 'ready'
    && Boolean(state.sources.vocal.parentTrackId && state.sources.vocal.stemRef)
    && Boolean(state.sources.instrumental.parentTrackId && state.sources.instrumental.stemRef)
    && state.sources.vocal.parentTrackId !== state.sources.instrumental.parentTrackId;
  const playbackAvailable = pairReady && runtimeReadiness.ready;
  const matchingAvailable = runtimeReadiness.ready;
  const matchingUnavailableReason = runtimeReadiness.ready
    ? null
    : runtimeReadiness.status === 'checking'
      ? 'Checking Roulette audio runtime…'
      : runtimeReadiness.status === 'setup-required'
        ? runtimeReadiness.message ?? 'Roulette audio runtime setup is required.'
        : runtimeReadiness.status === 'temporarily-unavailable'
          ? runtimeReadiness.message ?? 'Roulette audio runtime is temporarily unavailable.'
          : 'Roulette matching requires the DropDex desktop runtime.';

  const completePreparedSource = useCallback(async (
    role: RouletteSourceRole,
    preview: RoulettePreviewPreparationState | null,
  ): Promise<boolean> => {
    if (!preview) return false;
    const selection = selectionFromPreviewState(preview);
    if (!selection) return false;

    const opposite: RouletteSourceRole = role === 'vocal' ? 'instrumental' : 'vocal';
    const fixed = stateRef.current.sources[opposite];
    let nextSources = role === 'vocal'
      ? { vocal: selection, instrumental: fixed }
      : { vocal: fixed, instrumental: selection };
    if (
      nextSources.vocal.parentTrackId
      && nextSources.instrumental.parentTrackId
      && nextSources.vocal.parentTrackId === nextSources.instrumental.parentTrackId
    ) return false;

    if (fixed.parentTrackId && fixed.stemStatus !== 'ready') {
      const existingPartnerState = roulettePreviewPreparationService.getState(fixed.parentTrackId, opposite);
      if (!existingPartnerState) {
        const partnerTrack = await fetchRouletteTrack(fixed.parentTrackId);
        if (partnerTrack) {
          const partnerPreview = await roulettePreviewPreparationService.prepare(partnerTrack, opposite);
          const partnerSelection = selectionFromPreviewState(partnerPreview);
          if (partnerSelection) {
            nextSources = role === 'vocal'
              ? { vocal: selection, instrumental: partnerSelection }
              : { vocal: partnerSelection, instrumental: selection };
            const controller = new AbortController();
            const prepared = await audio.prepareSources(nextSources, controller.signal);
            dispatch({ type: 'commit-source', role, selection });
            dispatch({ type: 'commit-source', role: opposite, selection: partnerSelection });
            audio.commitPreparedResult(prepared);
            return true;
          }
        }
      }

      dispatch({ type: 'commit-source', role, selection });
      return true;
    }

    if (
      nextSources.vocal.stemStatus === 'ready'
      && nextSources.vocal.stemRef
      && nextSources.instrumental.stemStatus === 'ready'
      && nextSources.instrumental.stemRef
    ) {
      const controller = new AbortController();
      const prepared = await audio.prepareSources(nextSources, controller.signal);
      dispatch({ type: 'commit-source', role, selection });
      audio.commitPreparedResult(prepared);
      return true;
    }

    dispatch({ type: 'commit-source', role, selection });
    return true;
  }, [audio.commitPreparedResult, audio.prepareSources]);


  const runSourceRecovery = useCallback((
    role: RouletteSourceRole,
    work: () => Promise<boolean>,
  ): Promise<boolean> => {
    const existing = sourceRecoveryRef.current[role];
    if (existing) return existing;
    let request!: Promise<boolean>;
    request = work().finally(() => {
      if (sourceRecoveryRef.current[role] === request) sourceRecoveryRef.current[role] = null;
    });
    sourceRecoveryRef.current[role] = request;
    return request;
  }, []);

  const retrySource = useCallback((role: RouletteSourceRole): Promise<boolean> => runSourceRecovery(role, async () => {
    const trackId = stateRef.current.sources[role].parentTrackId;
    if (!trackId || stateRef.current.transport.status !== 'stopped') return false;
    const result = await roulettePreviewPreparationService.retry(trackId, role);
    return completePreparedSource(role, result);
  }), [completePreparedSource, runSourceRecovery]);

  const reconnectSource = useCallback((role: RouletteSourceRole): Promise<boolean> => runSourceRecovery(role, async () => {
    const trackId = stateRef.current.sources[role].parentTrackId;
    if (!trackId || stateRef.current.transport.status !== 'stopped') return false;
    const reconnected = await roulettePreviewPreparationService.reconnectAndResume(trackId, role);
    if (!reconnected) return false;
    return completePreparedSource(role, roulettePreviewPreparationService.getState(trackId, role));
  }), [completePreparedSource, runSourceRecovery]);

  const hqController = useMemo(() => createRouletteHqPairController({
    prepare: rouletteStemPreparationService.prepare,
    cancel: rouletteStemPreparationService.cancel,
    onState: setHq,
  }), []);

  const prepareHighQuality = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    const vocalId = current.sources.vocal.parentTrackId;
    const instrumentalId = current.sources.instrumental.parentTrackId;
    if (
      !vocalId
      || !instrumentalId
      || vocalId === instrumentalId
      || current.transport.status !== 'stopped'
      || current.command.status === 'loading'
    ) return false;

    const [vocalTrack, instrumentalTrack] = await Promise.all([
      fetchRouletteTrack(vocalId),
      fetchRouletteTrack(instrumentalId),
    ]);
    if (!vocalTrack || !instrumentalTrack) {
      setHq({
        status: 'failed',
        progress: 0,
        activeRole: null,
        completedRoles: [],
        message: 'The selected parent tracks are no longer available.',
      });
      return false;
    }

    const result = await hqController.preparePair(vocalTrack, instrumentalTrack);
    const tracks: Record<RouletteSourceRole, RekordboxTrack> = {
      vocal: vocalTrack,
      instrumental: instrumentalTrack,
    };
    const selections: Partial<Record<RouletteSourceRole, RouletteSourceSelection>> = {};
    for (const role of result.completedRoles) {
      const refreshed = await roulettePreviewPreparationService.prepare(tracks[role], role);
      const selection = selectionFromPreviewState(refreshed);
      if (selection) selections[role] = selection;
    }

    const nextSources = {
      vocal: selections.vocal ?? stateRef.current.sources.vocal,
      instrumental: selections.instrumental ?? stateRef.current.sources.instrumental,
    };
    let prepared = null;
    if (
      nextSources.vocal.stemStatus === 'ready'
      && nextSources.vocal.stemRef
      && nextSources.instrumental.stemStatus === 'ready'
      && nextSources.instrumental.stemRef
    ) {
      const controller = new AbortController();
      prepared = await audio.prepareSources(nextSources, controller.signal);
    }
    for (const role of result.completedRoles) {
      const selection = selections[role];
      if (selection) dispatch({ type: 'update-source', role, selection });
    }
    if (prepared) audio.commitPreparedResult(prepared);
    return result.status === 'ready' || result.status === 'partial';
  }, [audio.commitPreparedResult, audio.prepareSources, hqController]);

  const reconnectHighQuality = useCallback(async (): Promise<boolean> => {
    const currentHq = hqController.getState();
    if (currentHq.recoveryAction !== 'reconnect-source') return false;
    const reconnected = await rouletteStemPreparationService.reconnectSource(currentHq.requiredVolumeName ?? null);
    if (!reconnected) return false;
    return prepareHighQuality();
  }, [hqController, prepareHighQuality]);

  const actions = useMemo<RouletteSessionActions>(() => ({
    ...matchingExecutor.actions,
    play: audio.play,
    stop: audio.stop,
    setDeckGain: audio.setDeckGain,
    toggleDeckMute: audio.toggleDeckMute,
    toggleDeckSolo: audio.toggleDeckSolo,
    reconnectSource,
    retrySource,
    prepareHighQuality,
    reconnectHighQuality,
    cancelHighQuality: hqController.cancel,
  }), [
    audio.play,
    audio.setDeckGain,
    audio.stop,
    audio.toggleDeckMute,
    audio.toggleDeckSolo,
    hqController.cancel,
    matchingExecutor.actions,
    prepareHighQuality,
    reconnectHighQuality,
    reconnectSource,
    retrySource,
  ]);

  useEffect(() => {
    if (usbStatus !== 'connected') return;
    for (const role of ['vocal', 'instrumental'] as const) {
      const preview = previewStates[role];
      const selectedTrackId = state.sources[role].parentTrackId;
      if (
        preview?.status !== 'source-required'
        || !selectedTrackId
        || preview.trackId !== selectedTrackId
        || (preview.requiredVolumeName && usbVolumeName && preview.requiredVolumeName !== usbVolumeName)
      ) continue;
      const key = `${role}:${selectedTrackId}:${usbConnectedAt ?? usbVolumeName ?? 'connected'}`;
      if (autoUsbResumeRef.current.has(key)) continue;
      autoUsbResumeRef.current.add(key);
      void actions.retrySource(role);
    }
  }, [actions, previewStates, state.sources, usbConnectedAt, usbStatus, usbVolumeName]);

  const value = useMemo<RouletteSessionContextValue>(() => ({
    state,
    playback: audio.playback,
    previewStates,
    hq,
    matchingAvailable,
    matchingUnavailableReason,
    playbackAvailable,
    actions,
    cancelPending: matchingExecutor.cancel,
  }), [actions, audio.playback, hq, matchingAvailable, matchingExecutor.cancel, matchingUnavailableReason, playbackAvailable, previewStates, state]);

  return (
    <RouletteSessionContext.Provider value={value}>
      {children}
    </RouletteSessionContext.Provider>
  );
}

export function useRouletteSession(): RouletteSessionContextValue {
  const context = useContext(RouletteSessionContext);
  if (!context) {
    throw new Error('useRouletteSession must be used inside RouletteSessionProvider');
  }
  return context;
}
