import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  Mail,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';
import { useAuthSession } from '../hooks/useAuthSession';
import { submitMagicLink } from '../auth/magicLink';

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
  const [step, setStep] = useState<'email' | 'sent'>('email');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    const result = await submitMagicLink(
      getSupabaseClient().auth,
      email,
      setSending,
    );

    if (result.status === 'error') {
      setError(result.message);
      return;
    }

    setStep('sent');
    setError(result.notice);
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
          <div className="w-10 h-10 brand-gradient rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(207,107,101,0.4)]">
            <div className="w-5 h-5 bg-[var(--color-panel)] rounded-sm rotate-45 flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-primary rounded-full" />
            </div>
          </div>
          <span className="text-2xl font-black tracking-tighter uppercase">
            Drop<span className="text-primary">Dex</span>
          </span>
        </div>

        <AnimatePresence mode="wait">
          {step === 'sent' ? (
            <motion.div
              key="sent"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              className="text-center"
            >
              <div className="w-16 h-16 brand-gradient rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_24px_rgba(207,107,101,0.4)]">
                <Mail size={28} className="text-white" />
              </div>
              <h1 className="text-2xl font-black mb-2">Check your email</h1>
              <p className="text-sm text-muted-foreground mb-2 leading-relaxed">
                We sent a sign-in link to{' '}
                <span className="text-foreground font-bold">{email}</span>.
              </p>
              <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
                Click the link in the email to continue. This tab will sign you in automatically.
              </p>
              {error && <p className="text-amber-400 text-xs mb-4" role="status">{error}</p>}
              <button
                type="button"
                onClick={() => { setStep('email'); setError(null); }}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 mx-auto"
              >
                <RefreshCw size={13} /> Use a different email
              </button>
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
                Enter your email to receive a one-time sign-in link.
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
