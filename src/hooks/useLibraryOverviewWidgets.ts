import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../lib/logger';
import {
  NO_HIDDEN_WIDGETS, parseHiddenWidgets, serializeHiddenWidgets, withWidgetVisibility, type LibraryOverviewWidgetId,
} from '../lib/dashboard/libraryOverviewWidgets';
import { fetchHiddenLibraryWidgets, saveHiddenLibraryWidgets } from '../lib/queries/userDashboardPreferences';

const cacheKey = (userId: string) => `dropdex:dashboard:library-overview-hidden:${userId}`;

function readCache(userId: string | null): ReadonlySet<LibraryOverviewWidgetId> {
  if (!userId) return NO_HIDDEN_WIDGETS;
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    return raw ? parseHiddenWidgets(JSON.parse(raw)) : NO_HIDDEN_WIDGETS;
  } catch {
    return NO_HIDDEN_WIDGETS;
  }
}

function writeCache(userId: string, hidden: ReadonlySet<LibraryOverviewWidgetId>): void {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(serializeHiddenWidgets(hidden)));
  } catch { /* the choice still applies for this visit and is saved to the account */ }
}

export interface LibraryOverviewWidgets {
  hidden: ReadonlySet<LibraryOverviewWidgetId>;
  setVisible: (id: LibraryOverviewWidgetId, visible: boolean) => void;
  showAll: () => void;
  /** True when the last change could not be saved to the account. It still applies on this computer. */
  saveFailed: boolean;
}

/**
 * Which Library overview groups are hidden. The choice shows instantly from a copy on this computer, is loaded from the user's
 * account when they sign in (so it follows them to other devices), and is saved to the account whenever it changes.
 */
export function useLibraryOverviewWidgets(userId: string | null): LibraryOverviewWidgets {
  const [hidden, setHidden] = useState<ReadonlySet<LibraryOverviewWidgetId>>(() => readCache(userId));
  const [saveFailed, setSaveFailed] = useState(false);
  // A change made before the account copy arrives must not be overwritten by it.
  const changedLocally = useRef(false);

  useEffect(() => {
    changedLocally.current = false;
    setHidden(readCache(userId));
    setSaveFailed(false);
    if (!userId) return;
    let cancelled = false;
    fetchHiddenLibraryWidgets(userId)
      .then((remote) => {
        if (cancelled || changedLocally.current || !remote) return;
        setHidden(remote);
        writeCache(userId, remote);
      })
      .catch((error: unknown) => {
        logger.error('library.widgets.load_failed', { message: error instanceof Error ? error.message : String(error) });
      });
    return () => { cancelled = true; };
  }, [userId]);

  const apply = useCallback((next: ReadonlySet<LibraryOverviewWidgetId>) => {
    changedLocally.current = true;
    setHidden(next);
    if (!userId) return;
    writeCache(userId, next);
    saveHiddenLibraryWidgets(userId, next)
      .then(() => setSaveFailed(false))
      .catch((error: unknown) => {
        logger.error('library.widgets.save_failed', { hidden: serializeHiddenWidgets(next), message: error instanceof Error ? error.message : String(error) });
        setSaveFailed(true);
      });
  }, [userId]);

  const setVisible = useCallback((id: LibraryOverviewWidgetId, visible: boolean) => {
    apply(withWidgetVisibility(hidden, id, visible));
  }, [apply, hidden]);

  const showAll = useCallback(() => apply(NO_HIDDEN_WIDGETS), [apply]);

  return { hidden, setVisible, showAll, saveFailed };
}
