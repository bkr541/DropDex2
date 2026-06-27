import { describe, expect, it, vi } from 'vitest';
import {
  createConfiguredSupabaseClient,
  resolveSupabaseConfiguration,
} from './supabase';

describe('Supabase startup configuration', () => {
  it('reports a missing Supabase URL without exposing other values', () => {
    const configuration = resolveSupabaseConfiguration({
      VITE_SUPABASE_ANON_KEY: 'public-anon-value',
    });

    expect(configuration).toEqual({
      status: 'missing',
      missingVariables: ['VITE_SUPABASE_URL'],
    });
    expect(JSON.stringify(configuration)).not.toContain('public-anon-value');
  });

  it('reports a missing Supabase anonymous key', () => {
    expect(resolveSupabaseConfiguration({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
    })).toEqual({
      status: 'missing',
      missingVariables: ['VITE_SUPABASE_ANON_KEY'],
    });
  });

  it('reports both missing configuration values', () => {
    expect(resolveSupabaseConfiguration({})).toEqual({
      status: 'missing',
      missingVariables: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    });
  });

  it('accepts the publishable key alias', () => {
    const configuration = resolveSupabaseConfiguration({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    });

    expect(configuration).toMatchObject({
      status: 'configured',
      keyVariable: 'VITE_SUPABASE_PUBLISHABLE_KEY',
    });
  });

  it('does not create a client when configuration is missing', () => {
    const factory = vi.fn();
    const configuration = resolveSupabaseConfiguration({});

    expect(createConfiguredSupabaseClient(configuration, factory as never)).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('creates one client after both required values are validated', () => {
    const fakeClient = { auth: {} };
    const factory = vi.fn().mockReturnValue(fakeClient);
    const configuration = resolveSupabaseConfiguration({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    });

    expect(createConfiguredSupabaseClient(configuration, factory as never)).toBe(fakeClient);
    expect(factory).toHaveBeenCalledWith('https://example.supabase.co', 'anon-key');
  });
});
