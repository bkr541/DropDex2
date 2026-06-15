import { useEffect, useRef, useState } from 'react';
import type { RekordboxTrack } from '../types';
import { fetchSimilarTracks } from '../lib/queries/rekordbox';
import { hasSimilarVibesSignal } from '../lib/music/similarVibes';
import type { SimilarTrackOptions } from './useSimilarTrackSettings';

export type { SimilarTrackOptions };

/**
 * Fetches Similar Vibes candidates for the selected track.
 *
 * Uses a monotonic request ID to discard results from superseded fetches,
 * so rapidly switching tracks or changing the BPM tolerance never shows stale data.
 */
export function useSimilarTracks(
  selectedTrack: RekordboxTrack | null,
  importId: string | null,
  options: SimilarTrackOptions,
): { similarTracks: RekordboxTrack[]; loading: boolean } {
  const [similarTracks, setSimilarTracks] = useState<RekordboxTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!selectedTrack || !importId) {
      setSimilarTracks([]);
      setLoading(false);
      return;
    }

    if (!hasSimilarVibesSignal(selectedTrack.musical_key, selectedTrack.bpm)) {
      setSimilarTracks([]);
      setLoading(false);
      return;
    }

    const thisId = ++requestIdRef.current;
    setLoading(true);

    fetchSimilarTracks(importId, selectedTrack, options.bpmTolerance)
      .then((results) => {
        if (thisId !== requestIdRef.current) return;
        setSimilarTracks(results);
        setLoading(false);
      })
      .catch(() => {
        if (thisId !== requestIdRef.current) return;
        setSimilarTracks([]);
        setLoading(false);
      });
  }, [selectedTrack, importId, options.bpmTolerance]);

  return { similarTracks, loading };
}
