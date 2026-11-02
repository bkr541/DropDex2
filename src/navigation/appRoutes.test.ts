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

  it('no longer routes to the removed Roulette screen', () => {
    expect(parseAppRoute('/roulette').name).not.toBe('roulette');
  });

  it('round trips the cue workspace route', () => {
    expect(parseAppRoute('/cues')).toEqual({ name: 'cues' });
    expect(routeToUrl({ name: 'cues' })).toBe('/cues');
    expect(routeBackFallback({ name: 'cues' })).toEqual({ name: 'library', tab: 'overview', search: '' });
  });

  it('round trips the Audition route', () => {
    expect(parseAppRoute('/audition')).toEqual({ name: 'audition' });
    expect(routeToUrl({ name: 'audition' })).toBe('/audition');
    expect(routeBackFallback({ name: 'audition' })).toEqual({ name: 'library', tab: 'overview', search: '' });
  });

  it('maps library tabs and search to canonical URLs', () => {
    expect(parseAppRoute('/library/recent', '?q=night+drive')).toEqual({
      name: 'library',
      tab: 'recently-added',
      search: 'night drive',
    });
    expect(routeToUrl({ name: 'library', tab: 'tracks', search: 'Artist One' }))
      .toBe('/library/tracks?q=Artist+One');
    expect(parseAppRoute('/library/spotify')).toEqual({
      name: 'library',
      tab: 'spotify',
      search: '',
    });
  });

  it('opens Drop Lab from the nav without a source track, and keeps the source in the URL once picked', () => {
    const open = { name: 'drop-lab', sourceTrackId: null, candidateTrackId: null, sourceDropId: null, candidateDropId: null } as const;
    expect(parseAppRoute('/drop-lab')).toEqual(open);
    expect(routeToUrl(open)).toBe('/drop-lab');
    expect(routeToUrl({ ...open, sourceTrackId: 't1', candidateTrackId: 't2' })).toBe('/drop-lab/t1?candidate=t2');
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
    expect(routeBackFallback({ name: 'drop-lab', sourceTrackId: null, candidateTrackId: null, sourceDropId: null, candidateDropId: null }))
      .toEqual({ name: 'library', tab: 'overview', search: '' });
    expect(routeBackFallback({ name: 'playlist-edit', playlistId: 'p1' }))
      .toEqual({ name: 'playlist', playlistId: 'p1' });
  });
});
