import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { SupabaseConfiguration } from '../lib/supabase';

interface StartupConfigurationErrorProps {
  configuration: Extract<SupabaseConfiguration, { status: 'missing' }>;
}

export function StartupConfigurationError({ configuration }: StartupConfigurationErrorProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 font-sans">
      <section
        aria-labelledby="startup-configuration-title"
        className="w-full max-w-lg rounded-2xl border border-red-400/30 bg-[var(--color-panel)] p-7 shadow-2xl"
      >
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/15 text-red-400">
          <AlertTriangle size={24} aria-hidden="true" />
        </div>
        <h1 id="startup-configuration-title" className="text-2xl font-black">
          DropDex configuration is incomplete
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Authentication cannot start until the following public Supabase environment variables are configured:
        </p>
        <ul className="mt-4 space-y-2" aria-label="Missing environment variables">
          {configuration.missingVariables.map((variable) => (
            <li
              key={variable}
              className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
            >
              {variable}
            </li>
          ))}
        </ul>
        {configuration.missingVariables.includes('VITE_SUPABASE_ANON_KEY') && (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            VITE_SUPABASE_PUBLISHABLE_KEY is also accepted as the public client key. Never place a service-role or secret key in a VITE_-prefixed variable.
          </p>
        )}
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
          Add the variables to the deployment environment or local .env file, then reload the application. No configured values are displayed on this screen.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
        >
          <RefreshCw size={15} aria-hidden="true" />
          Reload after configuration
        </button>
      </section>
    </main>
  );
}
