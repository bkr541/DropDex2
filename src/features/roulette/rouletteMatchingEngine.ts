import { fetchTrackBeatGrid } from '../../lib/queries/analysisData';
import {
  fetchRouletteCandidateAnalysis,
  fetchRouletteTrack,
} from '../../lib/queries/rouletteCandidates';
import {
  rankRouletteCandidates,
  rankRoulettePairs,
  type RouletteCandidateAnalysis,
  type RouletteCandidateReference,
  type RouletteCandidateScore,
  type RoulettePairScore,
} from './rouletteMatching';
import { roulettePairKey } from './rouletteSelectionHistory';
import { rouletteStemAssetService, type StemAssetService } from './stemAssetService';
import { ROULETTE_SEPARATOR_VERSION, stemTypeForRole, type StemAssetRecord } from './stemAssets';
import type { RouletteSourceRole } from './rouletteSession';

export interface RouletteResolvedSource {
  parentTrackId: string;
  stemAsset: StemAssetRecord;
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
  stemAssets: Pick<StemAssetService, 'getReadiness'>;
  rng?: () => number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Roulette replacement cancelled.', 'AbortError');
}

function boundedRandomIndex(length: number, rng: () => number): number {
  if (length <= 1) return 0;
  const value = rng();
  if (!Number.isFinite(value)) return 0;
  return Math.min(length - 1, Math.max(0, Math.floor(value * length)));
}

function randomizedOrder<T>(values: readonly T[], rng: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = boundedRandomIndex(index + 1, rng);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

async function validateReadySource(
  candidate: RouletteCandidateAnalysis,
  role: RouletteSourceRole,
  stemAssets: Pick<StemAssetService, 'getReadiness'>,
  signal?: AbortSignal,
): Promise<RouletteResolvedSource | null> {
  throwIfAborted(signal);
  const readiness = await stemAssets.getReadiness(candidate.track.id, stemTypeForRole(role), {
    expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION,
  });
  throwIfAborted(signal);
  if (readiness.status !== 'ready' || !readiness.asset) return null;
  return { parentTrackId: candidate.track.id, stemAsset: readiness.asset };
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
    stemAssets: rouletteStemAssetService,
  },
): RouletteMatchingEngine {
  const { loadTrack, loadBeatGrid, loadCandidates, stemAssets } = dependencies;
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

    const fixedRole: RouletteSourceRole = input.role === 'vocal' ? 'instrumental' : 'vocal';
    const fixedReadiness = await stemAssets.getReadiness(
      fixedTrack.id,
      stemTypeForRole(fixedRole),
      { expectedSeparatorVersion: ROULETTE_SEPARATOR_VERSION },
    );
    throwIfAborted(input.signal);
    if (fixedReadiness.status !== 'ready' || !fixedReadiness.asset) return null;

    const reference: RouletteCandidateReference = { track: fixedTrack, beatGrid: fixedBeatGrid };
    const excluded = new Set<string>([fixedTrack.id]);
    if (input.currentTrackId) excluded.add(input.currentTrackId);
    const pool = replacementPool(candidates, reference, input.role, excluded, input.recentTrackIds ?? []);

    for (const scored of randomizedOrder(pool, rng)) {
      const resolved = await validateReadySource(scored.candidate, input.role, stemAssets, input.signal);
      if (resolved) return resolved;
    }
    return null;
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

    const pool = eligiblePairPool(rankRoulettePairs(vocals, instrumentals), input);
    for (const pair of randomizedOrder(pool, rng)) {
      const vocal = await validateReadySource(pair.vocal, 'vocal', stemAssets, input.signal);
      if (!vocal) continue;
      const instrumental = await validateReadySource(
        pair.instrumental,
        'instrumental',
        stemAssets,
        input.signal,
      );
      if (!instrumental) continue;
      return { vocal, instrumental };
    }
    return null;
  };

  return { resolveReplacement, resolvePair };
}

export const rouletteMatchingEngine = createRouletteMatchingEngine();
