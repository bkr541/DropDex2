import {
  type RouletteCommand,
  type RouletteSessionAction,
  type RouletteSessionState,
  type RouletteSourceRole,
  type RouletteSourceSelection,
} from './rouletteSession';
import {
  rouletteMatchingEngine,
  type RouletteMatchingEngine,
  type RouletteResolvedSource,
} from './rouletteMatchingEngine';

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

export function createRouletteActionExecutor({
  getState,
  dispatch,
  matcher = rouletteMatchingEngine,
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

  const finishAbort = (command: RouletteCommand, requestId: string) => {
    dispatch({ type: 'command-finished', command, requestId });
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

      const resolved = await matcher.resolveReplacement({
        role,
        fixedTrackId,
        currentTrackId: state.sources[role].parentTrackId,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        finishAbort(command, requestId);
        return false;
      }
      if (!resolved) throw new Error(noCandidateMessage(role));

      dispatch({
        type: 'commit-source',
        role,
        selection: selectionFor(resolved),
        requestId,
      });
      return true;
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        finishAbort(command, requestId);
        return false;
      }
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
      const resolved = await matcher.resolvePair({
        currentVocalTrackId: state.sources.vocal.parentTrackId,
        currentInstrumentalTrackId: state.sources.instrumental.parentTrackId,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        finishAbort(command, requestId);
        return false;
      }
      if (!resolved) throw new Error('No compatible stem-ready pair found.');

      dispatch({
        type: 'commit-pair',
        vocal: selectionFor(resolved.vocal),
        instrumental: selectionFor(resolved.instrumental),
        requestId,
      });
      return true;
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        finishAbort(command, requestId);
        return false;
      }
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
