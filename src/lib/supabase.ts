import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type SupabaseConfiguration =
  | {
      status: 'configured';
      url: string;
      key: string;
      keyVariable: 'VITE_SUPABASE_PUBLISHABLE_KEY' | 'VITE_SUPABASE_ANON_KEY';
      missingVariables: [];
    }
  | {
      status: 'missing';
      missingVariables: Array<'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'>;
    };

type PublicEnvironment = Record<string, string | boolean | undefined>;
type SupabaseClientFactory = (url: string, key: string) => SupabaseClient;

export function resolveSupabaseConfiguration(env: PublicEnvironment): SupabaseConfiguration {
  const url = typeof env.VITE_SUPABASE_URL === 'string'
    ? env.VITE_SUPABASE_URL.trim()
    : '';
  const publishableKey = typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === 'string'
    ? env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
    : '';
  const anonymousKey = typeof env.VITE_SUPABASE_ANON_KEY === 'string'
    ? env.VITE_SUPABASE_ANON_KEY.trim()
    : '';
  const key = publishableKey || anonymousKey;
  const missingVariables: Array<'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'> = [];

  if (!url) missingVariables.push('VITE_SUPABASE_URL');
  if (!key) missingVariables.push('VITE_SUPABASE_ANON_KEY');

  if (missingVariables.length > 0) {
    return { status: 'missing', missingVariables };
  }

  return {
    status: 'configured',
    url,
    key,
    keyVariable: publishableKey
      ? 'VITE_SUPABASE_PUBLISHABLE_KEY'
      : 'VITE_SUPABASE_ANON_KEY',
    missingVariables: [],
  };
}

export function createConfiguredSupabaseClient(
  configuration: SupabaseConfiguration,
  factory: SupabaseClientFactory = createClient,
): SupabaseClient | null {
  if (configuration.status !== 'configured') return null;
  return factory(configuration.url, configuration.key);
}

export const supabaseConfiguration = resolveSupabaseConfiguration(
  import.meta.env as PublicEnvironment,
);

const configuredClient = createConfiguredSupabaseClient(supabaseConfiguration);

export function getSupabaseClient(): SupabaseClient {
  if (!configuredClient) {
    throw new Error(
      `[DropDex] Supabase configuration is missing: ${supabaseConfiguration.missingVariables.join(', ')}`,
    );
  }
  return configuredClient;
}

/**
 * Backwards-compatible lazy client surface for existing query modules.
 * Importing this module is safe when configuration is missing; the client is
 * only required when a property is actually used after the startup gate.
 */
const missingConfigurationClient = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    throw new Error(
      `[DropDex] Supabase client access attempted before configuration was available (${String(property)}).`,
    );
  },
});

export const supabase: SupabaseClient = configuredClient ?? missingConfigurationClient;
