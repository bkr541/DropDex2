import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import {
  createInitialRouletteSessionState,
  rouletteSessionReducer,
  type RouletteCommand,
  type RouletteSessionState,
  type RouletteSourceRole,
} from './rouletteSession';

export interface RouletteSessionActions {
  replaceSource(role: RouletteSourceRole): boolean;
  replaceBoth(): boolean;
  play(): boolean;
  stop(): boolean;
}

interface RouletteSessionContextValue {
  state: RouletteSessionState;
  runtimeAvailable: false;
  actions: RouletteSessionActions;
}

const RouletteSessionContext = createContext<RouletteSessionContextValue | null>(null);

const unavailableCommand = (_command: RouletteCommand): boolean => false;

export function RouletteSessionProvider({ children }: { children: ReactNode }) {
  const [state] = useReducer(rouletteSessionReducer, undefined, createInitialRouletteSessionState);

  const actions = useMemo<RouletteSessionActions>(() => ({
    replaceSource: (role) => unavailableCommand(role === 'vocal' ? 'replace-vocal' : 'replace-instrumental'),
    replaceBoth: () => unavailableCommand('replace-both'),
    play: () => unavailableCommand('play'),
    stop: () => unavailableCommand('stop'),
  }), []);

  const value = useMemo<RouletteSessionContextValue>(() => ({
    state,
    runtimeAvailable: false,
    actions,
  }), [actions, state]);

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
