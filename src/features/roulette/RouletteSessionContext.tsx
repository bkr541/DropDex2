import {
  createContext,
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
} from './rouletteSession';
import {
  createRouletteActionExecutor,
  type RouletteSessionActions,
} from './rouletteActions';

interface RouletteSessionContextValue {
  state: RouletteSessionState;
  matchingAvailable: true;
  playbackAvailable: false;
  actions: RouletteSessionActions;
  cancelPending(): void;
}

const RouletteSessionContext = createContext<RouletteSessionContextValue | null>(null);

export function RouletteSessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    rouletteSessionReducer,
    undefined,
    createInitialRouletteSessionState,
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  const executor = useMemo(() => createRouletteActionExecutor({
    getState: () => stateRef.current,
    dispatch,
  }), []);

  useEffect(() => () => executor.cancel(), [executor]);

  const value = useMemo<RouletteSessionContextValue>(() => ({
    state,
    matchingAvailable: true,
    playbackAvailable: false,
    actions: executor.actions,
    cancelPending: executor.cancel,
  }), [executor, state]);

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
