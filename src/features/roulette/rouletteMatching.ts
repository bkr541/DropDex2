import type { RekordboxTrack } from '../../types';
import { isUsableBeatGrid } from '../../lib/music/beatGridHelpers';
import { classifyCamelotRelationship, parseCamelotKey } from '../../lib/music/camelot';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import type { StemAssetRecord, StemAssetType } from './stemAssets';
import { stemTypeForRole } from './stemAssets';
import type { RouletteSourceRole } from './rouletteSession';
export const ROULETTE_DIRECT_BPM_TOLERANCE = 5;

export interface RouletteCandidateAnalysis {
  track: RekordboxTrack;
  stemAsset: StemAssetRecord | null;
  beatGrid: BeatGridRow | null;
  phraseCount: number;
  vocalAnalysisAvailable: boolean;
  vocalPresenceScore?: number | null;
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
  | 'missing-key'
  | 'key-mismatch'
  | 'missing-bpm'
  | 'tempo-mismatch'
  | 'variable-tempo'
  | 'missing-beat-grid'
  | 'same-parent-track'
  | 'excluded-parent-track'
  | 'source-unavailable';

function validBpm(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function rouletteKeyRelationship(
  reference: Pick<RekordboxTrack, 'camelot_key'>,
  candidate: Pick<RekordboxTrack, 'camelot_key'>,
): 'exact' | 'branch' | 'mismatch' | 'missing' {
  const referenceCamelot = parseCamelotKey(reference.camelot_key)?.code ?? null;
  const candidateCamelot = parseCamelotKey(candidate.camelot_key)?.code ?? null;
  if (!referenceCamelot || !candidateCamelot) return 'missing';
  const relationship = classifyCamelotRelationship(referenceCamelot, candidateCamelot);
  if (relationship === 'exact') return 'exact';
  if (relationship === 'relative' || relationship === 'adjacent_up' || relationship === 'adjacent_down') {
    return 'branch';
  }
  return 'mismatch';
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
  if (candidate.stemAsset && candidate.stemAsset.stem_type !== expectedStemType(role)) return 'wrong-stem-type';
  if (candidateId === referenceId) return 'same-parent-track';
  if (excludedTrackIds.has(candidateId)) return 'excluded-parent-track';
  if (!(candidate.track.file_path_normalized ?? candidate.track.file_path)?.trim()
    || !(reference.track.file_path_normalized ?? reference.track.file_path)?.trim()) return 'source-unavailable';

  const keyRelationship = rouletteKeyRelationship(reference.track, candidate.track);
  if (keyRelationship === 'missing') return 'missing-key';
  if (keyRelationship === 'mismatch') return 'key-mismatch';

  if (!validBpm(reference.track.bpm) || !validBpm(candidate.track.bpm)) return 'missing-bpm';
  if (!isRouletteDirectTempoCompatible(reference.track.bpm, candidate.track.bpm)) {
    return 'tempo-mismatch';
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

  const keyRelationship = rouletteKeyRelationship(reference.track, candidate.track);
  let score = keyRelationship === 'exact' ? 140 : keyRelationship === 'branch' ? 110 : 0;
  score += proximity * 60;
  if (candidate.phraseCount > 0) score += 10;
  if ((candidate.beatGrid?.downbeat_count ?? candidate.beatGrid?.beats.filter((beat) => beat.isDownbeat).length ?? 0) > 0) score += 6;
  if (role === 'vocal' && candidate.vocalAnalysisAvailable) score += 8;
  if (role === 'vocal' && candidate.vocalPresenceScore != null) {
    score += Math.max(0, Math.min(1, candidate.vocalPresenceScore)) * 18;
  }
  if (candidate.stemAsset?.status === 'ready') score += 6;

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


export type RouletteCandidateDiagnosticReason =
  | 'eligible'
  | 'incompatible-key'
  | 'bpm-outside-range'
  | 'missing-invalid-beat-grid'
  | 'variable-tempo'
  | 'same-parent-conflict'
  | 'source-unavailable';

export type RouletteCandidateDiagnostics = Record<RouletteCandidateDiagnosticReason, number>;

export function createRouletteCandidateDiagnostics(): RouletteCandidateDiagnostics {
  return {
    eligible: 0,
    'incompatible-key': 0,
    'bpm-outside-range': 0,
    'missing-invalid-beat-grid': 0,
    'variable-tempo': 0,
    'same-parent-conflict': 0,
    'source-unavailable': 0,
  };
}

export function diagnosticReasonForRoulettePair(
  vocal: RouletteCandidateAnalysis,
  instrumental: RouletteCandidateAnalysis,
): RouletteCandidateDiagnosticReason {
  if (vocal.track.id === instrumental.track.id) return 'same-parent-conflict';
  if (!(vocal.track.file_path_normalized ?? vocal.track.file_path)?.trim()
    || !(instrumental.track.file_path_normalized ?? instrumental.track.file_path)?.trim()) {
    return 'source-unavailable';
  }
  if (!hasStableRouletteTempoGrid(vocal.beatGrid) || !hasStableRouletteTempoGrid(instrumental.beatGrid)) {
    return 'variable-tempo';
  }
  if (!hasUsableRouletteBeatGrid(vocal.beatGrid) || !hasUsableRouletteBeatGrid(instrumental.beatGrid)) {
    return 'missing-invalid-beat-grid';
  }
  const relationship = rouletteKeyRelationship(vocal.track, instrumental.track);
  if (relationship === 'missing' || relationship === 'mismatch') return 'incompatible-key';
  if (!isRouletteDirectTempoCompatible(vocal.track.bpm, instrumental.track.bpm)) return 'bpm-outside-range';
  return 'eligible';
}

export function chooseWeightedRouletteCandidate(
  orderedCandidates: readonly RouletteCandidateScore[],
  rng: () => number = Math.random,
): RouletteCandidateScore | null {
  if (orderedCandidates.length === 0) return null;
  const floor = Math.min(...orderedCandidates.map((candidate) => candidate.score));
  const weights = orderedCandidates.map((candidate, index) => (
    Math.max(1, candidate.score - floor + 1) / (1 + index * 0.08)
  ));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const rawSample = rng();
  const sample = Math.min(0.999999999, Math.max(0, Number.isFinite(rawSample) ? rawSample : 0));
  let cursor = sample * total;
  for (let index = 0; index < orderedCandidates.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return orderedCandidates[index];
  }
  return orderedCandidates[orderedCandidates.length - 1];
}


export function chooseWeightedRoulettePair(
  orderedPairs: readonly RoulettePairScore[],
  rng: () => number = Math.random,
): RoulettePairScore | null {
  if (orderedPairs.length === 0) return null;
  const floor = Math.min(...orderedPairs.map((pair) => pair.score));
  const weights = orderedPairs.map((pair, index) => Math.max(1, pair.score - floor + 1) / (1 + index * 0.08));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const rawSample = rng();
  const sample = Math.min(0.999999999, Math.max(0, Number.isFinite(rawSample) ? rawSample : 0));
  let cursor = sample * total;
  for (let index = 0; index < orderedPairs.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return orderedPairs[index];
  }
  return orderedPairs[orderedPairs.length - 1];
}


export const ROULETTE_PAIR_POOL_LIMIT = 512;
export const ROULETTE_PAIR_PARTNERS_PER_VOCAL = 8;

export interface RoulettePairPoolOptions {
  maxPairs?: number;
  maxPartnersPerVocal?: number;
}

function exactKeyToken(track: Pick<RekordboxTrack, 'camelot_key'>): string | null {
  const key = parseCamelotKey(track.camelot_key);
  return key ? `camelot:${key.code}` : null;
}

function compatibleKeyTokens(track: Pick<RekordboxTrack, 'camelot_key'>): string[] {
  const key = parseCamelotKey(track.camelot_key);
  if (!key) return [];
  const wrap = (number: number) => ((number - 1 + 12) % 12) + 1;
  const opposite = key.mode === 'A' ? 'B' : 'A';
  return [
    `camelot:${key.number}${key.mode}`,
    `camelot:${wrap(key.number - 1)}${key.mode}`,
    `camelot:${wrap(key.number + 1)}${key.mode}`,
    `camelot:${key.number}${opposite}`,
  ];
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
    const token = exactKeyToken(instrumental.track);
    if (!token) continue;
    const bucket = index.get(token);
    if (bucket) bucket.push(instrumental);
    else index.set(token, [instrumental]);
  }
  for (const bucket of index.values()) bucket.sort(compareCandidateBpm);

  const pairs: RoulettePairScore[] = [];
  for (const vocal of vocals) {
    if (pairs.length >= maxPairs) break;
    if (!validBpm(vocal.track.bpm)) continue;

    const possible = new Map<string, RouletteCandidateAnalysis>();
    const probeLimit = maxPartnersPerVocal * 2;
    for (const token of compatibleKeyTokens(vocal.track)) {
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
