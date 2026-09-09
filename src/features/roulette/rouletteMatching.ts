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
  | 'variable-tempo'
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

export function hasStableRouletteTempoGrid(beatGrid: BeatGridRow | null): boolean {
  return beatGrid?.is_variable_tempo !== true;
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

  if (!hasStableRouletteTempoGrid(reference.beatGrid) || !hasStableRouletteTempoGrid(candidate.beatGrid)) {
    return 'variable-tempo';
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


export const ROULETTE_PAIR_POOL_LIMIT = 512;
export const ROULETTE_PAIR_PARTNERS_PER_VOCAL = 8;

export interface RoulettePairPoolOptions {
  maxPairs?: number;
  maxPartnersPerVocal?: number;
}

function matchingKeyTokens(track: Pick<RekordboxTrack, 'camelot_key' | 'normalized_key_name'>): string[] {
  const tokens: string[] = [];
  const camelot = parseCamelotKey(track.camelot_key)?.code ?? null;
  if (camelot) tokens.push(`camelot:${camelot}`);
  const normalized = track.normalized_key_name?.trim().toLowerCase();
  if (normalized) tokens.push(`normalized:${normalized}`);
  return [...new Set(tokens)];
}

function compareCandidateBpm(left: RouletteCandidateAnalysis, right: RouletteCandidateAnalysis): number {
  const leftBpm = validBpm(left.track.bpm) ? left.track.bpm : Number.POSITIVE_INFINITY;
  const rightBpm = validBpm(right.track.bpm) ? right.track.bpm : Number.POSITIVE_INFINITY;
  return leftBpm - rightBpm
    || left.track.title.localeCompare(right.track.title)
    || left.track.id.localeCompare(right.track.id);
}

function lowerBoundBpm(values: readonly RouletteCandidateAnalysis[], bpm: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const value = validBpm(values[mid].track.bpm) ? values[mid].track.bpm : Number.POSITIVE_INFINITY;
    if (value < bpm) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBoundBpm(values: readonly RouletteCandidateAnalysis[], bpm: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const value = validBpm(values[mid].track.bpm) ? values[mid].track.bpm : Number.POSITIVE_INFINITY;
    if (value <= bpm) low = mid + 1;
    else high = mid;
  }
  return low;
}

function nearestTempoCandidates(
  values: readonly RouletteCandidateAnalysis[],
  targetBpm: number,
  limit: number,
): RouletteCandidateAnalysis[] {
  if (limit <= 0 || values.length === 0) return [];
  const start = lowerBoundBpm(values, targetBpm - ROULETTE_DIRECT_BPM_TOLERANCE);
  const end = upperBoundBpm(values, targetBpm + ROULETTE_DIRECT_BPM_TOLERANCE);
  if (start >= end) return [];

  const insertion = lowerBoundBpm(values, targetBpm);
  let left = Math.min(end - 1, insertion - 1);
  let right = Math.max(start, insertion);
  const result: RouletteCandidateAnalysis[] = [];

  while (result.length < limit && (left >= start || right < end)) {
    if (left < start) {
      result.push(values[right++]);
      continue;
    }
    if (right >= end) {
      result.push(values[left--]);
      continue;
    }
    const leftDifference = Math.abs((values[left].track.bpm ?? Number.POSITIVE_INFINITY) - targetBpm);
    const rightDifference = Math.abs((values[right].track.bpm ?? Number.POSITIVE_INFINITY) - targetBpm);
    if (leftDifference <= rightDifference) result.push(values[left--]);
    else result.push(values[right++]);
  }
  return result;
}

/**
 * Build a bounded compatible pair pool without expanding vocals × instrumentals.
 * Instrumentals are indexed once by harmonic-key token and BPM; each vocal only
 * inspects its nearest direct-tempo partners before the normal hard filters run.
 */
export function rankRoulettePairsBounded(
  vocals: RouletteCandidateAnalysis[],
  instrumentals: RouletteCandidateAnalysis[],
  options: RoulettePairPoolOptions = {},
): RoulettePairScore[] {
  const maxPairs = Math.max(1, Math.floor(options.maxPairs ?? ROULETTE_PAIR_POOL_LIMIT));
  const maxPartnersPerVocal = Math.max(
    1,
    Math.floor(options.maxPartnersPerVocal ?? ROULETTE_PAIR_PARTNERS_PER_VOCAL),
  );
  const index = new Map<string, RouletteCandidateAnalysis[]>();

  for (const instrumental of instrumentals) {
    for (const token of matchingKeyTokens(instrumental.track)) {
      const bucket = index.get(token);
      if (bucket) bucket.push(instrumental);
      else index.set(token, [instrumental]);
    }
  }
  for (const bucket of index.values()) bucket.sort(compareCandidateBpm);

  const pairs: RoulettePairScore[] = [];
  for (const vocal of vocals) {
    if (pairs.length >= maxPairs) break;
    if (!validBpm(vocal.track.bpm)) continue;

    const possible = new Map<string, RouletteCandidateAnalysis>();
    const probeLimit = maxPartnersPerVocal * 2;
    for (const token of matchingKeyTokens(vocal.track)) {
      const bucket = index.get(token);
      if (!bucket) continue;
      for (const instrumental of nearestTempoCandidates(bucket, vocal.track.bpm, probeLimit)) {
        possible.set(instrumental.track.id, instrumental);
      }
    }

    const compatible: RoulettePairScore[] = [];
    const reference: RouletteCandidateReference = { track: vocal.track, beatGrid: vocal.beatGrid };
    for (const instrumental of possible.values()) {
      if (getRouletteHardFilterReason(instrumental, reference, 'instrumental')) continue;
      const reverseReference: RouletteCandidateReference = {
        track: instrumental.track,
        beatGrid: instrumental.beatGrid,
      };
      if (getRouletteHardFilterReason(vocal, reverseReference, 'vocal')) continue;

      const bpmDifference = rouletteDirectTempoDifference(vocal.track.bpm, instrumental.track.bpm)
        ?? Number.POSITIVE_INFINITY;
      compatible.push({
        vocal,
        instrumental,
        bpmDifference,
        score: scoreRouletteCandidate(vocal, reverseReference, 'vocal')
          + scoreRouletteCandidate(instrumental, reference, 'instrumental'),
      });
    }

    compatible.sort((left, right) => (
      right.score - left.score
      || left.bpmDifference - right.bpmDifference
      || left.instrumental.track.title.localeCompare(right.instrumental.track.title)
      || left.instrumental.track.id.localeCompare(right.instrumental.track.id)
    ));
    pairs.push(...compatible.slice(0, Math.min(maxPartnersPerVocal, maxPairs - pairs.length)));
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
