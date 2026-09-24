import {
  type RouletteCommand,
  type RouletteSessionAction,
  type RouletteSessionState,
  type RouletteCommandRecoveryAction,
  type RouletteSourceRole,
  type RouletteSourceSelection,
} from './rouletteSession';
import type { RoulettePlaybackResult, RoulettePlaybackSources } from './rouletteAudioRuntime';
import {
  rouletteMatchingEngine,
  type RouletteMatchingEngine,
  type RouletteResolvedSource,
} from './rouletteMatchingEngine';
import { roulettePreparedAssetRef } from './roulettePreview';
import { roulettePreviewPreparationService } from './roulettePreviewPreparationService';
import { RouletteSelectionHistory } from './rouletteSelectionHistory';



class RouletteActionFailure extends Error {
  readonly recoveryAction: RouletteCommandRecoveryAction;

  constructor(message: string, recoveryAction: RouletteCommandRecoveryAction) {
    super(message);
    this.name = 'RouletteActionFailure';
    this.recoveryAction = recoveryAction;
  }
}

export class RouletteSourceRecoveryRequiredError extends Error {
  readonly role: RouletteSourceRole;
  readonly trackId: string;

  constructor(role: RouletteSourceRole, trackId: string, message: string) {
    super(message);
    this.name = 'RouletteSourceRecoveryRequiredError';
    this.role = role;
    this.trackId = trackId;
  }
}

function isSourceRecoveryRequiredError(error: unknown): error is RouletteSourceRecoveryRequiredError {
  return error instanceof RouletteSourceRecoveryRequiredError;
}

export interface RouletteMatchingActions {
  initialize(): Promise<boolean>;
  replaceSource(role: RouletteSourceRole): Promise<boolean>;
  replaceBoth(): Promise<boolean>;
}

export interface RouletteActionExecutor {
  actions: RouletteMatchingActions;
  cancel(): void;
}

interface RouletteActionExecutorDependencies {
  getState(): RouletteSessionState;
  dispatch: (action: RouletteSessionAction) => void;
  matcher?: RouletteMatchingEngine;
  prepareSources?: (sources: RoulettePlaybackSources, signal: AbortSignal) => Promise<RoulettePlaybackResult | void>;
  commitPreparedSources?: (prepared: RoulettePlaybackResult | void) => void;
  prepareResolvedSource?: (
    resolved: RouletteResolvedSource,
    role: RouletteSourceRole,
    signal: AbortSignal,
  ) => Promise<RouletteSourceSelection>;
  selectionHistory?: RouletteSelectionHistory;
}

function legacyReadySelection(resolved: RouletteResolvedSource): RouletteSourceSelection | null {
  if (!resolved.stemAsset || resolved.stemAsset.status !== 'ready') return null;
  return {
    parentTrackId: resolved.parentTrackId,
    stemRef: resolved.stemAsset.id,
    stemStatus: 'ready',
  };
}

