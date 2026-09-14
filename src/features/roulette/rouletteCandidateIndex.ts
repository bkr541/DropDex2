import {
  createRouletteCandidateDiagnostics,
  diagnosticReasonForRoulettePair,
  chooseWeightedRoulettePair,
  rankRoulettePairsBounded,
  type RouletteCandidateAnalysis,
  type RouletteCandidateDiagnostics,
  type RoulettePairScore,
} from './rouletteMatching';
import { roulettePairKey } from './rouletteSelectionHistory';
import { fetchRouletteCandidateAnalysis } from '../../lib/queries/rouletteCandidates';

export interface RouletteCandidateIndexSnapshot {
  vocals: RouletteCandidateAnalysis[];
  instrumentals: RouletteCandidateAnalysis[];
  orderedPairs: RoulettePairScore[];
  diagnostics: RouletteCandidateDiagnostics;
}

export interface RouletteInitialPairSelection {
  vocal: RouletteCandidateAnalysis;
  instrumental: RouletteCandidateAnalysis;
  score: number;
  bpmDifference: number;
}

export interface RouletteInitialPairOptions {
  importId?: string;
  recentPairKeys?: readonly string[];
}

export type RouletteInitialPairResult =
  | { status: 'selected'; pair: RouletteInitialPairSelection; diagnostics: RouletteCandidateDiagnostics }
  | { status: 'no-pair'; pair: null; diagnostics: RouletteCandidateDiagnostics };

export interface RouletteCandidateIndexDependencies {
  loadCandidates(role: 'vocal' | 'instrumental', importId?: string): Promise<RouletteCandidateAnalysis[]>;
  rng?: () => number;
}

const EXACT_DIAGNOSTIC_PAIR_LIMIT = 4096;

function buildDiagnostics(
  vocals: RouletteCandidateAnalysis[],
  instrumentals: RouletteCandidateAnalysis[],
  orderedPairs: RoulettePairScore[],
): RouletteCandidateDiagnostics {
  const diagnostics = createRouletteCandidateDiagnostics();
  const possiblePairCount = vocals.length * instrumentals.length;
  if (possiblePairCount <= EXACT_DIAGNOSTIC_PAIR_LIMIT) {
    for (const vocal of vocals) {
      for (const instrumental of instrumentals) {
        diagnostics[diagnosticReasonForRoulettePair(vocal, instrumental)] += 1;
      }
    }
    return diagnostics;
  }

  // Large libraries stay bounded. Structural/source failures are counted once per source
  // track, while the compatible pair count comes from the canonical bounded pair pool.
  for (const candidate of [...vocals, ...instrumentals]) {
    if (!(candidate.track.file_path_normalized ?? candidate.track.file_path)?.trim()) {
      diagnostics['source-unavailable'] += 1;
    } else if (candidate.beatGrid?.is_variable_tempo === true) {
      diagnostics['variable-tempo'] += 1;
    } else if (!candidate.beatGrid || candidate.beatGrid.beats.length === 0) {
      diagnostics['missing-invalid-beat-grid'] += 1;
    }
  }
  diagnostics.eligible = orderedPairs.length;
  return diagnostics;
}

export function createRouletteCandidateIndex(
  dependencies: RouletteCandidateIndexDependencies = {
    loadCandidates: fetchRouletteCandidateAnalysis,
  },
) {
  const rng = dependencies.rng ?? Math.random;

  const build = async (importId?: string): Promise<RouletteCandidateIndexSnapshot> => {
    const [vocals, instrumentals] = await Promise.all([
      dependencies.loadCandidates('vocal', importId),
      dependencies.loadCandidates('instrumental', importId),
    ]);
    const orderedPairs = rankRoulettePairsBounded(vocals, instrumentals);
    return {
      vocals,
      instrumentals,
      orderedPairs,
      diagnostics: buildDiagnostics(vocals, instrumentals, orderedPairs),
    };
  };

  const selectInitialPair = async (
    options: RouletteInitialPairOptions | string = {},
  ): Promise<RouletteInitialPairResult> => {
    const normalizedOptions = typeof options === 'string' ? { importId: options } : options;
    const snapshot = await build(normalizedOptions.importId);
    const recentPairKeys = new Set(normalizedOptions.recentPairKeys ?? []);
    const freshPairs = snapshot.orderedPairs.filter((pair) => (
      !recentPairKeys.has(roulettePairKey(pair.vocal.track.id, pair.instrumental.track.id))
    ));
    const pool = freshPairs.length > 0 ? freshPairs : snapshot.orderedPairs;
    const selected = chooseWeightedRoulettePair(pool, rng);
    if (!selected) return { status: 'no-pair', pair: null, diagnostics: snapshot.diagnostics };
    return {
      status: 'selected',
      pair: {
        vocal: selected.vocal,
        instrumental: selected.instrumental,
        score: selected.score,
        bpmDifference: selected.bpmDifference,
      },
      diagnostics: snapshot.diagnostics,
    };
  };

  return { build, selectInitialPair };
}

export const rouletteCandidateIndex = createRouletteCandidateIndex();
