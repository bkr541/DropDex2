import type { SupabaseClient } from '@supabase/supabase-js';
import { readableAuthError } from './authSessionController';
import { logger } from '../lib/logger';

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

export const UNKNOWN_EMAIL_MESSAGE =
  "We couldn't find an account for that email address. Check the spelling, or use the email you signed up with.";

/** Supabase refuses to send a code to an email with no user when sign-ups through email codes are off. */
function isUnknownUserError(error: { message: string; status?: number }): boolean {
  const code = (error as { code?: string }).code;
  const message = error.message.toLowerCase();
  return code === 'otp_disabled'
    || code === 'user_not_found'
    || message.includes('signups not allowed')
    || message.includes('user not found');
}

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
    // shouldCreateUser: false makes Supabase check that the email belongs to an existing user *before*
    // sending anything. For an unknown email it sends no email and returns an error instead.
    const { error } = await auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });
    if (!error) {
      logger.info('auth.otp.sent', { email: email.trim() });
      return { status: 'sent', notice: null };
    }

    if (isUnknownUserError(error)) {
      logger.warn('auth.otp.unknown_email', {
        email: email.trim(),
        status: error.status,
        code: (error as { code?: string }).code,
        message: error.message,
      });
      return { status: 'error', message: UNKNOWN_EMAIL_MESSAGE };
    }

    if (error.status === 429 || error.message.toLowerCase().includes('rate limit')) {
      return {
        status: 'sent',
        notice: 'A verification code was already sent. Check your inbox.',
      };
    }

    logger.error('auth.otp.send_failed', { email: email.trim(), status: error.status, message: error.message });
    return {
      status: 'error',
      message: readableAuthError(error, 'The verification code could not be sent.'),
    };
  } catch (error) {
    logger.error('auth.otp.send_exception', { email: email.trim(), message: error instanceof Error ? error.message : String(error) });
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
