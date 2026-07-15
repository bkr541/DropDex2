import type { SupabaseClient } from '@supabase/supabase-js';
import { readableAuthError } from './authSessionController';

export const EMAIL_OTP_LENGTH = 8;

export type EmailOtpSubmissionResult =
  | { status: 'sent'; notice: null }
  | { status: 'sent'; notice: string }
  | { status: 'error'; message: string };

export type EmailOtpVerificationResult =
  | { status: 'verified' }
  | { status: 'error'; message: string };

type EmailOtpAuthClient = Pick<
  SupabaseClient['auth'],
  'signInWithOtp' | 'verifyOtp'
>;

export function normalizeEmailOtp(value: string): string {
  return value.replace(/\D/g, '').slice(0, EMAIL_OTP_LENGTH);
}

export async function submitEmailOtp(
  auth: Pick<EmailOtpAuthClient, 'signInWithOtp'>,
  email: string,
  setSubmitting: (submitting: boolean) => void,
): Promise<EmailOtpSubmissionResult> {
  setSubmitting(true);

  try {
    const { error } = await auth.signInWithOtp({ email: email.trim() });
    if (!error) return { status: 'sent', notice: null };

    if (error.status === 429 || error.message.toLowerCase().includes('rate limit')) {
      return {
        status: 'sent',
        notice: 'A verification code was already sent. Check your inbox.',
      };
    }

    return {
      status: 'error',
      message: readableAuthError(error, 'The verification code could not be sent.'),
    };
  } catch (error) {
    return {
      status: 'error',
      message: readableAuthError(
        error,
        'The sign-in request failed. Check your connection and try again.',
      ),
    };
  } finally {
    setSubmitting(false);
  }
}

export async function verifyEmailOtp(
  auth: Pick<EmailOtpAuthClient, 'verifyOtp'>,
  email: string,
  token: string,
  setSubmitting: (submitting: boolean) => void,
): Promise<EmailOtpVerificationResult> {
  const normalizedToken = normalizeEmailOtp(token);
  if (normalizedToken.length !== EMAIL_OTP_LENGTH) {
    return {
      status: 'error',
      message: `Enter the complete ${EMAIL_OTP_LENGTH}-digit verification code.`,
    };
  }

  setSubmitting(true);

  try {
    const { error } = await auth.verifyOtp({
      email: email.trim(),
      token: normalizedToken,
      type: 'email',
    });

    if (!error) return { status: 'verified' };

    const rawMessage = error.message.toLowerCase();
    if (
      rawMessage.includes('expired') ||
      rawMessage.includes('invalid') ||
      rawMessage.includes('token')
    ) {
      return {
        status: 'error',
        message: 'That code is invalid or has expired. Request a new code and try again.',
      };
    }

    if (error.status === 429 || rawMessage.includes('rate limit')) {
      return {
        status: 'error',
        message: 'Too many verification attempts. Wait a moment and try again.',
      };
    }

    return {
      status: 'error',
      message: readableAuthError(error, 'The verification code could not be confirmed.'),
    };
  } catch (error) {
    return {
      status: 'error',
      message: readableAuthError(
        error,
        'The verification request failed. Check your connection and try again.',
      ),
    };
  } finally {
    setSubmitting(false);
  }
}
