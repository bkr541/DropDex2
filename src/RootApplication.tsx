import { StrictMode, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthProvider } from './auth/AuthProvider';
import { AuthGate } from './components/AuthGate';
import { ApplicationErrorBoundary } from './components/errors/ApplicationErrorBoundary';
import { StartupConfigurationError } from './components/StartupConfigurationError';
import { lazyWithRecovery } from './navigation/lazyWithRecovery';
import { supabaseConfiguration } from './lib/supabase';
import { ThemeProvider } from './theme/ThemeProvider';

const App = lazyWithRecovery('application', () => import('./App.tsx'));

function ApplicationLoadingScreen() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background font-sans"
      aria-label="Loading DropDex"
      role="status"
    >
      <div className="text-center">
        <Loader2 className="mx-auto animate-spin text-primary" size={32} />
        <p className="mt-3 text-sm font-bold text-muted-foreground">Loading DropDex…</p>
      </div>
    </div>
  );
}

export function RootApplication() {
  return (
    <StrictMode>
      <ThemeProvider>
        <ApplicationErrorBoundary level="root">
          {supabaseConfiguration.status === 'missing' ? (
            <StartupConfigurationError configuration={supabaseConfiguration} />
          ) : (
            <AuthProvider>
              <AuthGate>
                <Suspense fallback={<ApplicationLoadingScreen />}>
                  <App />
                </Suspense>
              </AuthGate>
            </AuthProvider>
          )}
        </ApplicationErrorBoundary>
      </ThemeProvider>
    </StrictMode>
  );
}
