import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseAppRoute, routeBackFallback, routeToUrl, type AppRoute } from './appRoutes';

const HISTORY_INDEX_KEY = '__dropdexNavigationIndex';

type NavigationOptions = {
  replace?: boolean;
};

function currentRoute(): AppRoute {
  return parseAppRoute(window.location.pathname, window.location.search);
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

    if (window.location.pathname === '/') {
      window.history.replaceState(
        { ...window.history.state, [HISTORY_INDEX_KEY]: currentIndex() },
        '',
        '/library',
      );
      setRoute({ name: 'library', tab: 'overview', search: '' });
    }

    const onPopState = () => {
      setHistoryIndex(currentIndex());
      setRoute(currentRoute());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((nextRoute: AppRoute, options: NavigationOptions = {}) => {
    const url = routeToUrl(nextRoute);
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
