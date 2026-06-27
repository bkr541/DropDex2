import { lazy, StrictMode, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthProvider } from './auth/AuthProvider';
import { AuthGate } from './components/AuthGate';
import { StartupConfigurationError } from './components/StartupConfigurationError';
import { supabaseConfiguration } from './lib/supabase';

const App = lazy(() => import('./App.tsx'));

function ApplicationLoadingScreen() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background font-sans"
      aria-label="Loading DropDex"
    >
      <Loader2 className="animate-spin text-primary" size={32} />
    </div>
  );
}

export function RootApplication() {
  if (supabaseConfiguration.status === 'missing') {
    return (
      <StrictMode>
        <StartupConfigurationError configuration={supabaseConfiguration} />
      </StrictMode>
    );
  }

  return (
    <AuthProvider>
      <StrictMode>
        <AuthGate>
          <Suspense fallback={<ApplicationLoadingScreen />}>
            <App />
          </Suspense>
        </AuthGate>
      </StrictMode>
    </AuthProvider>
  );
}
