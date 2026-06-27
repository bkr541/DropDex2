import { describe, expect, it } from 'vitest';
import { parseAppRoute, routeBackFallback, routeToUrl } from './appRoutes';

describe('app routes', () => {
  it('round trips durable entity routes', () => {
    const routes = [
      { name: 'playlist', playlistId: 'playlist/with space' } as const,
      { name: 'track', trackId: 'track-1' } as const,
      { name: 'import', importId: 'import-1', resume: true } as const,
      {
        name: 'drop-lab',
        sourceTrackId: 'source-1',
        candidateTrackId: 'candidate-2',
        sourceDropId: 'cue:1',
        candidateDropId: 'phrase:2',
      } as const,
    ];

    for (const route of routes) {
      const url = new URL(routeToUrl(route), 'https://dropdex.test');
      expect(parseAppRoute(url.pathname, url.search)).toEqual(route);
    }
  });

  it('maps library tabs and search to canonical URLs', () => {
    expect(parseAppRoute('/library/recent', '?q=night+drive')).toEqual({
      name: 'library',
      tab: 'recently-added',
      search: 'night drive',
    });
    expect(routeToUrl({ name: 'library', tab: 'tracks', search: 'Artist One' }))
      .toBe('/library/tracks?q=Artist+One');
  });

  it('returns a readable not-found route for unknown or malformed paths', () => {
    expect(parseAppRoute('/unknown')).toEqual({ name: 'not-found', pathname: '/unknown' });
    expect(parseAppRoute('/tracks/%E0%A4%A')).toEqual({
      name: 'not-found',
      pathname: '/tracks/%E0%A4%A',
    });
  });

  it('uses entity-aware fallback routes for direct-entry back actions', () => {
    expect(routeBackFallback({ name: 'drop-lab', sourceTrackId: 't1', candidateTrackId: null, sourceDropId: null, candidateDropId: null }))
      .toEqual({ name: 'track', trackId: 't1' });
    expect(routeBackFallback({ name: 'playlist-edit', playlistId: 'p1' }))
      .toEqual({ name: 'playlist', playlistId: 'p1' });
  });
});
