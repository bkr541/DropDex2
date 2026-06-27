import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const CHUNK_RELOAD_STATE_KEY = '__dropdexChunkReloads';
const CHUNK_ERROR_PATTERNS = [
  /loading chunk/i,
  /chunkloaderror/i,
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
];

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function chunkReloadGuardKey(featureKey: string): string {
  return `${featureKey}:${window.location.pathname}${window.location.search}`;
}

function currentReloadGuards(): Record<string, true> {
  const value = window.history.state?.[CHUNK_RELOAD_STATE_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, true>;
}

export function shouldReloadForChunkFailure(featureKey: string): boolean {
  const key = chunkReloadGuardKey(featureKey);
  const guards = currentReloadGuards();
  if (guards[key]) return false;

  window.history.replaceState(
    {
      ...window.history.state,
      [CHUNK_RELOAD_STATE_KEY]: { ...guards, [key]: true },
    },
    '',
    window.location.href,
  );
  return true;
}

export function clearChunkReloadGuard(featureKey: string): void {
  const key = chunkReloadGuardKey(featureKey);
  const guards = currentReloadGuards();
  if (!guards[key]) return;

  const nextGuards = { ...guards };
  delete nextGuards[key];
  window.history.replaceState(
    {
      ...window.history.state,
      [CHUNK_RELOAD_STATE_KEY]: nextGuards,
    },
    '',
    window.location.href,
  );
}

export function lazyWithRecovery<T extends ComponentType<object>>(
  featureKey: string,
  loader: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const loaded = await loader();
      clearChunkReloadGuard(featureKey);
      return loaded;
    } catch (error) {
      if (isChunkLoadError(error) && shouldReloadForChunkFailure(featureKey)) {
        window.location.reload();
        return await new Promise<never>(() => undefined);
      }
      throw error;
    }
  });
}
