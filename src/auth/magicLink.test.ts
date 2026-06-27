import { describe, expect, it, vi } from 'vitest';
import { submitMagicLink } from './magicLink';

function authWith(result: unknown) {
  return {
    signInWithOtp: vi.fn().mockImplementation(() => result),
  } as never;
}

describe('magic-link submission', () => {
  it('preserves the successful check-your-email result', async () => {
    const submitting: boolean[] = [];
    const auth = authWith(Promise.resolve({ data: {}, error: null }));

    const result = await submitMagicLink(auth, ' listener@example.com ', (value) => submitting.push(value));

    expect(result).toEqual({ status: 'sent', notice: null });
    expect(submitting).toEqual([true, false]);
  });

  it('returns a readable inline error for a network exception', async () => {
    const submitting: boolean[] = [];
    const auth = authWith(Promise.reject(new Error('Network request failed')));

    const result = await submitMagicLink(auth, 'listener@example.com', (value) => submitting.push(value));

    expect(result).toEqual({
      status: 'error',
      message: 'Could not reach the authentication service. Check your connection and try again.',
    });
    expect(submitting.at(-1)).toBe(false);
  });

  it('returns a readable inline error for a Supabase error response', async () => {
    const submitting: boolean[] = [];
    const auth = authWith(Promise.resolve({
      data: {},
      error: { message: 'Email provider is unavailable', status: 503 },
    }));

    const result = await submitMagicLink(auth, 'listener@example.com', (value) => submitting.push(value));

    expect(result).toEqual({ status: 'error', message: 'Email provider is unavailable' });
    expect(submitting.at(-1)).toBe(false);
  });

  it('always re-enables the submit button after failure', async () => {
    let submitting = false;
    const auth = authWith(Promise.reject(new Error('offline')));

    const request = submitMagicLink(auth, 'listener@example.com', (value) => {
      submitting = value;
    });
    expect(submitting).toBe(true);

    await request;
    expect(submitting).toBe(false);
  });

  it('keeps the sent state for a rate-limited address', async () => {
    const auth = authWith(Promise.resolve({
      data: {},
      error: { message: 'Email rate limit exceeded', status: 429 },
    }));

    const result = await submitMagicLink(auth, 'listener@example.com', () => undefined);

    expect(result).toEqual({
      status: 'sent',
      notice: 'A sign-in link was already sent. Check your inbox.',
    });
  });
});
