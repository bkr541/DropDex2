import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import {
  createInitialRouletteSessionState,
  rouletteSessionReducer,
  type RouletteSessionState,
  type RouletteSourceRole,
} from './rouletteSession';
import {
  createRouletteActionExecutor,
  type RouletteMatchingActions,
} from './rouletteActions';
import { useRouletteAudioRuntime, type RoulettePlaybackUiState } from './useRouletteAudioRuntime';

export interface RouletteSessionActions extends RouletteMatchingActions {
  play(): Promise<boolean>;
  stop(options?: { resetVisuals?: boolean }): void;
  setDeckGain(role: RouletteSourceRole, gain: number): void;
  toggleDeckMute(role: RouletteSourceRole): void;
  toggleDeckSolo(role: RouletteSourceRole): void;
}

interface RouletteSessionContextValue {
  state: RouletteSessionState;
  playback: RoulettePlaybackUiState;
  matchingAvailable: boolean;
  matchingUnavailableReason: string | null;
  playbackAvailable: boolean;
  actions: RouletteSessionActions;
  cancelPending(): void;
}

const RouletteSessionContext = createContext<RouletteSessionContextValue | null>(null);

export function rouletteDesktopMatchingAvailable(
  desktop: Window['dropdexDesktop'] | undefined = typeof window !== 'undefined' ? window.dropdexDesktop : undefined,
): boolean {
  return desktop?.isElectron === true;
}

export function RouletteSessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    rouletteSessionReducer,
    undefined,
    createInitialRouletteSessionState,
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  const getSources = useCallback(() => stateRef.current.sources, []);
  const audio = useRouletteAudioRuntime({ dispatch, getSources });
  const matchingExecutor = useMemo(() => createRouletteActionExecutor({
    getState: () => stateRef.current,
    dispatch,
    prepareSources: audio.prepareSources,
  }), [audio.prepareSources]);
  const sourceSignature = [
    state.sources.vocal.parentTrackId,
    state.sources.vocal.stemRef,
    state.sources.instrumental.parentTrackId,
    state.sources.instrumental.stemRef,
  ].join('|');

  useEffect(() => {
    audio.stop({ resetVisuals: true });
  }, [audio.stop, sourceSignature]);

  useEffect(() => () => matchingExecutor.cancel(), [matchingExecutor]);

  const pairReady = state.sources.vocal.stemStatus === 'ready'
    && state.sources.instrumental.stemStatus === 'ready'
    && Boolean(state.sources.vocal.parentTrackId && state.sources.vocal.stemRef)
    && Boolean(state.sources.instrumental.parentTrackId && state.sources.instrumental.stemRef);
  const playbackAvailable = pairReady;
  const matchingAvailable = rouletteDesktopMatchingAvailable();
  const matchingUnavailableReason = matchingAvailable
    ? null
    : 'Roulette matching requires the DropDex desktop runtime.';

  const actions = useMemo<RouletteSessionActions>(() => ({
    ...matchingExecutor.actions,
    play: audio.play,
    stop: audio.stop,
    setDeckGain: audio.setDeckGain,
    toggleDeckMute: audio.toggleDeckMute,
    toggleDeckSolo: audio.toggleDeckSolo,
  }), [
    audio.play,
    audio.setDeckGain,
    audio.stop,
    audio.toggleDeckMute,
    audio.toggleDeckSolo,
    matchingExecutor.actions,
  ]);

  const value = useMemo<RouletteSessionContextValue>(() => ({
    state,
    playback: audio.playback,
    matchingAvailable,
    matchingUnavailableReason,
    playbackAvailable,
    actions,
    cancelPending: matchingExecutor.cancel,
  }), [actions, audio.playback, matchingAvailable, matchingExecutor.cancel, matchingUnavailableReason, playbackAvailable, state]);

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
