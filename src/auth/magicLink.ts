import type { SupabaseClient } from '@supabase/supabase-js';
import { readableAuthError } from './authSessionController';

export type MagicLinkSubmissionResult =
  | { status: 'sent'; notice: null }
  | { status: 'sent'; notice: string }
  | { status: 'error'; message: string };

type MagicLinkAuthClient = Pick<SupabaseClient['auth'], 'signInWithOtp'>;

export async function submitMagicLink(
  auth: MagicLinkAuthClient,
  email: string,
  setSubmitting: (submitting: boolean) => void,
): Promise<MagicLinkSubmissionResult> {
  setSubmitting(true);

  try {
    const { error } = await auth.signInWithOtp({ email: email.trim() });
    if (!error) return { status: 'sent', notice: null };

    if (error.status === 429 || error.message.toLowerCase().includes('rate limit')) {
      return {
        status: 'sent',
        notice: 'A sign-in link was already sent. Check your inbox.',
      };
    }

    return {
      status: 'error',
      message: readableAuthError(error, 'The sign-in link could not be sent.'),
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
