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
import { RouletteSelectionHistory } from './rouletteSelectionHistory';

export interface RouletteMatchingActions {
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
  selectionHistory?: RouletteSelectionHistory;
}

function selectionFor(resolved: RouletteResolvedSource): RouletteSourceSelection {
  return {
    parentTrackId: resolved.parentTrackId,
    stemRef: resolved.stemAsset.id,
    stemStatus: 'ready',
  };
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
    ? 'No compatible stem-ready vocal found.'
    : 'No compatible stem-ready instrumental found.';
}

function currentPair(state: RouletteSessionState): RoulettePlaybackSources {
  return {
    vocal: state.sources.vocal,
    instrumental: state.sources.instrumental,
  };
}

export function createRouletteActionExecutor({
  getState,
  dispatch,
  matcher = rouletteMatchingEngine,
  prepareSources = async () => undefined,
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

      const nextSelection = selectionFor(resolved);
      const nextSources: RoulettePlaybackSources = {
        ...currentPair(state),
        [role]: nextSelection,
      };
      await prepareSources(nextSources, controller.signal);
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

  const replaceBoth = async (): Promise<boolean> => {
    const stateBeforeCommand = getState();
    if (stateBeforeCommand.transport.status !== 'stopped' || stateBeforeCommand.command.status === 'loading') return false;
    const command: RouletteCommand = 'replace-both';
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
      if (!resolved) throw new Error('No compatible stem-ready pair found.');

      const nextSources: RoulettePlaybackSources = {
        vocal: selectionFor(resolved.vocal),
        instrumental: selectionFor(resolved.instrumental),
      };
      await prepareSources(nextSources, controller.signal);
      if (controller.signal.aborted) {
        finishAbort(command, requestId, controller);
        return false;
      }

      dispatch({
        type: 'commit-pair',
        vocal: nextSources.vocal,
        instrumental: nextSources.instrumental,
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

  return {
    actions: {
      replaceSource,
      replaceBoth,
    },
    cancel: () => activeController?.abort(),
  };
}
