import { useEffect, useRef, useState } from 'react';
import { openSetLabAutosave, type SetLabRecoveryChoice, type SetLabSaveStatus } from './draftAutosave';
import { createSetLabDraft, type SetLabScope } from './session';
import { reduceSetLabSession, type SetLabAction, type SetLabState } from './sessionReducer';
import { fetchSetLabDraft, saveSetLabDraft } from './sessionRepository';

export type SetLabDispatch = (action: SetLabAction, beforeCommit?: () => void) => boolean;

type Hydration =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; state: SetLabState };

const messageFor = (error: unknown) => error instanceof Error ? error.message : 'Could not open the Set Lab draft.';

export function useSetLabSession({ userId, sourceImportId }: SetLabScope) {
  const [attempt, setAttempt] = useState(0);
  const [hydration, setHydration] = useState<Hydration>({ kind: 'loading' });
  const [saveStatus, setSaveStatus] = useState<SetLabSaveStatus>({ kind: 'idle' });
  const controller = useRef<{ dispatch: SetLabDispatch; retry: () => void; resolveRecovery: (choice: SetLabRecoveryChoice, beforeCommit?: () => void) => void } | null>(null);

  useEffect(() => {
    const scope = { userId, sourceImportId };
    const request = new AbortController();
    let autosave: ReturnType<typeof openSetLabAutosave> | undefined;
    setHydration({ kind: 'loading' });
    setSaveStatus({ kind: 'idle' });

    void fetchSetLabDraft(scope, request.signal).then((confirmed) => {
      if (request.signal.aborted) return;
      const empty = createSetLabDraft(scope);
      // Defer localStorage access to the autosave boundary so a disabled journal
      // surfaces as a save issue while the confirmed draft remains readable.
      autosave = openSetLabAutosave({
        scope, confirmed,
        storage: {
          getItem: (key) => window.localStorage.getItem(key),
          setItem: (key, value) => window.localStorage.setItem(key, value),
          removeItem: (key) => window.localStorage.removeItem(key),
        },
        save: saveSetLabDraft, onStatus: setSaveStatus,
      });
      const writer = autosave;
      let state = reduceSetLabSession({ draft: empty, previous: null }, {
        type: 'restore',
        draft: writer.recovered ?? confirmed?.session ?? empty,
      });
      setHydration({ kind: 'ready', state });
      controller.current = {
        dispatch(action, beforeCommit) {
          const next = reduceSetLabSession(state, action);
          if (next === state) return true;
          if (writer.blocked) return false;
          try {
            writer.enqueue(next.draft);
          } catch (error) {
            setSaveStatus({ kind: 'error', message: messageFor(error) });
            return false;
          }
          // Journal acceptance comes first. Transport teardown and the state
          // replacement then happen in the same synchronous commit.
          try {
            beforeCommit?.();
          } finally {
            state = next;
            setHydration({ kind: 'ready', state });
          }
          return true;
        },
        resolveRecovery(choice, beforeCommit) {
          try {
            const recovered = writer.resolveConflict(choice);
            if (!recovered) return;
            const next = reduceSetLabSession(state, { type: 'restore', draft: recovered });
            try {
              beforeCommit?.();
            } finally {
              state = next;
              setHydration({ kind: 'ready', state });
            }
          } catch (error) {
            setSaveStatus({ kind: 'error', message: messageFor(error) });
          }
        },
        retry() {
          if (writer.blocked) setAttempt((value) => value + 1);
          else void writer.flush();
        },
      };
    }).catch((error: unknown) => {
      if (!request.signal.aborted) setHydration({ kind: 'error', message: messageFor(error) });
    });

    const flush = () => { void autosave?.flush(); };
    const flushWhenHidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      request.abort();
      controller.current = null;
      autosave?.close();
    };
  }, [userId, sourceImportId, attempt]);

  return {
    hydration,
    saveStatus,
    dispatch: (action: SetLabAction, beforeCommit?: () => void) => controller.current?.dispatch(action, beforeCommit) ?? false,
    retryRestore: () => setAttempt((value) => value + 1),
    retrySave: () => controller.current?.retry(),
    resolveRecovery: (choice: SetLabRecoveryChoice, beforeCommit?: () => void) => controller.current?.resolveRecovery(choice, beforeCommit),
  };
}
