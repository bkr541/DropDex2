import { describe, expect, it } from 'vitest';
import { resolveImportApiBase } from './baseUrl';

describe('resolveImportApiBase', () => {
  it('uses the configured backend URL and removes trailing slashes', () => {
    expect(resolveImportApiBase({
      PROD: true,
      VITE_IMPORT_API_URL: ' https://api.dropdex.example/// ',
    })).toBe('https://api.dropdex.example');
  });

  it('uses the loopback backend only during development', () => {
    expect(resolveImportApiBase({ DEV: true })).toBe('http://127.0.0.1:8000');
  });

  it('rejects a production configuration without a backend URL', () => {
    expect(() => resolveImportApiBase({ PROD: true })).toThrow('VITE_IMPORT_API_URL is required');
  });
});
