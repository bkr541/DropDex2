import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, ArrowRight, KeyRound, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthSession } from '../hooks/useAuthSession';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuthSession();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background font-sans">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (session) {
    return <>{children}</>;
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setSending(false);
    if (error) {
      setError(error.message);
    } else {
      setStep('otp');
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) return;
    setVerifying(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otp.trim(),
      type: 'email',
    });
    setVerifying(false);
    if (error) {
      setError(error.message);
    }
    // On success, onAuthStateChange fires → session is set → renders children
  };

  return (
    <div className="flex h-screen items-center justify-center bg-background font-sans relative overflow-hidden">
      {/* Background ambience */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="ambience-blob absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 blur-[120px] rounded-full" />
        <div className="ambience-blob absolute bottom-[10%] right-[-10%] w-[50%] h-[50%] bg-secondary/10 blur-[100px] rounded-full" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm px-6"
      >
        {/* Logo */}
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
          {step === 'email' ? (
            <motion.div
              key="email"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
            >
              <h1 className="text-2xl font-black mb-1">Sign In</h1>
              <p className="text-sm text-muted-foreground mb-8">
                Enter your email to receive a one-time code.
              </p>
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div className="relative">
                  <Mail
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                    size={16}
                  />
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    className="w-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-xl py-3.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all text-foreground placeholder:text-muted-foreground text-sm"
                  />
                </div>
                {error && <p className="text-red-400 text-xs">{error}</p>}
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
          ) : (
            <motion.div
              key="otp"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
            >
              <h1 className="text-2xl font-black mb-1">Check your email</h1>
              <p className="text-sm text-muted-foreground mb-8">
                We sent a code to{' '}
                <span className="text-foreground font-bold">{email}</span>.
                Enter it below, or click the magic link in the email.
              </p>
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="relative">
                  <KeyRound
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                    size={16}
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="6-digit code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    maxLength={6}
                    required
                    autoFocus
                    className="w-full bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-xl py-3.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all text-foreground placeholder:text-muted-foreground text-sm font-mono tracking-widest"
                  />
                </div>
                {error && <p className="text-red-400 text-xs">{error}</p>}
                <button
                  type="submit"
                  disabled={verifying}
                  className="w-full py-3.5 brand-gradient text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity active:scale-95"
                >
                  {verifying ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <KeyRound size={16} />
                  )}
                  {verifying ? 'Verifying…' : 'Verify Code'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('email');
                    setError(null);
                    setOtp('');
                  }}
                  className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
                >
                  Use a different email
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
