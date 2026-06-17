import { useEffect, useRef, useState } from 'react';
import type { SimilarTrackResult } from '../types';
import { fetchRekordboxRecommendedTracks } from '../lib/queries/recommendations';
import { fetchCamelotCompatibleTracks } from '../lib/queries/rekordbox';
import {
  hasSimilarVibesSignal,
  scoreCandidate,
  mergeCandidates,
  rankScoredCandidates,
  SIMILAR_CANDIDATE_FETCH_LIMIT,
} from '../lib/music/similarVibes';
import type { RekordboxTrack } from '../types';
import type { SimilarTrackOptions } from './useSimilarTrackSettings';

export type { SimilarTrackOptions };

/**
 * Fetches Similar Vibes candidates for the selected track.
 *
 * Merges results from two sources:
 *   1. rekordbox_recommendation_edges (recommendedLike from Rekordbox)
 *   2. Camelot-compatible tracks from rekordbox_tracks (key + BPM matching)
 *
 * Uses a monotonic request ID to discard results from superseded fetches,
 * so rapidly switching tracks or changing the BPM tolerance never shows stale data.
 *
 * On edge fetch failure: logs a warning and falls back to DB results only.
 */
export function useSimilarTracks(
  selectedTrack: RekordboxTrack | null,
  importId: string | null,
  options: SimilarTrackOptions,
): { similarTracks: SimilarTrackResult[]; loading: boolean } {
  const [similarTracks, setSimilarTracks] = useState<SimilarTrackResult[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!selectedTrack || !importId) {
      setSimilarTracks([]);
      setLoading(false);
      return;
    }

    const thisId = ++requestIdRef.current;
    setLoading(true);

    const run = async () => {
      const bpmTolerance = options.bpmTolerance;

      // 1. Always fetch recommendation edges (valid even without BPM or key)
      const edgeRows = await fetchRekordboxRecommendedTracks(
        importId,
        selectedTrack.id,
        SIMILAR_CANDIDATE_FETCH_LIMIT,
      ).catch((err: unknown) => {
        console.warn('[useSimilarTracks] edge fetch failed', err);
        return [] as Awaited<ReturnType<typeof fetchRekordboxRecommendedTracks>>;
      });

      // 2. Only fetch Camelot/BPM candidates if there's a usable signal
      const dbCandidates = hasSimilarVibesSignal(selectedTrack.camelot_key, selectedTrack.bpm)
        ? await fetchCamelotCompatibleTracks(importId, selectedTrack, bpmTolerance)
        : [];

      // 3. Score edge results
      const edgeScored: SimilarTrackResult[] = edgeRows.map(({ track, direction, rating }) =>
        scoreCandidate({
          selected: selectedTrack,
          candidate: track,
          bpmTolerance,
          edge: { direction, rating, createdAt: null },
        })
      );

      // 4. Score DB candidates
      const dbScored: SimilarTrackResult[] = dbCandidates.map((track) =>
        scoreCandidate({
          selected: selectedTrack,
          candidate: track,
          bpmTolerance,
          edge: null,
        })
      );

      // 5. Merge + rank
      const merged = mergeCandidates(edgeScored, dbScored);
      return rankScoredCandidates(merged);
    };

    run()
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
