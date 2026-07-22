import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Mail,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';
import { useAuthSession } from '../hooks/useAuthSession';
import {
  EMAIL_OTP_LENGTH,
  normalizeEmailOtp,
  submitEmailOtp,
  verifyEmailOtp,
} from '../auth/emailOtp';

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
          <AlertTriangle size={26} aria-hidden="true" />
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
          <button
            type="button"
            disabled={recovering !== null}
            onClick={() => void runRecovery('retry')}
            className="inline-flex items-center justify-center gap-2 rounded-xl brand-gradient px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {recovering === 'retry' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Retry
          </button>
          <button
            type="button"
            disabled={recovering !== null}
            onClick={() => void runRecovery('clear')}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 text-sm font-bold disabled:opacity-50"
          >
            {recovering === 'clear' ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            Clear session
          </button>
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
        <Loader2 className="animate-spin text-primary" size={32} />
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
                <Mail size={28} className="text-white" />
              </div>
              <h1 className="text-2xl font-black mb-2">Enter your sign-in code</h1>
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

                <button
                  type="submit"
                  disabled={verifying || otp.length !== EMAIL_OTP_LENGTH}
                  className="w-full py-3.5 brand-gradient text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity active:scale-95"
                >
                  {verifying ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={16} />
                  )}
                  {verifying ? 'Verifying…' : 'Verify and sign in'}
                </button>
              </form>

              <div className="mt-6 flex flex-col items-center gap-3 text-sm">
                <button
                  type="button"
                  disabled={sending || resendSeconds > 0}
                  onClick={() => void handleResendOtp()}
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  {sending
                    ? 'Sending…'
                    : resendSeconds > 0
                      ? `Resend code in ${resendSeconds}s`
                      : 'Resend code'}
                </button>
                <button
                  type="button"
                  onClick={handleChangeEmail}
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft size={13} /> Use a different email
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="email"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
            >
              <h1 className="text-2xl font-black mb-1">Sign In</h1>
              <p className="text-sm text-muted-foreground mb-8">
                Enter your email to receive a one-time verification code.
              </p>
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div className="relative">
                  <Mail
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
                <button
                  type="submit"
                  disabled={sending}
                  className="w-full py-3.5 brand-gradient text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity active:scale-95"
                >
                  {sending ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ArrowRight size={16} />
                  )}
                  {sending ? 'Sending…' : 'Continue'}
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
