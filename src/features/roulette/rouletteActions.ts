import {
  type RouletteCommand,
  type RouletteSessionAction,
  type RouletteSessionState,
  type RouletteSourceRole,
  type RouletteSourceSelection,
} from './rouletteSession';
import type { RoulettePlaybackSources } from './rouletteAudioRuntime';
import {
  rouletteMatchingEngine,
  type RouletteMatchingEngine,
  type RouletteResolvedSource,
} from './rouletteMatchingEngine';
import { roulettePreparedAssetRef } from './roulettePreview';
import { roulettePreviewPreparationService } from './roulettePreviewPreparationService';
import { RouletteSelectionHistory } from './rouletteSelectionHistory';

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
  prepareSources?: (sources: RoulettePlaybackSources, signal: AbortSignal) => Promise<void>;
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
    throw new Error('Roulette source metadata is unavailable for preparation.');
  }

  const onAbort = () => { void roulettePreviewPreparationService.cancel(resolved.parentTrackId, role); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const preparation = await roulettePreviewPreparationService.prepare(resolved.track, role);
    if (signal.aborted) throw new DOMException('Roulette replacement cancelled.', 'AbortError');
    if (preparation.status !== 'ready' || !preparation.asset || !preparation.window) {
      throw new Error(preparation.message ?? `Roulette could not prepare the ${role} audition source.`);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function noCandidateMessage(role: RouletteSourceRole): string {
  return role === 'vocal'
    ? 'No compatible vocal candidate found.'
    : 'No compatible instrumental candidate found.';
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
      if (!fixedTrackId) throw new Error(missingReferenceMessage(role));
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
      if (!resolved) throw new Error(noCandidateMessage(role));

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
      try {
        await prepareSources(nextSources, controller.signal);
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
      selectionHistory.rememberPair(
        nextSources.vocal.parentTrackId,
        nextSources.instrumental.parentTrackId,
      );
      clearController(controller);
      return true;
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        finishAbort(command, requestId, controller);
        return false;
      }
      clearController(controller);
      dispatch({ type: 'command-failed', command, requestId, error: errorMessage(error) });
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
        throw new Error(command === 'initialize'
          ? 'No compatible Roulette pair is available for initial load.'
          : 'No fully replaceable compatible Roulette pair found.');
      }

      if (resolved.vocal.parentTrackId === resolved.instrumental.parentTrackId) {
        throw new Error('Roulette rejected a same-parent vocal/instrumental pair.');
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
        throw new Error('Roulette rejected a same-parent vocal/instrumental pair.');
      }

      const nextSources: RoulettePlaybackSources = { vocal, instrumental };
      try {
        await prepareSources(nextSources, controller.signal);
      } catch (error) {
        dispatch({ type: 'restore-sources', sources: state.sources, requestId });
        throw error;
      }
      if (controller.signal.aborted) {
        finishAbort(command, requestId, controller);
        return false;
      }

      dispatch({ type: 'commit-pair', vocal, instrumental, requestId });
      selectionHistory.rememberPair(vocal.parentTrackId, instrumental.parentTrackId);
      clearController(controller);
      return true;
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        finishAbort(command, requestId, controller);
        return false;
      }
      clearController(controller);
      dispatch({ type: 'command-failed', command, requestId, error: errorMessage(error) });
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
