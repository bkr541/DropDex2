export type RouletteSourceRole = 'vocal' | 'instrumental';

export type RouletteStemStatus = 'unavailable' | 'preparing' | 'ready' | 'failed';

export interface RouletteSourceSelection {
  parentTrackId: string | null;
  stemRef: string | null;
  stemStatus: RouletteStemStatus;
}

export type RouletteCommand =
  | 'replace-vocal'
  | 'replace-instrumental'
  | 'replace-both'
  | 'play'
  | 'stop';

export type RouletteCommandStatus = 'idle' | 'loading' | 'error';
export type RouletteTransportStatus = 'stopped' | 'playing';

export interface RouletteSessionState {
  sources: Record<RouletteSourceRole, RouletteSourceSelection>;
  command: {
    active: RouletteCommand | null;
    status: RouletteCommandStatus;
    error: string | null;
  };
  transport: {
    status: RouletteTransportStatus;
    masterBpm: number | null;
  };
}

export type RouletteSessionAction =
  | { type: 'commit-source'; role: RouletteSourceRole; selection: RouletteSourceSelection }
  | {
      type: 'commit-pair';
      vocal: RouletteSourceSelection;
      instrumental: RouletteSourceSelection;
    }
  | { type: 'command-started'; command: RouletteCommand }
  | { type: 'command-finished'; command: RouletteCommand }
  | { type: 'command-failed'; command: RouletteCommand; error: string }
  | { type: 'transport-changed'; status: RouletteTransportStatus; masterBpm?: number | null };

const emptySource = (): RouletteSourceSelection => ({
  parentTrackId: null,
  stemRef: null,
  stemStatus: 'unavailable',
});

export function createInitialRouletteSessionState(): RouletteSessionState {
  return {
    sources: {
      vocal: emptySource(),
      instrumental: emptySource(),
    },
    command: {
      active: null,
      status: 'idle',
      error: null,
    },
    transport: {
      status: 'stopped',
      masterBpm: null,
    },
  };
}

export function rouletteSessionReducer(
  state: RouletteSessionState,
  action: RouletteSessionAction,
): RouletteSessionState {
  switch (action.type) {
    case 'commit-source':
      return {
        ...state,
        sources: {
          ...state.sources,
          [action.role]: action.selection,
        },
        command: { active: null, status: 'idle', error: null },
      };

    case 'commit-pair':
      return {
        ...state,
        sources: {
          vocal: action.vocal,
          instrumental: action.instrumental,
        },
        command: { active: null, status: 'idle', error: null },
      };

    case 'command-started':
      return {
        ...state,
        command: { active: action.command, status: 'loading', error: null },
      };

    case 'command-finished':
      if (state.command.active !== action.command) return state;
      return {
        ...state,
        command: { active: null, status: 'idle', error: null },
      };

    case 'command-failed':
      if (state.command.active !== action.command) return state;
      return {
        ...state,
        command: { active: null, status: 'error', error: action.error },
      };

    case 'transport-changed':
      return {
        ...state,
        transport: {
          status: action.status,
          masterBpm: action.masterBpm === undefined ? state.transport.masterBpm : action.masterBpm,
        },
      };
  }
}
