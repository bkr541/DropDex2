export type LibraryTab =
  | 'overview'
  | 'playlists'
  | 'recently-added'
  | 'tracks'
  | 'genres'
  | 'artists';

export type AppRoute =
  | { name: 'library'; tab: LibraryTab; search: string }
  | { name: 'playlist'; playlistId: string }
  | { name: 'playlist-edit'; playlistId: string }
  | { name: 'track'; trackId: string }
  | {
      name: 'drop-lab';
      sourceTrackId: string;
      candidateTrackId: string | null;
      sourceDropId: string | null;
      candidateDropId: string | null;
    }
  | { name: 'import'; importId: string; resume: boolean }
  | { name: 'review' }
  | { name: 'discovery' }
  | { name: 'search' }
  | { name: 'profile' }
  | { name: 'settings' }
  | { name: 'not-found'; pathname: string };

const LIBRARY_TAB_PATHS: Record<LibraryTab, string> = {
  overview: '/library',
  playlists: '/library/playlists',
  'recently-added': '/library/recent',
  tracks: '/library/tracks',
  genres: '/library/genres',
  artists: '/library/artists',
};

const PATH_TO_LIBRARY_TAB = new Map(
  Object.entries(LIBRARY_TAB_PATHS).map(([tab, path]) => [path, tab as LibraryTab]),
);

function safeDecode(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function queryValue(searchParams: URLSearchParams, name: string): string | null {
  const value = searchParams.get(name)?.trim();
  return value ? value : null;
}

export function parseAppRoute(pathname: string, search = ''): AppRoute {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const params = new URLSearchParams(search);

  if (normalizedPath === '/') {
    return { name: 'library', tab: 'overview', search: '' };
  }

  const libraryTab = PATH_TO_LIBRARY_TAB.get(normalizedPath);
  if (libraryTab) {
    return {
      name: 'library',
      tab: libraryTab,
      search: queryValue(params, 'q') ?? '',
    };
  }

  const playlistEditMatch = normalizedPath.match(/^\/playlists\/([^/]+)\/edit$/);
  if (playlistEditMatch) {
    const playlistId = safeDecode(playlistEditMatch[1]);
    return playlistId
      ? { name: 'playlist-edit', playlistId }
      : { name: 'not-found', pathname: normalizedPath };
  }

  const playlistMatch = normalizedPath.match(/^\/playlists\/([^/]+)$/);
  if (playlistMatch) {
    const playlistId = safeDecode(playlistMatch[1]);
    return playlistId
      ? { name: 'playlist', playlistId }
      : { name: 'not-found', pathname: normalizedPath };
  }

  const trackMatch = normalizedPath.match(/^\/tracks\/([^/]+)$/);
  if (trackMatch) {
    const trackId = safeDecode(trackMatch[1]);
    return trackId
      ? { name: 'track', trackId }
      : { name: 'not-found', pathname: normalizedPath };
  }

  const dropLabMatch = normalizedPath.match(/^\/drop-lab\/([^/]+)$/);
  if (dropLabMatch) {
    const sourceTrackId = safeDecode(dropLabMatch[1]);
    return sourceTrackId
      ? {
          name: 'drop-lab',
          sourceTrackId,
          candidateTrackId: queryValue(params, 'candidate'),
          sourceDropId: queryValue(params, 'sourceDrop'),
          candidateDropId: queryValue(params, 'candidateDrop'),
        }
      : { name: 'not-found', pathname: normalizedPath };
  }

  const importMatch = normalizedPath.match(/^\/imports\/([^/]+)$/);
  if (importMatch) {
    const importId = safeDecode(importMatch[1]);
    return importId
      ? { name: 'import', importId, resume: params.get('resume') === '1' }
      : { name: 'not-found', pathname: normalizedPath };
  }

  switch (normalizedPath) {
    case '/review': return { name: 'review' };
    case '/discovery': return { name: 'discovery' };
    case '/search': return { name: 'search' };
    case '/profile': return { name: 'profile' };
    case '/settings': return { name: 'settings' };
    default: return { name: 'not-found', pathname: normalizedPath };
  }
}

export function routeToUrl(route: AppRoute): string {
  switch (route.name) {
    case 'library': {
      const params = new URLSearchParams();
      if (route.search.trim()) params.set('q', route.search.trim());
      const query = params.toString();
      return `${LIBRARY_TAB_PATHS[route.tab]}${query ? `?${query}` : ''}`;
    }
    case 'playlist':
      return `/playlists/${encodeURIComponent(route.playlistId)}`;
    case 'playlist-edit':
      return `/playlists/${encodeURIComponent(route.playlistId)}/edit`;
    case 'track':
      return `/tracks/${encodeURIComponent(route.trackId)}`;
    case 'drop-lab': {
      const params = new URLSearchParams();
      if (route.candidateTrackId) params.set('candidate', route.candidateTrackId);
      if (route.sourceDropId) params.set('sourceDrop', route.sourceDropId);
      if (route.candidateDropId) params.set('candidateDrop', route.candidateDropId);
      const query = params.toString();
      return `/drop-lab/${encodeURIComponent(route.sourceTrackId)}${query ? `?${query}` : ''}`;
    }
    case 'import':
      return `/imports/${encodeURIComponent(route.importId)}${route.resume ? '?resume=1' : ''}`;
    case 'review': return '/review';
    case 'discovery': return '/discovery';
    case 'search': return '/search';
    case 'profile': return '/profile';
    case 'settings': return '/settings';
    case 'not-found': return route.pathname;
  }
}

export function routeKey(route: AppRoute): string {
  return routeToUrl(route);
}

export function routeBackFallback(route: AppRoute): AppRoute {
  switch (route.name) {
    case 'playlist-edit': return { name: 'playlist', playlistId: route.playlistId };
    case 'drop-lab': return { name: 'track', trackId: route.sourceTrackId };
    case 'track':
    case 'playlist':
    case 'review':
    case 'discovery':
    case 'search':
    case 'profile':
    case 'settings':
    case 'import':
    case 'not-found':
      return { name: 'library', tab: 'overview', search: '' };
    case 'library':
      return { name: 'library', tab: 'overview', search: '' };
  }
}
