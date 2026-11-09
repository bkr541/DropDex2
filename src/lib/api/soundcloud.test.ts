import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSoundCloudArtistTrackTitles, fetchSoundCloudFavoriteArtists } from './soundcloud';

afterEach(() => vi.unstubAllGlobals());

describe('SoundCloud artist search', () => {
  it('loads the favorite artists with authentication and cancellation', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 'a1', name: 'ILLENIUM' }, { id: 'a2', name: 'Zoë & Dabin' }])));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchSoundCloudFavoriteArtists('token', controller.signal)).resolves.toEqual([{ id: 'a1', name: 'ILLENIUM' }, { id: 'a2', name: 'Zoë & Dabin' }]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/discovery/soundcloud/favorite-artists'), { headers: { Authorization: 'Bearer token' }, cache: 'no-store', signal: controller.signal });
  });

  it('searches by artist id only, encoded, never by a name from the browser', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(['Forever', 'In My Arms'])));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchSoundCloudArtistTrackTitles('token', 'id/with space')).resolves.toEqual(['Forever', 'In My Arms']);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/discovery/soundcloud/artists/id%2Fwith%20space/tracks'), expect.anything());
  });

  it('rejects malformed responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ title: 'Forever' }]))));
    await expect(fetchSoundCloudArtistTrackTitles('token', 'a1')).rejects.toThrow('unexpected SoundCloud track titles response');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'a1' }]))));
    await expect(fetchSoundCloudFavoriteArtists('token')).rejects.toThrow();
  });

  it('surfaces failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'SoundCloud search could not load. Please try again.' }), { status: 503 })));
    await expect(fetchSoundCloudArtistTrackTitles('token', 'a1')).rejects.toThrow('SoundCloud search could not load.');
  });
});
