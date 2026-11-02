import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchFlipLabCandidatePools, type FlipLabCandidatePools } from '../components/flip-lab/flipLabCandidates';
import {
  rankRouletteCandidates,
  rankRoulettePairsBounded,
  resolveTrackCamelotCode,
  rouletteDirectTempoDifference,
  rouletteKeyRelationship,
  scoreRouletteCandidate,
} from '../features/roulette/rouletteMatching';
import { logger } from '../lib/logger';
import { formatCamelotCode } from '../components/ui/display/camelotKey';
import type { RekordboxTrack } from '../types';

export type DropLabMatchLabel = 'Strong Match' | 'Good Match' | 'Compatible' | 'Experimental';

export interface DropLabCandidate {
  track: RekordboxTrack;
  score: number;
  matchLabel: DropLabMatchLabel;
  reasons: Array<{ label: string }>;
}

export interface DropLabAutoPair {
  sourceTrackId: string;
  candidateTrackId: string;
}

const CANDIDATE_LIMIT = 40;

/** Flip Lab scores run from 0 to about 225 (exact key 140 + tempo 60 + analysis and tags). */
function matchLabel(score: number): DropLabMatchLabel {
  if (score >= 190) return 'Strong Match';
  if (score >= 150) return 'Good Match';
  if (score >= 110) return 'Compatible';
  return 'Experimental';
}

function reasonsFor(source: RekordboxTrack, candidate: RekordboxTrack): Array<{ label: string }> {
  const reasons: Array<{ label: string }> = [];
  const difference = rouletteDirectTempoDifference(source.bpm, candidate.bpm);
  if (difference != null) reasons.push({ label: difference < 0.5 ? 'Same BPM' : `${difference.toFixed(1)} BPM apart` });
  const key = rouletteKeyRelationship(source, candidate);
  if (key === 'exact') reasons.push({ label: 'Same key' });
  else if (key === 'branch') reasons.push({ label: 'Key compatible' });
  return reasons;
}

/** Camelot code for display, since candidate rows carry only the light track columns. */
export function dropLabKeyLabel(track: RekordboxTrack | null): string {
  const code = track ? resolveTrackCamelotCode(track) : null;
  return code ? formatCamelotCode(code) : '—';
}

/**
 * Drop Lab's track picking, using the same engine as Flip Lab: the library pool from
 * `fetchFlipLabCandidatePools`, `rankRoulettePairsBounded` for the best pair when nothing
 * is chosen yet, and `rankRouletteCandidates` to rank candidates against a chosen track.
 */
export function useDropLabFlipPicks(importId: string | null, sourceTrack: RekordboxTrack | null, pinnedCandidate: RekordboxTrack | null = null) {
  const [pools, setPools] = useState<FlipLabCandidatePools | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!importId) { setPools(null); setLoading(false); return; }
    const request = ++requestRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchFlipLabCandidatePools(importId, { signal: controller.signal })
      .then((next) => { if (request === requestRef.current) setPools(next); })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || request !== requestRef.current) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        logger.error('droplab.picks.load_failed', { importId, message });
        setError('The library could not be loaded to suggest tracks.');
      })
      .finally(() => { if (request === requestRef.current) setLoading(false); });
    return () => controller.abort();
  }, [importId]);

  const autoPair = useMemo<DropLabAutoPair | null>(() => {
    if (sourceTrack || !pools) return null;
    const best = rankRoulettePairsBounded(pools.vocals, pools.instrumentals)[0];
    if (!best) return null;
    logger.info('droplab.picks.auto_pair', {
      source: best.vocal.track.title,
      candidate: best.instrumental.track.title,
      score: best.score,
      bpmDifference: best.bpmDifference,
    });
    return { sourceTrackId: best.vocal.track.id, candidateTrackId: best.instrumental.track.id };
  }, [pools, sourceTrack]);

  const candidates = useMemo<DropLabCandidate[]>(() => {
    if (!sourceTrack || !pools) return [];
    const reference = pools.vocals.find((entry) => entry.track.id === sourceTrack.id);
    const ranked: DropLabCandidate[] = rankRouletteCandidates(
      pools.instrumentals,
      { track: sourceTrack, beatGrid: reference?.beatGrid ?? null },
      'instrumental',
      new Set([sourceTrack.id]),
    )
      .slice(0, CANDIDATE_LIMIT)
      .map(({ candidate, score }) => ({
        track: candidate.track,
        score,
        matchLabel: matchLabel(score),
        reasons: reasonsFor(sourceTrack, candidate.track),
      }));
    // A candidate chosen earlier (kept in the URL) stays in the list even if it ranks lower now.
    if (pinnedCandidate && pinnedCandidate.id !== sourceTrack.id && !ranked.some((entry) => entry.track.id === pinnedCandidate.id)) {
      const entry = pools.instrumentals.find((item) => item.track.id === pinnedCandidate.id) ?? { track: pinnedCandidate, beatGrid: null, phraseCount: 0 };
      const score = scoreRouletteCandidate(entry, { track: sourceTrack, beatGrid: reference?.beatGrid ?? null }, 'instrumental');
      ranked.unshift({ track: pinnedCandidate, score, matchLabel: matchLabel(score), reasons: reasonsFor(sourceTrack, pinnedCandidate) });
    }
    return ranked;
  }, [pinnedCandidate, pools, sourceTrack]);

  return { pools, loading, error, autoPair, candidates, noPairFound: !sourceTrack && !loading && !error && pools != null && autoPair == null };
}
