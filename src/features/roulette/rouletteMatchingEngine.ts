import { fetchTrackBeatGrid } from '../../lib/queries/analysisData';
import {
  fetchRouletteCandidateAnalysis,
  fetchRouletteTrack,
} from '../../lib/queries/rouletteCandidates';
import {
  chooseWeightedRouletteCandidate,
  chooseWeightedRoulettePair,
  rankRouletteCandidates,
  rankRoulettePairsBounded,
  type RouletteCandidateAnalysis,
  type RouletteCandidateReference,
  type RouletteCandidateScore,
  type RoulettePairScore,
} from './rouletteMatching';
import { roulettePairKey } from './rouletteSelectionHistory';
import type { StemAssetService } from './stemAssetService';
import type { StemAssetRecord } from './stemAssets';
import type { RouletteSourceRole } from './rouletteSession';

export interface RouletteResolvedSource {
  parentTrackId: string;
  track?: RouletteCandidateAnalysis['track'];
  /** Present only when Stage 2 already found a locally valid HQ asset. */
  stemAsset: StemAssetRecord | null;
}

export interface RouletteResolvedPair {
  vocal: RouletteResolvedSource;
  instrumental: RouletteResolvedSource;
}

export interface ResolveRouletteReplacementInput {
  role: RouletteSourceRole;
  fixedTrackId: string;
  currentTrackId?: string | null;
  recentTrackIds?: readonly string[];
  signal?: AbortSignal;
}

export interface ResolveRoulettePairInput {
  currentVocalTrackId?: string | null;
  currentInstrumentalTrackId?: string | null;
  recentVocalTrackIds?: readonly string[];
  recentInstrumentalTrackIds?: readonly string[];
  recentPairKeys?: readonly string[];
  signal?: AbortSignal;
}

export interface RouletteMatchingEngine {
  resolveReplacement(input: ResolveRouletteReplacementInput): Promise<RouletteResolvedSource | null>;
  resolvePair(input?: ResolveRoulettePairInput): Promise<RouletteResolvedPair | null>;
}

export interface RouletteMatchingEngineDependencies {
  loadTrack(trackId: string): ReturnType<typeof fetchRouletteTrack>;
  loadBeatGrid(trackId: string): ReturnType<typeof fetchTrackBeatGrid>;
  loadCandidates(role: RouletteSourceRole): Promise<RouletteCandidateAnalysis[]>;
  /** Kept optional for dependency compatibility with earlier stages; selection no longer requires pre-generated HQ stems. */
  stemAssets?: Pick<StemAssetService, 'getReadiness'>;
  rng?: () => number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Roulette replacement cancelled.', 'AbortError');
}

function replacementPool(
  candidates: RouletteCandidateAnalysis[],
  reference: RouletteCandidateReference,
  role: RouletteSourceRole,
  hardExcluded: ReadonlySet<string>,
  recentTrackIds: readonly string[],
): RouletteCandidateScore[] {
  const withRecent = new Set(hardExcluded);
  for (const trackId of recentTrackIds) withRecent.add(trackId);
  const preferred = rankRouletteCandidates(candidates, reference, role, withRecent);
  return preferred.length > 0
    ? preferred
    : rankRouletteCandidates(candidates, reference, role, hardExcluded);
}

function eligiblePairPool(
  pairs: RoulettePairScore[],
  input: ResolveRoulettePairInput,
): RoulettePairScore[] {
  const currentFiltered = pairs.filter((pair) => (
    (!input.currentVocalTrackId || pair.vocal.track.id !== input.currentVocalTrackId)
    && (!input.currentInstrumentalTrackId || pair.instrumental.track.id !== input.currentInstrumentalTrackId)
  ));
  if (currentFiltered.length === 0) return currentFiltered;

  const recentVocals = new Set(input.recentVocalTrackIds ?? []);
  const recentInstrumentals = new Set(input.recentInstrumentalTrackIds ?? []);
  const recentPairs = new Set(input.recentPairKeys ?? []);
  const preferred = currentFiltered.filter((pair) => (
    !recentVocals.has(pair.vocal.track.id)
    && !recentInstrumentals.has(pair.instrumental.track.id)
    && !recentPairs.has(roulettePairKey(pair.vocal.track.id, pair.instrumental.track.id))
  ));
  if (preferred.length > 0) return preferred;

  const pairFresh = currentFiltered.filter((pair) => (
    !recentPairs.has(roulettePairKey(pair.vocal.track.id, pair.instrumental.track.id))
  ));
  return pairFresh.length > 0 ? pairFresh : currentFiltered;
}

export function createRouletteMatchingEngine(
  dependencies: RouletteMatchingEngineDependencies = {
    loadTrack: fetchRouletteTrack,
    loadBeatGrid: fetchTrackBeatGrid,
    loadCandidates: fetchRouletteCandidateAnalysis,
  },
): RouletteMatchingEngine {
  const { loadTrack, loadBeatGrid, loadCandidates } = dependencies;
  const rng = dependencies.rng ?? Math.random;

  const resolveReplacement = async (
    input: ResolveRouletteReplacementInput,
  ): Promise<RouletteResolvedSource | null> => {
    throwIfAborted(input.signal);
    const [fixedTrack, fixedBeatGrid, candidates] = await Promise.all([
      loadTrack(input.fixedTrackId),
      loadBeatGrid(input.fixedTrackId),
      loadCandidates(input.role),
    ]);
    throwIfAborted(input.signal);
    if (!fixedTrack) return null;

    const reference: RouletteCandidateReference = { track: fixedTrack, beatGrid: fixedBeatGrid };
    const excluded = new Set<string>([fixedTrack.id]);
    if (input.currentTrackId) excluded.add(input.currentTrackId);
    const pool = replacementPool(candidates, reference, input.role, excluded, input.recentTrackIds ?? []);
    const selected = chooseWeightedRouletteCandidate(pool, rng);
    throwIfAborted(input.signal);
    if (!selected) return null;
    return {
      parentTrackId: selected.candidate.track.id,
      track: selected.candidate.track,
      stemAsset: selected.candidate.stemAsset,
    };
  };

  const resolvePair = async (
    input: ResolveRoulettePairInput = {},
  ): Promise<RouletteResolvedPair | null> => {
    throwIfAborted(input.signal);
    const [vocals, instrumentals] = await Promise.all([
      loadCandidates('vocal'),
      loadCandidates('instrumental'),
    ]);
    throwIfAborted(input.signal);

    const boundedPairs = rankRoulettePairsBounded(vocals, instrumentals);
    const pool = eligiblePairPool(boundedPairs, input);
    const pair = chooseWeightedRoulettePair(pool, rng);
    throwIfAborted(input.signal);
    if (!pair) return null;
    return {
      vocal: {
        parentTrackId: pair.vocal.track.id,
        track: pair.vocal.track,
        stemAsset: pair.vocal.stemAsset,
      },
      instrumental: {
        parentTrackId: pair.instrumental.track.id,
        track: pair.instrumental.track,
        stemAsset: pair.instrumental.stemAsset,
      },
    };
  };

  return { resolveReplacement, resolvePair };
}

export const rouletteMatchingEngine = createRouletteMatchingEngine();
