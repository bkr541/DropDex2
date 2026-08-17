import { StrictMode, Suspense } from 'react';
import { AuthProvider } from './auth/AuthProvider';
import { AuthGate } from './components/AuthGate';
import { ApplicationErrorBoundary } from './components/errors/ApplicationErrorBoundary';
import { StartupConfigurationError } from './components/StartupConfigurationError';
import { lazyWithRecovery } from './navigation/lazyWithRecovery';
import { supabaseConfiguration } from './lib/supabase';
import { ThemeProvider } from './theme/ThemeProvider';
import { CircleDash } from '@carbon/icons-react';

const App = lazyWithRecovery('application', () => import('./App.tsx'));

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
