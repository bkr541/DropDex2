import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseAppRoute, routeBackFallback, routeToUrl, type AppRoute } from './appRoutes';

const HISTORY_INDEX_KEY = '__dropdexNavigationIndex';

type NavigationOptions = {
  replace?: boolean;
};

function isDesktopRuntime(): boolean {
  return Boolean(window.dropdexDesktop?.isElectron);
}

function desktopLocationParts(): { pathname: string; search: string } {
  const rawHash = window.location.hash.replace(/^#/, '');
  if (!rawHash) return { pathname: '/', search: '' };
  const queryIndex = rawHash.indexOf('?');
  if (queryIndex < 0) return { pathname: rawHash, search: '' };
  return {
    pathname: rawHash.slice(0, queryIndex) || '/',
    search: rawHash.slice(queryIndex),
  };
}

function currentRoute(): AppRoute {
  if (isDesktopRuntime()) {
    const location = desktopLocationParts();
    return parseAppRoute(location.pathname, location.search);
  }
  return parseAppRoute(window.location.pathname, window.location.search);
}

function currentPathname(): string {
  return isDesktopRuntime() ? desktopLocationParts().pathname : window.location.pathname;
}

function historyUrl(route: AppRoute): string {
  const routeUrl = routeToUrl(route);
  return isDesktopRuntime() ? `#${routeUrl}` : routeUrl;
}

function currentIndex(): number {
  const value = window.history.state?.[HISTORY_INDEX_KEY];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function useAppRouter() {
  const [route, setRoute] = useState<AppRoute>(() => currentRoute());
  const [historyIndex, setHistoryIndex] = useState(() => currentIndex());

  useEffect(() => {
    if (typeof window.history.state?.[HISTORY_INDEX_KEY] !== 'number') {
      window.history.replaceState(
        { ...window.history.state, [HISTORY_INDEX_KEY]: 0 },
        '',
        window.location.href,
      );
      setHistoryIndex(0);
    }

    if (currentPathname() === '/') {
      const libraryRoute: AppRoute = { name: 'library', tab: 'overview', search: '' };
      window.history.replaceState(
        { ...window.history.state, [HISTORY_INDEX_KEY]: currentIndex() },
        '',
        historyUrl(libraryRoute),
      );
      setRoute(libraryRoute);
    }

    const onPopState = () => {
      setHistoryIndex(currentIndex());
      setRoute(currentRoute());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((nextRoute: AppRoute, options: NavigationOptions = {}) => {
    const url = historyUrl(nextRoute);
    if (options.replace) {
      window.history.replaceState(
        { ...window.history.state, [HISTORY_INDEX_KEY]: currentIndex() },
        '',
        url,
      );
      setRoute(nextRoute);
      return;
    }

    const nextIndex = currentIndex() + 1;
    window.history.pushState({ [HISTORY_INDEX_KEY]: nextIndex }, '', url);
    setHistoryIndex(nextIndex);
    setRoute(nextRoute);
  }, []);

  const goBack = useCallback((fallback = routeBackFallback(route)) => {
    if (historyIndex > 0) {
      window.history.back();
      return;
    }
    navigate(fallback, { replace: true });
  }, [historyIndex, navigate, route]);

  return useMemo(() => ({ route, navigate, goBack, historyIndex }), [goBack, historyIndex, navigate, route]);
}
