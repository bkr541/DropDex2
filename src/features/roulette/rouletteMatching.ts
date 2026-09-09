import type { RekordboxTrack } from '../../types';
import { isUsableBeatGrid } from '../../lib/music/beatGridHelpers';
import { parseCamelotKey } from '../../lib/music/camelot';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import type { StemAssetRecord, StemAssetType } from './stemAssets';
import { stemTypeForRole } from './stemAssets';
import type { RouletteSourceRole } from './rouletteSession';
import {
  isRouletteTempoRatioSupported,
  ROULETTE_DIRECT_BPM_TOLERANCE,
} from './rouletteTempoSync';

export { ROULETTE_DIRECT_BPM_TOLERANCE } from './rouletteTempoSync';

export interface RouletteCandidateAnalysis {
  track: RekordboxTrack;
  stemAsset: StemAssetRecord;
  beatGrid: BeatGridRow | null;
  phraseCount: number;
  vocalAnalysisAvailable: boolean;
}

export interface RouletteCandidateReference {
  track: RekordboxTrack;
  beatGrid: BeatGridRow | null;
}

export interface RouletteCandidateScore {
  candidate: RouletteCandidateAnalysis;
  score: number;
  bpmDifference: number;
}

export interface RoulettePairScore {
  vocal: RouletteCandidateAnalysis;
  instrumental: RouletteCandidateAnalysis;
  score: number;
  bpmDifference: number;
}

export type RouletteHardFilterReason =
  | 'invalid-parent-track'
  | 'wrong-stem-type'
  | 'stem-not-ready'
  | 'missing-key'
  | 'key-mismatch'
  | 'missing-bpm'
  | 'tempo-mismatch'
  | 'tempo-ratio-out-of-range'
  | 'missing-beat-grid'
  | 'same-parent-track'
  | 'excluded-parent-track';