async function defaultPrepareResolvedSource(
  resolved: RouletteResolvedSource,
  role: RouletteSourceRole,
  signal: AbortSignal,
): Promise<RouletteSourceSelection> {
  if (signal.aborted) throw new DOMException('Roulette replacement cancelled.', 'AbortError');

  // Test and migration compatibility for an already-resolved legacy HQ source.
  // Production matching always returns the parent track and goes through the
  // Stage 3/4 preparation service so the exact 16-bar window is locked.
  if (!resolved.track) {
    const legacy = legacyReadySelection(resolved);
    if (legacy) return legacy;
    throw new RouletteActionFailure('Roulette source details are unavailable for preparation.', 'none');
  }

  const onAbort = () => { void roulettePreviewPreparationService.cancel(resolved.parentTrackId, role); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const preparation = await roulettePreviewPreparationService.prepare(resolved.track, role);
    if (signal.aborted) throw new DOMException('Roulette replacement cancelled.', 'AbortError');
    if (preparation.status === 'source-required') {
      throw new RouletteSourceRecoveryRequiredError(
        role,
        resolved.parentTrackId,
        preparation.message ?? `Reconnect the source media to continue preparing the ${role} audition source.`,
      );
    }
    if (preparation.status !== 'ready' || !preparation.asset || !preparation.window) {
      throw new RouletteActionFailure(
        preparation.message ?? `Roulette could not prepare the ${role} audition source.`,
        preparation.recoveryAction,
      );
    }
    return {
      parentTrackId: resolved.parentTrackId,
      stemRef: roulettePreparedAssetRef(preparation.asset),
      stemStatus: 'ready',
      window: preparation.window,
    };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function commandFailure(
  error: unknown,
  command: RouletteCommand,
): { message: string; recoveryAction: RouletteCommandRecoveryAction } {
  if (error instanceof RouletteSourceRecoveryRequiredError) {
    return { message: error.message, recoveryAction: 'reconnect-source' };
  }
  if (error instanceof RouletteActionFailure) {
    return { message: error.message, recoveryAction: error.recoveryAction };
  }
  if (command === 'initialize') {
    return { message: 'Roulette initialization failed. Try again.', recoveryAction: 'retry' };
  }
  return { message: 'Roulette could not complete that source change. Try again.', recoveryAction: 'retry' };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function commandForRole(role: RouletteSourceRole): RouletteCommand {
  return role === 'vocal' ? 'replace-vocal' : 'replace-instrumental';
}

function oppositeRole(role: RouletteSourceRole): RouletteSourceRole {
  return role === 'vocal' ? 'instrumental' : 'vocal';
}

function missingReferenceMessage(role: RouletteSourceRole): string {
  return role === 'vocal'
    ? 'Select an instrumental source before changing the vocal.'
    : 'Select a vocal source before changing the instrumental.';
}

function noCandidateMessage(_role: RouletteSourceRole): string {
  return 'No more compatible sources';
}

function currentPair(state: RouletteSessionState): RoulettePlaybackSources {
  return {
    vocal: state.sources.vocal,
    instrumental: state.sources.instrumental,
  };
}

function stagedSelection(parentTrackId: string): RouletteSourceSelection {
  return { parentTrackId, stemRef: null, stemStatus: 'preparing', window: null };
}

export function createRouletteActionExecutor({
  getState,
  dispatch,
  matcher = rouletteMatchingEngine,
  prepareSources = async () => undefined,
  commitPreparedSources = () => undefined,
  prepareResolvedSource = defaultPrepareResolvedSource,
  selectionHistory = new RouletteSelectionHistory(),
}: RouletteActionExecutorDependencies): RouletteActionExecutor {
  let sequence = 0;
  let activeController: AbortController | null = null;

  const begin = (command: RouletteCommand) => {
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    const requestId = `roulette-${++sequence}`;
    dispatch({ type: 'command-started', command, requestId });
    return { controller, requestId };
  };

  const clearController = (controller: AbortController) => {
    if (activeController === controller) activeController = null;
  };

  const finishAbort = (command: RouletteCommand, requestId: string, controller: AbortController) => {
    clearController(controller);
    dispatch({ type: 'command-finished', command, requestId });
  };

  const rememberCurrent = (state: RouletteSessionState) => {
    selectionHistory.rememberPair(
      state.sources.vocal.parentTrackId,
      state.sources.instrumental.parentTrackId,
    );
  };

  const replaceSource = async (role: RouletteSourceRole): Promise<boolean> => {
    if (activeController) return false;
    const stateBeforeCommand = getState();
    if (stateBeforeCommand.transport.status !== 'stopped' || stateBeforeCommand.command.status === 'loading') return false;
    const command = commandForRole(role);
    const { controller, requestId } = begin(command);
    try {
      const state = getState();
      const fixedTrackId = state.sources[oppositeRole(role)].parentTrackId;
      if (!fixedTrackId) throw new RouletteActionFailure(missingReferenceMessage(role), 'none');
      rememberCurrent(state);
      const history = selectionHistory.snapshot();

      const resolved = await matcher.resolveReplacement({
        role,
        fixedTrackId,
        currentTrackId: state.sources[role].parentTrackId,
        recentTrackIds: role === 'vocal' ? history.vocalTrackIds : history.instrumentalTrackIds,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        finishAbort(command, requestId, controller);
        return false;
      }
      if (!resolved) throw new RouletteActionFailure(noCandidateMessage(role), 'none');

      dispatch({
        type: 'stage-source',
        role,
        selection: stagedSelection(resolved.parentTrackId),
        requestId,
      });

      const nextSelection = await prepareResolvedSource(resolved, role, controller.signal);
      dispatch({ type: 'update-source', role, selection: nextSelection, requestId });
      if (controller.signal.aborted) {
        finishAbort(command, requestId, controller);
        return false;
      }
      const nextSources: RoulettePlaybackSources = {
        ...currentPair(state),
        [role]: nextSelection,
      };
      let prepared: RoulettePlaybackResult | void;
      try {
        prepared = await prepareSources(nextSources, controller.signal);
      } catch (error) {
        dispatch({ type: 'restore-sources', sources: state.sources, requestId });
        throw error;
      }
      if (controller.signal.aborted) {
        finishAbort(command, requestId, controller);
        return false;
      }

      dispatch({
        type: 'commit-source',
        role,
        selection: nextSelection,
        requestId,
      });
      commitPreparedSources(prepared);
      selectionHistory.rememberPair(
        nextSources.vocal.parentTrackId,
        nextSources.instrumental.parentTrackId,
      );
      clearController(controller);
      return true;
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        dispatch({ type: 'restore-sources', sources: stateBeforeCommand.sources, requestId });
        finishAbort(command, requestId, controller);
        return false;
      }
      if (isSourceRecoveryRequiredError(error)) {
        dispatch({
          type: 'update-source',
          role: error.role,
          selection: { parentTrackId: error.trackId, stemRef: null, stemStatus: 'failed', window: null },
          requestId,
        });
      } else {
        dispatch({ type: 'restore-sources', sources: stateBeforeCommand.sources, requestId });
      }
      clearController(controller);
      const failure = commandFailure(error, command);
      dispatch({
        type: 'command-failed',
        command,
        requestId,
        error: failure.message,
        recoveryAction: failure.recoveryAction,
      });
      return false;
    }
  };

  const resolveBoth = async (command: 'initialize' | 'replace-both'): Promise<boolean> => {
    if (activeController) return false;
    const stateBeforeCommand = getState();
    if (stateBeforeCommand.transport.status !== 'stopped' || stateBeforeCommand.command.status === 'loading') return false;
    if (
      command === 'initialize'
      && stateBeforeCommand.sources.vocal.parentTrackId
      && stateBeforeCommand.sources.vocal.stemRef
      && stateBeforeCommand.sources.vocal.stemStatus === 'ready'
      && stateBeforeCommand.sources.instrumental.parentTrackId
      && stateBeforeCommand.sources.instrumental.stemRef
      && stateBeforeCommand.sources.instrumental.stemStatus === 'ready'
    ) return true;

    const { controller, requestId } = begin(command);
    try {
      const state = getState();
      rememberCurrent(state);
      const history = selectionHistory.snapshot();
      const resolved = await matcher.resolvePair({
        currentVocalTrackId: state.sources.vocal.parentTrackId,
        currentInstrumentalTrackId: state.sources.instrumental.parentTrackId,
        recentVocalTrackIds: history.vocalTrackIds,
        recentInstrumentalTrackIds: history.instrumentalTrackIds,
        recentPairKeys: history.pairKeys,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        finishAbort(command, requestId, controller);
        return false;
      }
      if (!resolved) {
        throw new RouletteActionFailure(
          command === 'initialize'
            ? 'No compatible Roulette pair is available for initial load.'
            : 'No more compatible sources',
          'none',
        );
      }

      if (resolved.vocal.parentTrackId === resolved.instrumental.parentTrackId) {
        throw new RouletteActionFailure('Roulette could not use a vocal and instrumental from the same track.', 'none');
      }

      dispatch({
        type: 'stage-pair',
        vocal: stagedSelection(resolved.vocal.parentTrackId),
        instrumental: stagedSelection(resolved.instrumental.parentTrackId),
        requestId,
      });

      // Stage 3 intentionally serializes preview separation. Keep the command
      // boundary serial too so cancellation/source-required state stays unambiguous.
      const vocal = await prepareResolvedSource(resolved.vocal, 'vocal', controller.signal);
      dispatch({ type: 'update-source', role: 'vocal', selection: vocal, requestId });
      const instrumental = await prepareResolvedSource(resolved.instrumental, 'instrumental', controller.signal);
      dispatch({ type: 'update-source', role: 'instrumental', selection: instrumental, requestId });
      if (controller.signal.aborted) {
        finishAbort(command, requestId, controller);
        return false;
      }
      if (vocal.parentTrackId === instrumental.parentTrackId) {
        throw new RouletteActionFailure('Roulette could not use a vocal and instrumental from the same track.', 'none');
      }

      const nextSources: RoulettePlaybackSources = { vocal, instrumental };
      let prepared: RoulettePlaybackResult | void;
      try {
        prepared = await prepareSources(nextSources, controller.signal);
      } catch (error) {
        dispatch({ type: 'restore-sources', sources: state.sources, requestId });
        throw error;
      }
      if (controller.signal.aborted) {
        finishAbort(command, requestId, controller);
        return false;
      }

      dispatch({ type: 'commit-pair', vocal, instrumental, requestId });
      commitPreparedSources(prepared);
      selectionHistory.rememberPair(vocal.parentTrackId, instrumental.parentTrackId);
      clearController(controller);
      return true;
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        dispatch({ type: 'restore-sources', sources: stateBeforeCommand.sources, requestId });
        finishAbort(command, requestId, controller);
        return false;
      }
      if (isSourceRecoveryRequiredError(error)) {
        dispatch({
          type: 'update-source',
          role: error.role,
          selection: { parentTrackId: error.trackId, stemRef: null, stemStatus: 'failed', window: null },
          requestId,
        });
        const otherRole = oppositeRole(error.role);
        const otherSource = getState().sources[otherRole];
        if (otherSource.stemStatus === 'preparing') {
          dispatch({
            type: 'update-source',
            role: otherRole,
            selection: { ...otherSource, stemStatus: 'unavailable' },
            requestId,
          });
        }
      } else {
        dispatch({ type: 'restore-sources', sources: stateBeforeCommand.sources, requestId });
      }
      clearController(controller);
      const failure = commandFailure(error, command);
      dispatch({
        type: 'command-failed',
        command,
        requestId,
        error: failure.message,
        recoveryAction: failure.recoveryAction,
      });
      return false;
    }
  };

  return {
    actions: {
      initialize: () => resolveBoth('initialize'),
      replaceSource,
      replaceBoth: () => resolveBoth('replace-both'),
    },
    cancel: () => activeController?.abort(),
  };
}
