import { describe, expect, it, vi } from 'vitest';
import {
  accountThemeStorageKey,
  clearPendingThemeIfCurrent,
  createThemeWriteQueue,
  isThemeSyncRequestCurrent,
  markThemePending,
  pendingThemeStorageKey,
  persistThemeLocally,
  readAccountTheme,
  readPendingTheme,
  readStartupTheme,
  type ThemeStorage,
} from './themePersistence';

class MemoryThemeStorage implements ThemeStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('theme persistence', () => {
  it('keeps a generic startup cache and a separate cache per account', () => {
    const storage = new MemoryThemeStorage();

    persistThemeLocally(storage, 'cdj', 'user-a');

    expect(readStartupTheme(storage)).toBe('cdj');
    expect(readAccountTheme(storage, 'user-a')).toBe('cdj');
    expect(readAccountTheme(storage, 'user-b')).toBeNull();
    expect(storage.getItem(accountThemeStorageKey('user-a'))).toBe('cdj');
  });

  it('falls back safely when storage contains unsupported values', () => {
    const storage = new MemoryThemeStorage();
    storage.setItem('dropdex-theme', 'laser-grid');
    storage.setItem(accountThemeStorageKey('user-a'), 'rekordbox');

    expect(readStartupTheme(storage)).toBe('dark');
    expect(readAccountTheme(storage, 'user-a')).toBeNull();
  });

  it('retains a failed sync marker until the matching theme is saved', () => {
    const storage = new MemoryThemeStorage();
    markThemePending(storage, 'user-a', 'light');

    clearPendingThemeIfCurrent(storage, 'user-a', 'dark');
    expect(readPendingTheme(storage, 'user-a')).toBe('light');

    clearPendingThemeIfCurrent(storage, 'user-a', 'light');
    expect(readPendingTheme(storage, 'user-a')).toBeNull();
    expect(storage.getItem(pendingThemeStorageKey('user-a'))).toBeNull();
  });

  it('rejects remote results after the account or local selection revision changes', () => {
    expect(isThemeSyncRequestCurrent(3, 3, 5, 5)).toBe(true);
    expect(isThemeSyncRequestCurrent(3, 4, 5, 5)).toBe(false);
    expect(isThemeSyncRequestCurrent(3, 3, 5, 6)).toBe(false);
  });

  it('serializes writes and coalesces rapid selections to the newest theme', async () => {
    const firstWrite = deferred();
    const saved: string[] = [];
    const save = vi.fn(async (userId: string, theme: string) => {
      saved.push(`${userId}:${theme}`);
      if (saved.length === 1) await firstWrite.promise;
    });
    const onSaved = vi.fn();
    const queue = createThemeWriteQueue(save, { onSaved });

    queue.enqueue('user-a', 'dark');
    await flushPromises();
    queue.enqueue('user-a', 'light');
    queue.enqueue('user-a', 'cdj');

    expect(saved).toEqual(['user-a:dark']);

    firstWrite.resolve();
    await flushPromises();
    await flushPromises();

    expect(saved).toEqual(['user-a:dark', 'user-a:cdj']);
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it('keeps the latest pending theme when an older queued write succeeds', async () => {
    const firstWrite = deferred();
    const secondWrite = deferred();
    const storage = new MemoryThemeStorage();
    markThemePending(storage, 'user-a', 'dark');

    const queue = createThemeWriteQueue(
      async (_userId, theme) => {
        if (theme === 'dark') await firstWrite.promise;
        if (theme === 'cdj') await secondWrite.promise;
      },
      {
        onSaved: (userId, theme) => {
          clearPendingThemeIfCurrent(storage, userId, theme);
        },
      },
    );

    queue.enqueue('user-a', 'dark');
    await flushPromises();
    markThemePending(storage, 'user-a', 'cdj');
    queue.enqueue('user-a', 'cdj');

    firstWrite.resolve();
    await flushPromises();
    expect(readPendingTheme(storage, 'user-a')).toBe('cdj');

    secondWrite.resolve();
    await flushPromises();
    expect(readPendingTheme(storage, 'user-a')).toBeNull();
  });
});
