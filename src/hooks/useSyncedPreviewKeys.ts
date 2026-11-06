import { useEffect, useState } from 'react';
import { logger } from '../lib/logger';
import { previewSyncStore } from '../lib/preview/previewSync';
import { fetchPreviewStates } from '../lib/queries/trackPreviews';

const NONE: ReadonlySet<string> = new Set();

/**
 * The identity keys of every track that has a DropDex Cloud preview. Loaded once, and again whenever a sync finishes so the
 * icons turn on as soon as tracks are synced. `failed` is true when the cloud status could not be read.
 */
export function useSyncedPreviewKeys(enabled = true) {
  const [keys, setKeys] = useState<ReadonlySet<string>>(NONE);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let lastPhase = previewSyncStore.getState().phase;
    return previewSyncStore.subscribe(() => {
      const phase = previewSyncStore.getState().phase;
      if (phase === 'done' && lastPhase !== 'done') setRefresh((n) => n + 1);
      lastPhase = phase;
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchPreviewStates()
      .then((states) => {
        if (cancelled) return;
        setKeys(new Set([...states].filter(([, state]) => state.status === 'ready').map(([key]) => key)));
        setFailed(false);
      })
      .catch((error: unknown) => {
        logger.error('preview.status.load_failed', { message: error instanceof Error ? error.message : String(error) });
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [enabled, refresh]);

  return { keys, failed };
}
