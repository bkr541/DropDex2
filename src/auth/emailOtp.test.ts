import { describe, expect, it, vi } from 'vitest';
import {
  normalizeEmailOtp,
  submitEmailOtp,
  verifyEmailOtp,
} from './emailOtp';

function sendAuthWith(result: unknown) {
  const signInWithOtp = vi.fn().mockImplementation(() => result);
  return { auth: { signInWithOtp } as never, signInWithOtp };
}

function verifyAuthWith(result: unknown) {
  const verifyOtp = vi.fn().mockImplementation(() => result);
  return { auth: { verifyOtp } as never, verifyOtp };
}

describe('email OTP submission', () => {
  it('requests a code for the trimmed email address', async () => {
    const submitting: boolean[] = [];
    const { auth, signInWithOtp } = sendAuthWith(Promise.resolve({ data: {}, error: null }));

    const result = await submitEmailOtp(
      auth,
      ' listener@example.com ',
      (value) => submitting.push(value),
    );

    expect(result).toEqual({ status: 'sent', notice: null });
    expect(signInWithOtp).toHaveBeenCalledWith({ email: 'listener@example.com' });
    expect(submitting).toEqual([true, false]);
  });

  it('returns a readable inline error for a network exception', async () => {
    const submitting: boolean[] = [];
    const { auth } = sendAuthWith(Promise.reject(new Error('Network request failed')));

    const result = await submitEmailOtp(
      auth,
      'listener@example.com',
      (value) => submitting.push(value),
    );

    expect(result).toEqual({
      status: 'error',
      message: 'Could not reach the authentication service. Check your connection and try again.',
    });
    expect(submitting.at(-1)).toBe(false);
  });

  it('keeps the code-entry state for a rate-limited address', async () => {
    const { auth } = sendAuthWith(Promise.resolve({
      data: {},
      error: { message: 'Email rate limit exceeded', status: 429 },
    }));

    const result = await submitEmailOtp(auth, 'listener@example.com', () => undefined);

    expect(result).toEqual({
      status: 'sent',
      notice: 'A verification code was already sent. Check your inbox.',
    });
  });
});

describe('email OTP verification', () => {
  it('normalizes copied codes that contain spaces or punctuation', () => {
    expect(normalizeEmailOtp('115 046-40')).toBe('11504640');
    expect(normalizeEmailOtp('123456789')).toBe('12345678');
  });

  it('rejects incomplete codes before contacting Supabase', async () => {
    const { auth, verifyOtp } = verifyAuthWith(Promise.resolve({ data: {}, error: null }));

    const result = await verifyEmailOtp(
      auth,
      'listener@example.com',
      '1234',
      () => undefined,
    );

    expect(result).toEqual({
      status: 'error',
      message: 'Enter the complete 8-digit verification code.',
    });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('verifies an eight-digit email code inside the current app session', async () => {
    const submitting: boolean[] = [];
    const { auth, verifyOtp } = verifyAuthWith(Promise.resolve({ data: { session: {} }, error: null }));

    const result = await verifyEmailOtp(
      auth,
      ' listener@example.com ',
      '115 046 40',
      (value) => submitting.push(value),
    );

    expect(result).toEqual({ status: 'verified' });
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'listener@example.com',
      token: '11504640',
      type: 'email',
    });
    expect(submitting).toEqual([true, false]);
  });

  it('turns expired-token responses into an actionable message', async () => {
    const { auth } = verifyAuthWith(Promise.resolve({
      data: {},
      error: { message: 'Token has expired or is invalid', status: 403 },
    }));

    const result = await verifyEmailOtp(
      auth,
      'listener@example.com',
      '11504640',
      () => undefined,
    );

    expect(result).toEqual({
      status: 'error',
      message: 'That code is invalid or has expired. Request a new code and try again.',
    });
  });
});
