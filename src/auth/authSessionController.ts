import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';

export type AuthSessionState =
  | { status: 'loading'; session: null; error: null }
  | { status: 'authenticated'; session: Session; error: null }
  | { status: 'anonymous'; session: null; error: null }
  | { status: 'error'; session: null; error: string };

export interface AuthSessionController {
  getState(): AuthSessionState;
  subscribe(listener: (state: AuthSessionState) => void): () => void;
  start(): void;
  retry(): Promise<void>;
  clearSession(): Promise<void>;
  dispose(): void;
}

type AuthClient = Pick<SupabaseClient['auth'], 'getSession' | 'onAuthStateChange' | 'signOut'>;

export function readableAuthError(
  error: unknown,
  fallback = 'Authentication could not be initialized. Please try again.',
): string {
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : null;

  if (rawMessage?.trim()) {
    if (/failed to fetch|network request failed|networkerror|load failed/i.test(rawMessage)) {
      return 'Could not reach the authentication service. Check your connection and try again.';
    }
    return rawMessage;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      if (/failed to fetch|network request failed|networkerror|load failed/i.test(message)) {
        return 'Could not reach the authentication service. Check your connection and try again.';
      }
      return message;
    }
  }
  return fallback;
}

export function createAuthSessionController(auth: AuthClient): AuthSessionController {
  let state: AuthSessionState = { status: 'loading', session: null, error: null };
  let started = false;
  let disposed = false;
  let requestGeneration = 0;
  let authEventGeneration = 0;
  let unsubscribeAuth: (() => void) | null = null;
  const listeners = new Set<(nextState: AuthSessionState) => void>();

  const publish = (nextState: AuthSessionState) => {
    if (disposed) return;
    state = nextState;
    listeners.forEach((listener) => listener(nextState));
  };

  const initialize = async () => {
    const currentRequest = ++requestGeneration;
    const eventGenerationAtStart = authEventGeneration;
    publish({ status: 'loading', session: null, error: null });

    try {
      const response = await auth.getSession();
      if (
        disposed ||
        currentRequest !== requestGeneration ||
        eventGenerationAtStart !== authEventGeneration
      ) {
        return;
      }

      if (response.error) throw response.error;
      const session = response.data.session;
      publish(session
        ? { status: 'authenticated', session, error: null }
        : { status: 'anonymous', session: null, error: null });
    } catch (error) {
      if (
        disposed ||
        currentRequest !== requestGeneration ||
        eventGenerationAtStart !== authEventGeneration
      ) {
        return;
      }
      publish({ status: 'error', session: null, error: readableAuthError(error) });
    }
  };

  return {
    getState: () => state,

    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start() {
      if (started || disposed) return;
      started = true;

      const { data } = auth.onAuthStateChange(
        (_event: AuthChangeEvent, session: Session | null) => {
          if (disposed) return;
          authEventGeneration += 1;
          requestGeneration += 1;
          publish(session
            ? { status: 'authenticated', session, error: null }
            : { status: 'anonymous', session: null, error: null });
        },
      );
      unsubscribeAuth = () => data.subscription.unsubscribe();
      void initialize();
    },

    retry: initialize,

    async clearSession() {
      requestGeneration += 1;
      publish({ status: 'loading', session: null, error: null });

      try {
        const { error } = await auth.signOut({ scope: 'local' });
        if (error) throw error;
        if (!disposed) {
          authEventGeneration += 1;
          publish({ status: 'anonymous', session: null, error: null });
        }
      } catch (error) {
        if (!disposed) {
          publish({
            status: 'error',
            session: null,
            error: readableAuthError(error, 'The local session could not be cleared.'),
          });
        }
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      requestGeneration += 1;
      unsubscribeAuth?.();
      unsubscribeAuth = null;
      listeners.clear();
    },
  };
}
