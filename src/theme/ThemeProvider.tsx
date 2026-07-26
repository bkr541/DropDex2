import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuthSession } from '../hooks/useAuthSession';
import {
  fetchUserAppearanceTheme,
  saveUserAppearanceTheme,
} from '../lib/queries/userAppearancePreferences';
import {
  THEME_STORAGE_KEY,
  resolveTheme,
  themeColor,
  type ThemeId,
} from './theme';
import {
  accountThemeStorageKey,
  clearPendingThemeIfCurrent,
  createThemeWriteQueue,
  isThemeSyncRequestCurrent,
  markThemePending,
  persistThemeLocally,
  readAccountTheme,
  readPendingTheme,
  readStartupTheme,
  type ThemeStorage,
} from './themePersistence';

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getBrowserThemeStorage(): ThemeStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function applyDocumentTheme(theme: ThemeId) {
  if (typeof document === 'undefined') return;

  document.documentElement.setAttribute('data-theme', theme);
  if (theme === 'cdj') document.documentElement.style.colorScheme = 'dark';
  else document.documentElement.style.removeProperty('color-scheme');

  const metaThemeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  metaThemeColor?.setAttribute('content', themeColor(theme));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const auth = useAuthSession();
  const userId = auth.status === 'authenticated' ? auth.session.user.id : null;
  const [theme, setThemeState] = useState<ThemeId>(() => (
    readStartupTheme(getBrowserThemeStorage())
  ));
  const themeRef = useRef(theme);
  const localRevisionRef = useRef(0);
  const syncGenerationRef = useRef(0);

  const writeQueue = useMemo(() => createThemeWriteQueue(
    saveUserAppearanceTheme,
    {
      onSaved: (savedUserId, savedTheme) => {
        clearPendingThemeIfCurrent(
          getBrowserThemeStorage(),
          savedUserId,
          savedTheme,
        );
      },
      onError: (error, failedUserId, failedTheme) => {
        console.warn(
          `[DropDex] Could not sync appearance theme "${failedTheme}" for user ${failedUserId}. The local preference will be retried later.`,
          error,
        );
      },
    },
  ), []);

  const commitTheme = useCallback((nextTheme: ThemeId) => {
    themeRef.current = nextTheme;
    setThemeState(nextTheme);
  }, []);

  const setTheme = useCallback((nextTheme: ThemeId) => {
    localRevisionRef.current += 1;

    const storage = getBrowserThemeStorage();
    persistThemeLocally(storage, nextTheme, userId);
    commitTheme(nextTheme);

    if (userId) {
      markThemePending(storage, userId, nextTheme);
      writeQueue.enqueue(userId, nextTheme);
    }
  }, [commitTheme, userId, writeQueue]);

  useLayoutEffect(() => {
    if (!userId) return;

    const storage = getBrowserThemeStorage();
    const cachedTheme = readPendingTheme(storage, userId)
      ?? readAccountTheme(storage, userId);
    if (!cachedTheme) return;

    persistThemeLocally(storage, cachedTheme, userId);
    commitTheme(cachedTheme);
  }, [commitTheme, userId]);

  useLayoutEffect(() => {
    applyDocumentTheme(theme);
    persistThemeLocally(getBrowserThemeStorage(), theme);
  }, [theme]);

  useEffect(() => () => writeQueue.dispose(), [writeQueue]);

  useEffect(() => {
    const requestGeneration = ++syncGenerationRef.current;
    const revisionAtStart = localRevisionRef.current;
    let cancelled = false;

    if (!userId) return () => { cancelled = true; };

    const storage = getBrowserThemeStorage();
    const requestIsCurrent = () => (
      !cancelled && isThemeSyncRequestCurrent(
        requestGeneration,
        syncGenerationRef.current,
        revisionAtStart,
        localRevisionRef.current,
      )
    );

    const synchronize = async () => {
      const pendingTheme = readPendingTheme(storage, userId);
      if (pendingTheme) {
        if (!requestIsCurrent()) return;
        persistThemeLocally(storage, pendingTheme, userId);
        commitTheme(pendingTheme);
        writeQueue.enqueue(userId, pendingTheme);
        return;
      }

      const accountTheme = readAccountTheme(storage, userId);
      if (accountTheme && requestIsCurrent()) {
        persistThemeLocally(storage, accountTheme, userId);
        commitTheme(accountTheme);
      }

      try {
        const remoteTheme = await fetchUserAppearanceTheme(userId);
        if (!requestIsCurrent()) return;

        if (remoteTheme) {
          persistThemeLocally(storage, remoteTheme, userId);
          commitTheme(remoteTheme);
          return;
        }

        const initialTheme = themeRef.current;
        persistThemeLocally(storage, initialTheme, userId);
        markThemePending(storage, userId, initialTheme);
        writeQueue.enqueue(userId, initialTheme);
      } catch (error) {
        if (!cancelled) {
          console.warn(
            '[DropDex] Could not load the account appearance theme. Continuing with the local cache.',
            error,
          );
        }
      }
    };

    void synchronize();

    return () => {
      cancelled = true;
    };
  }, [commitTheme, userId, writeQueue]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      const expectedKey = userId
        ? accountThemeStorageKey(userId)
        : THEME_STORAGE_KEY;
      if (event.key !== expectedKey) return;

      const nextTheme = resolveTheme(event.newValue);
      localRevisionRef.current += 1;

      const storage = getBrowserThemeStorage();
      persistThemeLocally(storage, nextTheme, userId);
      commitTheme(nextTheme);

      if (userId) {
        markThemePending(storage, userId, nextTheme);
        writeQueue.enqueue(userId, nextTheme);
      }
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [commitTheme, userId, writeQueue]);

  const value = useMemo(() => ({ theme, setTheme }), [setTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
