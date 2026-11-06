import { describe, expect, it, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({
  row: { data: null as unknown, error: null as { message: string } | null },
  signed: { data: null as unknown, error: null as { message: string } | null },
  filters: [] as Array<[string, unknown]>,
  signedArgs: [] as unknown[],
}));

vi.mock('../supabase', () => {
  const query: Record<string, unknown> = {
    select: () => query,
    eq: (column: string, value: unknown) => { calls.filters.push([column, value]); return query; },
    maybeSingle: async () => calls.row,
  };
  return {
    supabase: {
      from: () => query,
      storage: { from: () => ({ createSignedUrl: async (...args: unknown[]) => { calls.signedArgs = args; return calls.signed; } }) },
    },
  };
});

import { fetchPreviewPlayback } from '../queries/trackPreviews';

beforeEach(() => {
  calls.row = { data: null, error: null };
  calls.signed = { data: null, error: null };
  calls.filters = [];
  calls.signedArgs = [];
});

describe('fetchPreviewPlayback', () => {
  it('returns null when the user has no ready preview for the track', async () => {
    expect(await fetchPreviewPlayback('c:1')).toBeNull();
    expect(calls.filters).toEqual([['identity_key', 'c:1'], ['status', 'ready']]);
  });

  it('returns a temporary link to the preview file in the private bucket', async () => {
    calls.row = { data: { storage_path: 'user/abc.m4a', duration_ms: 240000 }, error: null };
    calls.signed = { data: { signedUrl: 'https://example.test/signed' }, error: null };
    expect(await fetchPreviewPlayback('c:1')).toEqual({ url: 'https://example.test/signed', durationMs: 240000 });
    expect(calls.signedArgs).toEqual(['user/abc.m4a', 3600]);
  });

  it('throws when the lookup or the link fails, so the player can fall back', async () => {
    calls.row = { data: null, error: { message: 'offline' } };
    await expect(fetchPreviewPlayback('c:1')).rejects.toThrow('offline');
    calls.row = { data: { storage_path: 'user/abc.m4a', duration_ms: null }, error: null };
    calls.signed = { data: null, error: { message: 'denied' } };
    await expect(fetchPreviewPlayback('c:1')).rejects.toThrow('denied');
  });
});