function validBpm(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function exactKeyRelationship(
  reference: Pick<RekordboxTrack, 'camelot_key' | 'normalized_key_name'>,
  candidate: Pick<RekordboxTrack, 'camelot_key' | 'normalized_key_name'>,
): 'exact' | 'mismatch' | 'missing' {
  const referenceCamelot = parseCamelotKey(reference.camelot_key)?.code ?? null;
  const candidateCamelot = parseCamelotKey(candidate.camelot_key)?.code ?? null;
  if (referenceCamelot && candidateCamelot) {
    return referenceCamelot === candidateCamelot ? 'exact' : 'mismatch';
  }

  const referenceNormalized = reference.normalized_key_name?.trim().toLowerCase() || null;
  const candidateNormalized = candidate.normalized_key_name?.trim().toLowerCase() || null;
  if (referenceNormalized && candidateNormalized) {
    return referenceNormalized === candidateNormalized ? 'exact' : 'mismatch';
  }
  return 'missing';
}

export function rouletteDirectTempoDifference(
  referenceBpm: number | null | undefined,
  candidateBpm: number | null | undefined,
): number | null {
  if (!validBpm(referenceBpm) || !validBpm(candidateBpm)) return null;
  return Math.abs(referenceBpm - candidateBpm);
}

export function isRouletteDirectTempoCompatible(
  referenceBpm: number | null | undefined,
  candidateBpm: number | null | undefined,
  tolerance = ROULETTE_DIRECT_BPM_TOLERANCE,
): boolean {
  const difference = rouletteDirectTempoDifference(referenceBpm, candidateBpm);
  return difference != null && difference <= Math.max(0, tolerance) + 1e-9;
}

export function hasUsableRouletteBeatGrid(beatGrid: BeatGridRow | null): boolean {
  return beatGrid != null && isUsableBeatGrid(beatGrid.beats);
}

function expectedStemType(role: RouletteSourceRole): StemAssetType {
  return stemTypeForRole(role);
}

export function getRouletteHardFilterReason(
  candidate: RouletteCandidateAnalysis,
  reference: RouletteCandidateReference,
  role: RouletteSourceRole,
  excludedTrackIds: ReadonlySet<string> = new Set(),
): RouletteHardFilterReason | null {
  const candidateId = candidate.track.id?.trim();
  const referenceId = reference.track.id?.trim();
  if (!candidateId || !referenceId) return 'invalid-parent-track';
  if (candidate.stemAsset.stem_type !== expectedStemType(role)) return 'wrong-stem-type';
  if (candidate.stemAsset.status !== 'ready') return 'stem-not-ready';
  if (candidateId === referenceId) return 'same-parent-track';
  if (excludedTrackIds.has(candidateId)) return 'excluded-parent-track';

  const keyRelationship = exactKeyRelationship(reference.track, candidate.track);
  if (keyRelationship === 'missing') return 'missing-key';
  if (keyRelationship === 'mismatch') return 'key-mismatch';

  if (!validBpm(reference.track.bpm) || !validBpm(candidate.track.bpm)) return 'missing-bpm';
  if (!isRouletteDirectTempoCompatible(reference.track.bpm, candidate.track.bpm)) {
    return 'tempo-mismatch';
  }
  if (!isRouletteTempoRatioSupported(candidate.track.bpm, reference.track.bpm)) {
    return 'tempo-ratio-out-of-range';
  }

  if (!hasUsableRouletteBeatGrid(reference.beatGrid) || !hasUsableRouletteBeatGrid(candidate.beatGrid)) {
    return 'missing-beat-grid';
  }

  return null;
}

function normalizedText(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function scoreRouletteCandidate(
  candidate: RouletteCandidateAnalysis,
  reference: RouletteCandidateReference,
  role: RouletteSourceRole,
): number {
  const bpmDifference = rouletteDirectTempoDifference(reference.track.bpm, candidate.track.bpm) ?? Number.POSITIVE_INFINITY;
  const proximity = Number.isFinite(bpmDifference)
    ? Math.max(0, 1 - bpmDifference / Math.max(ROULETTE_DIRECT_BPM_TOLERANCE, 1e-9))
    : 0;

  let score = proximity * 100;
  if (candidate.phraseCount > 0) score += 8;
  if (role === 'vocal' && candidate.vocalAnalysisAvailable) score += 10;

  const referenceGenre = normalizedText(reference.track.genre);
  const candidateGenre = normalizedText(candidate.track.genre);
  if (referenceGenre && candidateGenre === referenceGenre) score += 6;

  const referenceLabel = normalizedText(reference.track.label);
  const candidateLabel = normalizedText(candidate.track.label);
  if (referenceLabel && candidateLabel === referenceLabel) score += 3;

  return score;
}

export function rankRouletteCandidates(
  candidates: RouletteCandidateAnalysis[],
  reference: RouletteCandidateReference,
  role: RouletteSourceRole,
  excludedTrackIds: ReadonlySet<string> = new Set(),
): RouletteCandidateScore[] {
  return candidates
    .flatMap((candidate) => {
      if (getRouletteHardFilterReason(candidate, reference, role, excludedTrackIds)) return [];
      return [{
        candidate,
        score: scoreRouletteCandidate(candidate, reference, role),
        bpmDifference: rouletteDirectTempoDifference(reference.track.bpm, candidate.track.bpm) ?? Number.POSITIVE_INFINITY,
      }];
    })
    .sort((left, right) => (
      right.score - left.score
      || left.bpmDifference - right.bpmDifference
      || left.candidate.track.title.localeCompare(right.candidate.track.title)
      || left.candidate.track.id.localeCompare(right.candidate.track.id)
    ));
}

export function rankRoulettePairs(
  vocals: RouletteCandidateAnalysis[],
  instrumentals: RouletteCandidateAnalysis[],
): RoulettePairScore[] {
  const pairs: RoulettePairScore[] = [];

  for (const vocal of vocals) {
    const reference: RouletteCandidateReference = {
      track: vocal.track,
      beatGrid: vocal.beatGrid,
    };
    for (const instrumental of instrumentals) {
      if (getRouletteHardFilterReason(instrumental, reference, 'instrumental')) continue;
      const reverseReference: RouletteCandidateReference = {
        track: instrumental.track,
        beatGrid: instrumental.beatGrid,
      };
      if (getRouletteHardFilterReason(vocal, reverseReference, 'vocal')) continue;

      const bpmDifference = rouletteDirectTempoDifference(vocal.track.bpm, instrumental.track.bpm) ?? Number.POSITIVE_INFINITY;
      const score = scoreRouletteCandidate(vocal, reverseReference, 'vocal')
        + scoreRouletteCandidate(instrumental, reference, 'instrumental');
      pairs.push({ vocal, instrumental, score, bpmDifference });
    }
  }

  return pairs.sort((left, right) => (
    right.score - left.score
    || left.bpmDifference - right.bpmDifference
    || left.vocal.track.title.localeCompare(right.vocal.track.title)
    || left.instrumental.track.title.localeCompare(right.instrumental.track.title)
    || left.vocal.track.id.localeCompare(right.vocal.track.id)
    || left.instrumental.track.id.localeCompare(right.instrumental.track.id)
  ));
}
