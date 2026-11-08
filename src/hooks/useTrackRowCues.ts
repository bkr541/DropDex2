import { useEffect, useMemo, useState } from 'react';
import { fetchTracksCueStates, type CueLoadState } from '../lib/queries/analysisData';
import { logger } from '../lib/logger';

const NONE: ReadonlyMap<string, CueLoadState> = new Map();

/**
 * Cue points for the tracks listed in the library, so each row's waveform can show where its cues are.
 * Loads again when the list of tracks changes; a failure leaves the rows without markers instead of breaking the page.
 */
export function useTrackRowCues(trackIds: readonly string[]): ReadonlyMap<string, CueLoadState> {
  const idsKey = useMemo(() => [...new Set(trackIds)].join(','), [trackIds]);
  const [states, setStates] = useState<ReadonlyMap<string, CueLoadState>>(NONE);

  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    if (ids.length === 0) {
      setStates(NONE);
      return;
    }
    let cancelled = false;
    fetchTracksCueStates(ids)
      .then((result) => { if (!cancelled) setStates(new Map(result.states)); })
      .catch((error: unknown) => {
        logger.error('track_listing.row_cues.load_failed', { tracks: ids.length, error: error instanceof Error ? error.message : String(error) });
        if (!cancelled) setStates(NONE);
      });
    return () => { cancelled = true; };
  }, [idsKey]);

  return states;
}
