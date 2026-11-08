import { useEffect, useState } from 'react';
import { trackIdentityKey } from '../../lib/preview/trackIdentity';
import { fetchTrackBeatGrids, fetchTracksCueStates, type BeatGridRow, type CueLoadState } from '../../lib/queries/analysisData';
import { fetchTracksByIds } from '../../lib/queries/rekordbox';
import type { RekordboxTrack } from '../../types';
import type { SetLabFiveSlots, SetLabScope } from './session';

export type SetLabTimelineData =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      tracks: ReadonlyMap<string, RekordboxTrack>;
      grids: ReadonlyMap<string, BeatGridRow>;
      cues: ReadonlyMap<string, CueLoadState>;
      gridError: boolean;
    };

export function useSetLabTimelineData({ userId, sourceImportId }: SetLabScope, slots: SetLabFiveSlots) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([userId, sourceImportId, slots.map(({ trackId, trackIdentityKey }) => [trackId, trackIdentityKey]), attempt]);
  const [result, setResult] = useState<{ key: string; data: SetLabTimelineData } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const [, importId, refs] = JSON.parse(key) as [string, string, [string, string][], number];
    const expected = new Map(refs);
    void (async () => {
      const rows = await fetchTracksByIds([...expected.keys()], signal);
      signal.throwIfAborted();
      const tracks = new Map(rows.filter((track) => track.import_id === importId
        && expected.get(track.id) === trackIdentityKey(track)).map((track) => [track.id, track]));
      const ids = [...tracks.keys()];
      const [grids, cues] = await Promise.allSettled([
        fetchTrackBeatGrids(ids, signal), fetchTracksCueStates(ids, signal),
      ]);
      signal.throwIfAborted();
      setResult({
        key,
        data: {
          status: 'ready', tracks,
          grids: grids.status === 'fulfilled'
            ? new Map([...grids.value].filter(([id, row]) => row.import_id === importId && row.track_id === id && tracks.has(id)))
            : new Map(),
          cues: cues.status === 'fulfilled' ? cues.value.states : new Map(),
          gridError: grids.status === 'rejected',
        },
      });
    })().catch((error: unknown) => {
      if (!signal.aborted) {
        setResult({ key, data: { status: 'error', message: error instanceof Error ? error.message : 'Could not load Set Lab analysis.' } });
      }
    });
    return () => controller.abort();
  }, [key]);

  return {
    data: result?.key === key ? result.data : { status: 'loading' } as const,
    retry: () => setAttempt((value) => value + 1),
  };
}
