import { useEffect, useRef, useState } from 'react';
import { fetchRekordboxRecommendedTracks } from '../lib/queries/recommendations';
import { fetchCamelotCompatibleTracks } from '../lib/queries/rekordbox';
import {
  BPM_TOLERANCE_DEFAULT,
  SIMILAR_CANDIDATE_FETCH_LIMIT,
  mergeCandidates,
  rankScoredCandidates,
  scoreCandidate,
} from '../lib/music/similarVibes';
import type { RekordboxTrack, SimilarTrackResult } from '../types';

export interface DropLabCandidate extends SimilarTrackResult {
  matchLabel: 'Strong Match' | 'Good Match' | 'Compatible' | 'Experimental';
}

function matchLabel(score: number): DropLabCandidate['matchLabel'] {
  if (score >= 60) return 'Strong Match';
  if (score >= 35) return 'Good Match';
  if (score >= 15) return 'Compatible';
  return 'Experimental';
}

export function useDropLabCandidates(
  sourceTrack: RekordboxTrack | null,
  importId: string | null,
  pinnedCandidate: RekordboxTrack | null = null,
) {
  const [candidates, setCandidates] = useState<DropLabCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!sourceTrack || !importId) {
      setCandidates([]);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);

    (async () => {
      const edgeRows = await fetchRekordboxRecommendedTracks(
        importId,
        sourceTrack.id,
        SIMILAR_CANDIDATE_FETCH_LIMIT,
      ).catch(() => []);
      const dbRows = await fetchCamelotCompatibleTracks(
        importId,
        sourceTrack,
        BPM_TOLERANCE_DEFAULT,
        32,
      ).catch(() => []);

      const edgeScored = edgeRows.map(({ track, direction, rating }) =>
        scoreCandidate({
          selected: sourceTrack,
          candidate: track,
          bpmTolerance: BPM_TOLERANCE_DEFAULT,
          edge: { direction, rating, createdAt: null },
        }),
      );
      const dbScored = dbRows.map((track) =>
        scoreCandidate({
          selected: sourceTrack,
          candidate: track,
          bpmTolerance: BPM_TOLERANCE_DEFAULT,
          edge: null,
        }),
      );

      const merged = mergeCandidates(edgeScored, dbScored);
      const pinnedResult = pinnedCandidate && pinnedCandidate.id !== sourceTrack.id
        ? scoreCandidate({
            selected: sourceTrack,
            candidate: pinnedCandidate,
            bpmTolerance: BPM_TOLERANCE_DEFAULT,
            edge: null,
          })
        : null;
      const ranked = rankScoredCandidates(
        pinnedResult ? mergeCandidates(merged, [pinnedResult]) : merged,
        12,
      ).filter((result) => result.track.id !== sourceTrack.id);

      // A durable Drop Lab URL is authoritative even when the selected candidate
      // no longer lands in the current recommendation top 12. Keep it available
      // so refresh and shared links restore the same comparison.
      const withPinned = pinnedResult && !ranked.some((result) => result.track.id === pinnedResult.track.id)
        ? [pinnedResult, ...ranked].slice(0, 12)
        : ranked;

      return withPinned.map((result) => ({
        ...result,
        matchLabel: matchLabel(result.recommendationScore),
      }));
    })()
      .then((ranked) => {
        if (requestId !== requestIdRef.current) return;
        setCandidates(ranked);
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setCandidates([]);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [sourceTrack, importId, pinnedCandidate]);

  return { candidates, loading };
}

