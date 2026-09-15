export type RouletteSourceRole = 'vocal' | 'instrumental';

export type RouletteStemStatus = 'unavailable' | 'preparing' | 'ready' | 'failed';

export type RouletteSourceWindowProvenance =
  | 'pvdi-phrase'
  | 'pvdi-downbeat'
  | 'phrase'
  | 'downbeat'
  | 'bpm-fallback';

/** Parent-track window locked at selection time. Preview media may start at zero,
 * but these values always remain in the parent Rekordbox timeline. */
export interface RouletteSourceWindow {
  sourceTimeMs: number;
  windowEndMs: number;
  durationMs: number;
  sourceBar: number | null;
  sourceBeatSequence: number | null;
  requestedBars: number;
  provenance: RouletteSourceWindowProvenance;
}

export interface RouletteSourceSelection {
  parentTrackId: string | null;
  stemRef: string | null;
  stemStatus: RouletteStemStatus;
  /** Exact 16-bar parent-track source window chosen for this deck. */
  window?: RouletteSourceWindow | null;
}

export type RouletteCommand =
  | 'initialize'
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
    requestId: string | null;
    status: RouletteCommandStatus;
    error: string | null;
  };
  transport: {
    status: RouletteTransportStatus;
    masterBpm: number | null;
  };
}

export type RouletteSessionAction =
  | {
      type: 'commit-source';
      role: RouletteSourceRole;
      selection: RouletteSourceSelection;
      requestId?: string;
    }
  | {
      type: 'commit-pair';
      vocal: RouletteSourceSelection;
      instrumental: RouletteSourceSelection;
      requestId?: string;
    }
  | { type: 'stage-source'; role: RouletteSourceRole; selection: RouletteSourceSelection; requestId?: string }
  | { type: 'stage-pair'; vocal: RouletteSourceSelection; instrumental: RouletteSourceSelection; requestId?: string }
  | { type: 'update-source'; role: RouletteSourceRole; selection: RouletteSourceSelection; requestId?: string }
  | { type: 'restore-sources'; sources: RouletteSessionState['sources']; requestId?: string }
  | { type: 'command-started'; command: RouletteCommand; requestId: string }
  | { type: 'command-finished'; command: RouletteCommand; requestId: string }
  | { type: 'command-failed'; command: RouletteCommand; requestId: string; error: string }
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
      requestId: null,
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
    case 'stage-source':
      if (action.requestId && state.command.requestId !== action.requestId) return state;
      return {
        ...state,
        sources: {
          ...state.sources,
          [action.role]: action.selection,
        },
      };

    case 'stage-pair':
      if (action.requestId && state.command.requestId !== action.requestId) return state;
      return {
        ...state,
        sources: {
          vocal: action.vocal,
          instrumental: action.instrumental,
        },
      };

    case 'update-source':
      if (action.requestId && state.command.requestId !== action.requestId) return state;
      return {
        ...state,
        sources: {
          ...state.sources,
          [action.role]: action.selection,
        },
      };

    case 'restore-sources':
      if (action.requestId && state.command.requestId !== action.requestId) return state;
      return { ...state, sources: action.sources };

    case 'commit-source':
      if (action.requestId && state.command.requestId !== action.requestId) return state;
      return {
        ...state,
        sources: {
          ...state.sources,
          [action.role]: action.selection,
        },
        command: { active: null, requestId: null, status: 'idle', error: null },
      };

    case 'commit-pair':
      if (action.requestId && state.command.requestId !== action.requestId) return state;
      return {
        ...state,
        sources: {
          vocal: action.vocal,
          instrumental: action.instrumental,
        },
        command: { active: null, requestId: null, status: 'idle', error: null },
      };

    case 'command-started':
      return {
        ...state,
        command: { active: action.command, requestId: action.requestId, status: 'loading', error: null },
      };

    case 'command-finished':
      if (state.command.active !== action.command || state.command.requestId !== action.requestId) return state;
      return {
        ...state,
        command: { active: null, requestId: null, status: 'idle', error: null },
      };

    case 'command-failed':
      if (state.command.active !== action.command || state.command.requestId !== action.requestId) return state;
      return {
        ...state,
        command: { active: null, requestId: null, status: 'error', error: action.error },
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
