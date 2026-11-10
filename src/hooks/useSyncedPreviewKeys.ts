import { useCallback, useEffect, useState } from 'react';
import { logger } from '../lib/logger';
import { previewSyncStore } from '../lib/preview/previewSync';
import { fetchPreviewStates } from '../lib/queries/trackPreviews';

const NONE: ReadonlySet<string> = new Set();

/**
 * The identity keys of every track that has a DropDex Cloud preview. Loaded once, and again whenever a sync finishes so the
 * icons turn on as soon as tracks are synced. `failed` is true when the cloud status could not be read.
 */
export function useSyncedPreviewKeys(enabled = true) {
  const [result, setResult] = useState<{ revision: number; keys: ReadonlySet<string>; failed: boolean } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const retry = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let lastPhase = previewSyncStore.getState().phase;
    return previewSyncStore.subscribe(() => {
      const phase = previewSyncStore.getState().phase;
      if ((phase === 'done' || phase === 'error') && phase !== lastPhase) retry();
      lastPhase = phase;
    });
  }, [enabled, retry]);

  useEffect(() => {
    if (!enabled) {
      setResult(null);
      return;
    }
    const controller = new AbortController();
    fetchPreviewStates(controller.signal)
      .then((states) => {
        if (controller.signal.aborted) return;
        const keys = new Set([...states].filter(([, state]) => state.status === 'ready').map(([key]) => key));
        setResult({ revision: refresh, keys, failed: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        logger.error('preview.status.load_failed', { message: error instanceof Error ? error.message : String(error) });
        setResult({ revision: refresh, keys: NONE, failed: true });
      });
    return () => controller.abort();
  }, [enabled, refresh]);

  const current = enabled && result?.revision === refresh ? result : null;
  return { keys: current?.keys ?? NONE, failed: current?.failed ?? false, loading: enabled && !current, retry };
}
