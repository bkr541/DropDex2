import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchIlleniumTrackTitles } from './soundcloud';

afterEach(() => vi.unstubAllGlobals());

describe('SoundCloud title search', () => {
  it('uses the fixed search endpoint with authentication and cancellation', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(['Forever', 'In My Arms'])));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchIlleniumTrackTitles('token', controller.signal)).resolves.toEqual(['Forever', 'In My Arms']);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/discovery/soundcloud/illenium/tracks'),
      { headers: { Authorization: 'Bearer token' }, cache: 'no-store', signal: controller.signal },
    );
  });

  it('rejects malformed title lists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ title: 'Forever' }]))));
    await expect(fetchIlleniumTrackTitles('token')).rejects.toThrow('unexpected SoundCloud track titles response');
  });

  it('surfaces browser search failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ detail: 'SoundCloud search could not load. Please try again.' }), { status: 503 },
    )));
    await expect(fetchIlleniumTrackTitles('token')).rejects.toThrow('SoundCloud search could not load.');
  });
});
