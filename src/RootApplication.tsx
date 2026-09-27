import { StrictMode, Suspense, useEffect } from 'react';
import { AuthProvider } from './auth/AuthProvider';
import { AuthGate } from './components/AuthGate';
import { ApplicationErrorBoundary } from './components/errors/ApplicationErrorBoundary';
import { StartupConfigurationError } from './components/StartupConfigurationError';
import { lazyWithRecovery } from './navigation/lazyWithRecovery';
import { supabaseConfiguration } from './lib/supabase';
import { ThemeProvider } from './theme/ThemeProvider';
import { CircleDash } from '@carbon/icons-react';
import { logger } from './lib/logger';

const App = lazyWithRecovery('application', () => import('./App.tsx'));

function GlobalErrorCatchers() {
  useEffect(() => {
    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      logger.error('window.unhandledrejection', {
        reason: String(event.reason),
        stack: event.reason instanceof Error ? event.reason.stack : undefined,
      });
    }
    function handleError(event: ErrorEvent) {
      logger.error('window.error', {
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        col: event.colno,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    }
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
    };
  }, []);
  return null;
}

function ApplicationLoadingScreen() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background font-sans"
      aria-label="Loading DropDex"
      role="status"
    >
      <div className="text-center">
        <CircleDash className="mx-auto animate-spin text-primary" size={32} />
        <p className="mt-3 text-sm font-bold text-muted-foreground">Loading DropDex…</p>
      </div>
    </div>
  );
}

export function RootApplication() {
  return (
    <StrictMode>
      <GlobalErrorCatchers />
      <ApplicationErrorBoundary level="root">
        {supabaseConfiguration.status === 'missing' ? (
          <StartupConfigurationError configuration={supabaseConfiguration} />
        ) : (
          <AuthProvider>
            <ThemeProvider>
              <AuthGate>
                <Suspense fallback={<ApplicationLoadingScreen />}>
                  <App />
                </Suspense>
              </AuthGate>
            </ThemeProvider>
          </AuthProvider>
        )}
      </ApplicationErrorBoundary>
    </StrictMode>
  );
}
