import { describe, expect, it, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({
  row: { data: null as unknown, error: null as { message: string } | null },
  signed: { data: null as unknown, error: null as { message: string } | null },
  filters: [] as Array<[string, unknown]>,
  signedArgs: [] as unknown[],
  signal: undefined as AbortSignal | undefined,
}));

vi.mock('../supabase', () => {
  const query: Record<string, unknown> = {
    select: () => query,
    eq: (column: string, value: unknown) => { calls.filters.push([column, value]); return query; },
    abortSignal: (signal: AbortSignal) => { calls.signal = signal; return query; },
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
  calls.signal = undefined;
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

  it('scopes opted-in lookups to the requested owner and validates the private object path', async () => {
    const signal = new AbortController().signal;
    const path = 'owner/1234567890abcdef1234567890abcdef.m4a';
    calls.row = { data: { storage_path: path, duration_ms: 240000 }, error: null };
    calls.signed = { data: { signedUrl: 'https://example.test/signed' }, error: null };
    await expect(fetchPreviewPlayback('c:1', { userId: 'owner', signal })).resolves.toMatchObject({ durationMs: 240000 });
    expect(calls.filters).toContainEqual(['user_id', 'owner']);
    expect(calls.signal).toBe(signal);
    expect(calls.signedArgs).toEqual([path, 3600]);
    calls.signedArgs = [];
    await expect(fetchPreviewPlayback('c:1', { userId: 'another-owner', signal })).rejects.toThrow('requested account');
    expect(calls.signedArgs).toEqual([]);
  });

  it('does not query storage for an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchPreviewPlayback('c:1', { userId: 'owner', signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(calls.filters).toEqual([]);
  });

  it('throws when the lookup or the link fails, so the player can fall back', async () => {
    calls.row = { data: null, error: { message: 'offline' } };
    await expect(fetchPreviewPlayback('c:1')).rejects.toThrow('offline');
    calls.row = { data: { storage_path: 'user/abc.m4a', duration_ms: null }, error: null };
    calls.signed = { data: null, error: { message: 'denied' } };
    await expect(fetchPreviewPlayback('c:1')).rejects.toThrow('denied');
  });
});
