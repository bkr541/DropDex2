import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  isThemeId,
  type ThemeId,
} from './theme';

const THEME_PENDING_STORAGE_PREFIX = `${THEME_STORAGE_KEY}-pending`;

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ThemeWriteQueue {
  enqueue(userId: string, theme: ThemeId): void;
  dispose(): void;
}

interface QueuedThemeWrite {
  userId: string;
  theme: ThemeId;
}

export function accountThemeStorageKey(userId: string): string {
  return `${THEME_STORAGE_KEY}:${userId}`;
}

export function pendingThemeStorageKey(userId: string): string {
  return `${THEME_PENDING_STORAGE_PREFIX}:${userId}`;
}

function readThemeAtKey(storage: ThemeStorage | null, key: string): ThemeId | null {
  if (!storage) return null;

  try {
    const value = storage.getItem(key);
    return isThemeId(value) ? value : null;
  } catch {
    return null;
  }
}

export function readStartupTheme(storage: ThemeStorage | null): ThemeId {
  return readThemeAtKey(storage, THEME_STORAGE_KEY) ?? DEFAULT_THEME;
}

export function readAccountTheme(
  storage: ThemeStorage | null,
  userId: string,
): ThemeId | null {
  return readThemeAtKey(storage, accountThemeStorageKey(userId));
}

export function readPendingTheme(
  storage: ThemeStorage | null,
  userId: string,
): ThemeId | null {
  return readThemeAtKey(storage, pendingThemeStorageKey(userId));
}

function safeSetItem(storage: ThemeStorage | null, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // The in-memory theme remains active when browser storage is unavailable.
  }
}

export function persistThemeLocally(
  storage: ThemeStorage | null,
  theme: ThemeId,
  userId?: string | null,
): void {
  safeSetItem(storage, THEME_STORAGE_KEY, theme);
  if (userId) safeSetItem(storage, accountThemeStorageKey(userId), theme);
}

export function markThemePending(
  storage: ThemeStorage | null,
  userId: string,
  theme: ThemeId,
): void {
  safeSetItem(storage, pendingThemeStorageKey(userId), theme);
}

export function clearPendingThemeIfCurrent(
  storage: ThemeStorage | null,
  userId: string,
  savedTheme: ThemeId,
): void {
  if (!storage || readPendingTheme(storage, userId) !== savedTheme) return;

  try {
    storage.removeItem(pendingThemeStorageKey(userId));
  } catch {
    // A stale pending marker is harmless and will be retried next session.
  }
}

export function isThemeSyncRequestCurrent(
  requestGeneration: number,
  currentGeneration: number,
  revisionAtStart: number,
  currentRevision: number,
): boolean {
  return requestGeneration === currentGeneration && revisionAtStart === currentRevision;
}

export function createThemeWriteQueue(
  save: (userId: string, theme: ThemeId) => Promise<void>,
  options: {
    onSaved?: (userId: string, theme: ThemeId) => void;
    onError?: (error: unknown, userId: string, theme: ThemeId) => void;
  } = {},
): ThemeWriteQueue {
  let pending: QueuedThemeWrite | null = null;
  let running = false;
  let disposed = false;

  const drain = async () => {
    if (running || disposed) return;
    running = true;

    try {
      while (pending && !disposed) {
        const next = pending;
        pending = null;

        try {
          await save(next.userId, next.theme);
          if (!disposed) options.onSaved?.(next.userId, next.theme);
        } catch (error) {
          if (!disposed) options.onError?.(error, next.userId, next.theme);
        }
      }
    } finally {
      running = false;
      if (pending && !disposed) void drain();
    }
  };

  return {
    enqueue(userId, theme) {
      if (disposed) return;
      pending = { userId, theme };
      void drain();
    },

    dispose() {
      disposed = true;
      pending = null;
    },
  };
}
