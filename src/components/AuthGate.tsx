import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { getSupabaseClient } from '../lib/supabase';
import { useAuthSession } from '../hooks/useAuthSession';
import {
  EMAIL_OTP_LENGTH,
  normalizeEmailOtp,
  submitEmailOtp,
  verifyEmailOtp,
} from '../auth/emailOtp';
import { ArrowLeft, ArrowRight, CheckmarkFilled, CircleDash, Email, Renew, TrashCan, WarningAlt } from '@carbon/icons-react';
import { ControlButton } from './ui/controls';

function AuthenticationFailure({
  error,
  retry,
  clearSession,
}: {
  error: string;
  retry: () => Promise<void>;
  clearSession: () => Promise<void>;
}) {
  const [recovering, setRecovering] = useState<'retry' | 'clear' | null>(null);

  const runRecovery = async (action: 'retry' | 'clear') => {
    setRecovering(action);
    try {
      if (action === 'retry') await retry();
      else await clearSession();
    } finally {
      setRecovering(null);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 font-sans">
      <section
        aria-labelledby="authentication-failure-title"
        className="w-full max-w-md rounded-2xl border border-red-400/30 bg-[var(--color-panel)] p-7 text-center shadow-2xl"
      >
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-red-400">
          <WarningAlt size={26} aria-hidden="true" />
        </div>
        <h1 id="authentication-failure-title" className="text-2xl font-black">
          Sign-in could not be initialized
        </h1>
        <p role="alert" className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Retry the session check, or clear the local session and return to the sign-in screen if the saved session is damaged.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <ControlButton type="button" variant="primary" disabled={recovering !== null} onClick={() => void runRecovery('retry')}>
            {recovering === 'retry' ? <CircleDash size={15} className="animate-spin" /> : <Renew size={15} />}
            Retry
          </ControlButton>
          <ControlButton type="button" variant="neutral" disabled={recovering !== null} onClick={() => void runRecovery('clear')}>
            {recovering === 'clear' ? <CircleDash size={15} className="animate-spin" /> : <TrashCan size={15} />}
            Clear session
          </ControlButton>
        </div>
      </section>
    </main>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuthSession();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'verify'>('email');
  const [otp, setOtp] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 'verify' || resendSeconds <= 0) return undefined;

    const timer = window.setTimeout(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1_000);

    return () => window.clearTimeout(timer);
  }, [step, resendSeconds]);

  if (auth.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-background font-sans" aria-label="Loading authentication">
        <CircleDash className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (auth.status === 'error') {
    return (
      <AuthenticationFailure
        error={auth.error}
        retry={auth.retry}
        clearSession={auth.clearSession}
      />
    );
  }

  if (auth.status === 'authenticated') {
    return <>{children}</>;
  }

  const handleSendOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setNotice(null);

    const result = await submitEmailOtp(
      getSupabaseClient().auth,
      email,
      setSending,
    );

    if (result.status === 'error') {
      setError(result.message);
      return;
    }

    setStep('verify');
    setOtp('');
    setResendSeconds(60);
    setNotice(result.notice);
  };

  const handleVerifyOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const result = await verifyEmailOtp(
      getSupabaseClient().auth,
      email,
      otp,
      setVerifying,
    );

    if (result.status === 'error') {
      setError(result.message);
      return;
    }

    setNotice('Code accepted. Signing you in…');
  };

  const handleResendOtp = async () => {
    if (sending || resendSeconds > 0) return;
    setError(null);
    setNotice(null);

    const result = await submitEmailOtp(
      getSupabaseClient().auth,
      email,
      setSending,
    );

    if (result.status === 'error') {
      setError(result.message);
      return;
    }

    setOtp('');
    setResendSeconds(60);
    setNotice(result.notice ?? 'A new verification code was sent.');
  };

  const handleChangeEmail = () => {
    setStep('email');
    setOtp('');
    setResendSeconds(0);
    setError(null);
    setNotice(null);
  };

  return (
    <div className="flex h-screen items-center justify-center bg-background font-sans relative overflow-hidden">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="ambience-blob absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 blur-[120px] rounded-full" />
        <div className="ambience-blob absolute bottom-[10%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 blur-[100px] rounded-full" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm px-6"
      >
        <div className="flex items-center gap-3 mb-10 justify-center">
          <div className="w-10 h-10 brand-gradient rounded-xl flex items-center justify-center shadow-brand-icon">
            <div className="w-5 h-5 bg-[var(--color-panel)] rounded-sm rotate-45 flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-[var(--color-brand-primary)] rounded-full" />
            </div>
          </div>
          <span className="text-2xl font-black tracking-tighter uppercase">
            Drop<span className="text-[var(--color-brand-primary)]">Dex</span>
          </span>
        </div>

        <AnimatePresence mode="wait">
          {step === 'verify' ? (
            <motion.div
              key="verify"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              className="text-center"
            >
              <div className="w-16 h-16 brand-gradient rounded-full flex items-center justify-center mx-auto mb-6 shadow-brand-hero">
                <Email size={28} className="text-white" />
              </div>
              <h1 className="text-2xl font-bold mb-2">Enter your sign-in code</h1>
              <p className="text-sm text-muted-foreground mb-7 leading-relaxed">
                We sent an {EMAIL_OTP_LENGTH}-digit verification code to{' '}
                <span className="text-foreground font-bold">{email}</span>.
              </p>

              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-label={`${EMAIL_OTP_LENGTH}-digit verification code`}
                  placeholder="00000000"
                  value={otp}
                  onChange={(event) => setOtp(normalizeEmailOtp(event.target.value))}
                  autoFocus
                  className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-4 text-center text-2xl font-black tracking-[0.35em] text-foreground placeholder:text-muted-foreground/35 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />

                {error && (
                  <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
                    {error}
                  </p>
                )}
                {notice && (
                  <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300" role="status">
                    {notice}
                  </p>
                )}

                <ControlButton type="submit" variant="primary" disabled={verifying || otp.length !== EMAIL_OTP_LENGTH} className="w-full">
                  {verifying ? <CircleDash size={16} className="animate-spin" /> : <CheckmarkFilled size={16} />}
                  {verifying ? 'Verifying…' : 'Verify and sign in'}
                </ControlButton>
              </form>

              <div className="mt-6 flex flex-col items-center gap-3 text-sm">
                <ControlButton type="button" variant="ghost" disabled={sending || resendSeconds > 0} onClick={() => void handleResendOtp()}>
                  {sending ? <CircleDash size={13} className="animate-spin" /> : <Renew size={13} />}
                  {sending ? 'Sending…' : resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : 'Resend code'}
                </ControlButton>
                <ControlButton type="button" variant="ghost" onClick={handleChangeEmail}>
                  <ArrowLeft size={13} /> Use a different email
                </ControlButton>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="email"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
            >
              <h1 className="text-2xl font-bold mb-1">Sign In</h1>
              <p className="text-sm text-muted-foreground mb-8">
                Enter your email to receive a one-time verification code.
              </p>
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div className="relative">
                  <Email
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                    size={16}
                  />
                  <input
                    type="email"
                    aria-label="Email address"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    autoFocus
                    className="w-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-xl py-3.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all text-foreground placeholder:text-muted-foreground text-sm"
                  />
                </div>
                {error && <p className="text-red-400 text-xs" role="alert">{error}</p>}
                <div className="flex justify-center">
                  <ControlButton
                    type="submit"
                    variant="primary"
                    disabled={sending}
                    style={{ borderColor: '#cf6b65', color: '#cf6b65', background: 'transparent' }}
                  >
                    {sending ? <CircleDash size={16} className="animate-spin" /> : (
                      <svg viewBox="0 0 330.002 330.002" width="16" height="16" fill="currentColor" aria-hidden="true">
                        <path d="M169.392,199.395c-5.858,5.857-5.858,15.355,0,21.213c2.929,2.929,6.767,4.394,10.607,4.394c3.838,0,7.678-1.465,10.606-4.394l44.998-44.997c0.347-0.347,0.676-0.712,0.988-1.091c0.069-0.084,0.128-0.176,0.196-0.262c0.235-0.299,0.467-0.6,0.68-0.917c0.055-0.083,0.101-0.171,0.154-0.254c0.211-0.329,0.418-0.662,0.603-1.007c0.032-0.06,0.057-0.123,0.088-0.184c0.194-0.374,0.378-0.753,0.541-1.145c0.017-0.04,0.028-0.081,0.044-0.121c0.167-0.411,0.32-0.829,0.45-1.258c0.014-0.046,0.022-0.094,0.036-0.14c0.123-0.419,0.235-0.844,0.321-1.278c0.024-0.121,0.035-0.245,0.056-0.367c0.063-0.36,0.125-0.72,0.162-1.088c0.05-0.496,0.076-0.995,0.076-1.497c0-0.503-0.026-1.002-0.076-1.497c-0.037-0.371-0.1-0.734-0.164-1.097c-0.021-0.119-0.031-0.24-0.055-0.358c-0.087-0.437-0.199-0.864-0.323-1.286c-0.013-0.044-0.02-0.088-0.034-0.132c-0.131-0.432-0.286-0.852-0.454-1.267c-0.015-0.036-0.025-0.075-0.041-0.111c-0.164-0.394-0.349-0.776-0.544-1.152c-0.03-0.058-0.054-0.119-0.085-0.176c-0.187-0.348-0.394-0.682-0.606-1.013c-0.053-0.082-0.097-0.168-0.151-0.249c-0.213-0.317-0.445-0.62-0.681-0.919c-0.067-0.086-0.126-0.177-0.195-0.261c-0.312-0.379-0.641-0.744-0.988-1.091l-44.998-44.998c-5.857-5.858-15.355-5.858-21.213,0c-5.858,5.858-5.858,15.355,0,21.213l19.393,19.394H15c-8.284,0-15,6.716-15,15s6.716,15,15,15h173.785L169.392,199.395z"/>
                        <path d="M207.301,42.3c-40.945,0-79.04,20.312-101.903,54.333c-4.621,6.876-2.793,16.196,4.083,20.816c6.876,4.621,16.196,2.793,20.816-4.083C147.578,87.652,176.365,72.3,207.301,72.3c51.116,0,92.701,41.586,92.701,92.701s-41.586,92.701-92.701,92.701c-30.844,0-59.585-15.283-76.879-40.882c-4.638-6.864-13.962-8.67-20.827-4.032c-6.864,4.638-8.67,13.962-4.032,20.827c22.882,33.868,60.915,54.087,101.738,54.087c67.658,0,122.701-55.044,122.701-122.701S274.958,42.3,207.301,42.3z"/>
                      </svg>
                    )}
                    {sending ? 'Sending…' : 'Continue'}
                  </ControlButton>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
