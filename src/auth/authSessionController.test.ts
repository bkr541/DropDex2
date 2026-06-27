import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { createAuthSessionController, type AuthSessionState } from './authSessionController';

const authenticatedSession = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'user-1', email: 'listener@example.com' },
} as Session;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeAuth(initialResponse: unknown) {
  const unsubscribe = vi.fn();
  let authCallback: ((event: string, session: Session | null) => void) | null = null;
  const getSession = vi.fn().mockImplementation(() => initialResponse);
  const onAuthStateChange = vi.fn((callback) => {
    authCallback = callback;
    return { data: { subscription: { unsubscribe } } };
  });
  const signOut = vi.fn().mockResolvedValue({ error: null });

  return {
    auth: { getSession, onAuthStateChange, signOut } as never,
    getSession,
    onAuthStateChange,
    signOut,
    unsubscribe,
    emit(session: Session | null) {
      authCallback?.('SIGNED_IN', session);
    },
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('auth session controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reaches authenticated after successful initialization', async () => {
    const mock = makeAuth(Promise.resolve({ data: { session: authenticatedSession }, error: null }));
    const controller = createAuthSessionController(mock.auth);

    controller.start();
    await settle();

    expect(controller.getState()).toEqual({
      status: 'authenticated',
      session: authenticatedSession,
      error: null,
    });
  });

  it('reaches anonymous after successful initialization without a session', async () => {
    const mock = makeAuth(Promise.resolve({ data: { session: null }, error: null }));
    const controller = createAuthSessionController(mock.auth);

    controller.start();
    await settle();

    expect(controller.getState()).toEqual({ status: 'anonymous', session: null, error: null });
  });

  it('reaches error when getSession rejects instead of remaining loading', async () => {
    const mock = makeAuth(Promise.reject(new Error('session endpoint offline')));
    const controller = createAuthSessionController(mock.auth);

    controller.start();
    await settle();

    expect(controller.getState()).toEqual({
      status: 'error',
      session: null,
      error: 'session endpoint offline',
    });
  });

  it('can retry initialization after a failure', async () => {
    const mock = makeAuth(Promise.reject(new Error('temporary outage')));
    const controller = createAuthSessionController(mock.auth);
    controller.start();
    await settle();
    expect(controller.getState().status).toBe('error');

    mock.getSession.mockResolvedValueOnce({ data: { session: authenticatedSession }, error: null });
    await controller.retry();

    expect(controller.getState().status).toBe('authenticated');
    expect(mock.getSession).toHaveBeenCalledTimes(2);
  });

  it('creates one session request and one auth subscription during normal mounting', async () => {
    const mock = makeAuth(Promise.resolve({ data: { session: null }, error: null }));
    const controller = createAuthSessionController(mock.auth);

    controller.start();
    controller.start();
    await settle();

    expect(mock.getSession).toHaveBeenCalledTimes(1);
    expect(mock.onAuthStateChange).toHaveBeenCalledTimes(1);
  });

  it('uses auth-state events to update the shared session', async () => {
    const pending = deferred<{ data: { session: Session | null }; error: null }>();
    const mock = makeAuth(pending.promise);
    const controller = createAuthSessionController(mock.auth);
    controller.start();

    mock.emit(authenticatedSession);
    pending.resolve({ data: { session: null }, error: null });
    await settle();

    expect(controller.getState().status).toBe('authenticated');
  });

  it('cleans up the auth subscription after unmount', () => {
    const mock = makeAuth(new Promise(() => undefined));
    const controller = createAuthSessionController(mock.auth);

    controller.start();
    controller.dispose();
    controller.dispose();

    expect(mock.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not publish a stale initialization result after disposal', async () => {
    const pending = deferred<{ data: { session: Session | null }; error: null }>();
    const mock = makeAuth(pending.promise);
    const controller = createAuthSessionController(mock.auth);
    const states: AuthSessionState[] = [];
    controller.subscribe((state) => states.push(state));

    controller.start();
    const updatesBeforeDisposal = states.length;
    controller.dispose();
    pending.resolve({ data: { session: authenticatedSession }, error: null });
    await settle();

    expect(states).toHaveLength(updatesBeforeDisposal);
  });
});
