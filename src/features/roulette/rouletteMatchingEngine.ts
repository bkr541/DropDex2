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
} from './rouletteMatching';
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
  signal?: AbortSignal;
}

export interface ResolveRoulettePairInput {
  currentVocalTrackId?: string | null;
  currentInstrumentalTrackId?: string | null;
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
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Roulette replacement cancelled.', 'AbortError');
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

export function createRouletteMatchingEngine(
  dependencies: RouletteMatchingEngineDependencies = {
    loadTrack: fetchRouletteTrack,
    loadBeatGrid: fetchTrackBeatGrid,
    loadCandidates: fetchRouletteCandidateAnalysis,
    stemAssets: rouletteStemAssetService,
  },
): RouletteMatchingEngine {
  const { loadTrack, loadBeatGrid, loadCandidates, stemAssets } = dependencies;

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
    const ranked = rankRouletteCandidates(candidates, reference, input.role, excluded);

    for (const scored of ranked) {
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

    const ranked = rankRoulettePairs(vocals, instrumentals).filter((pair) => (
      (!input.currentVocalTrackId || pair.vocal.track.id !== input.currentVocalTrackId)
      && (!input.currentInstrumentalTrackId || pair.instrumental.track.id !== input.currentInstrumentalTrackId)
    ));

    for (const pair of ranked) {
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
