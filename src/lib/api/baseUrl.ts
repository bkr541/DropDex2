type ImportApiEnvironment = {
  DEV?: boolean;
  PROD?: boolean;
  VITE_IMPORT_API_URL?: string;
};

const DEVELOPMENT_IMPORT_API_URL = 'http://127.0.0.1:8000';

/**
 * Resolve the FastAPI backend URL without allowing a production build to
 * quietly point at the end user's localhost.
 */
export function resolveImportApiBase(env: ImportApiEnvironment): string {
  const configured = typeof env.VITE_IMPORT_API_URL === 'string'
    ? env.VITE_IMPORT_API_URL.trim()
    : '';

  if (configured) return configured.replace(/\/+$/, '');

  if (env.PROD || env.DEV === false) {
    throw new Error(
      '[DropDex] VITE_IMPORT_API_URL is required in production. '
      + 'Set it to the public DropDex FastAPI backend URL before building.',
    );
  }

  return DEVELOPMENT_IMPORT_API_URL;
}

export const IMPORT_API_BASE = resolveImportApiBase(import.meta.env);
