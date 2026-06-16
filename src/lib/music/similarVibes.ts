import { classifyCamelotRelationship } from './camelot'
import type { RekordboxTrack, RecommendationReason, SimilarTrackResult, RekordboxEvidence } from '../../types'
import type { EdgeDirection } from '../queries/recommendations'

// ── Constants ──────────────────────────────────────────────────────────────────

/** Maximum BPM delta used when matching tracks by tempo. */
export const BPM_TOLERANCE_DEFAULT = 2

/** Maximum candidates to request from the database before in-TypeScript ranking. */
export const SIMILAR_CANDIDATE_FETCH_LIMIT = 20

/** Maximum ranked results to return to the caller. */
export const SIMILAR_TRACKS_LIMIT = 5

// ── Score constants ────────────────────────────────────────────────────────────

export const SCORE_RECIPROCAL_BONUS = 40
export const SCORE_OUTGOING_BONUS = 25
export const SCORE_INCOMING_BONUS = 10
export const SCORE_RATING_MULTIPLIER = 3
export const SCORE_CAMELOT_EXACT = 30
export const SCORE_CAMELOT_RELATIVE = 25
export const SCORE_CAMELOT_ADJACENT = 20
export const SCORE_CAMELOT_ENERGY_BOOST = 12
export const SCORE_BPM_MAX = 10
export const SCORE_SAME_GENRE = 5
export const SCORE_SAME_LABEL = 3

// ── Utility ────────────────────────────────────────────────────────────────────

export interface RankableTrack {
  id: string;
  title: string;
  bpm: number | null;
}

/** Returns true when `bpm` is a usable positive number (0 = unanalyzed in Rekordbox). */
export function shouldUseBpm(bpm: number | null | undefined): bpm is number {
  return bpm != null && bpm > 0
}

/**
 * Returns true when the track has at least one signal (key or BPM) that can
 * drive a Similar Vibes query. When false, no DB fetch is needed.
 */
export function hasSimilarVibesSignal(
  key: string | null | undefined,
  bpm: number | null | undefined,
): boolean {
  return Boolean(key) || shouldUseBpm(bpm)
}

// ── Scoring ────────────────────────────────────────────────────────────────────

export interface ScoreInput {
  selected: RekordboxTrack;
  candidate: RekordboxTrack;
  bpmTolerance: number;
  edge?: { direction: EdgeDirection; rating: number | null; createdAt: string | null } | null;
}

/**
 * Classify one candidate against a selected track and compute a score + reasons.
 *
 * Scoring signals (all additive):
 *   rekordbox edge direction bonus
 *   rating bonus
 *   camelot wheel relationship
 *   BPM proximity (within tolerance)
 *   same genre
 *   same label
 */
export function scoreCandidate(input: ScoreInput): SimilarTrackResult {
  const { selected, candidate, bpmTolerance, edge } = input
  let score = 0
  const reasons: RecommendationReason[] = []
  let rekordboxEvidence: RekordboxEvidence | undefined

  // ── Rekordbox edge bonus ─────────────────────────────────────────────────────
  if (edge) {
    rekordboxEvidence = {
      rating: edge.rating,
      direction: edge.direction,
      createdAt: edge.createdAt,
      relationshipSource: 'recommended_like',
    }

    let directionBonus: number
    if (edge.direction === 'reciprocal') {
      directionBonus = SCORE_RECIPROCAL_BONUS
    } else if (edge.direction === 'outgoing') {
      directionBonus = SCORE_OUTGOING_BONUS
    } else {
      directionBonus = SCORE_INCOMING_BONUS
    }

    score += directionBonus

    const ratingBonus = (edge.rating != null && edge.rating > 0)
      ? edge.rating * SCORE_RATING_MULTIPLIER
      : 0
    score += ratingBonus

    reasons.push({
      kind: 'rekordbox_match',
      label: edge.direction === 'reciprocal' ? 'Reciprocal match' : 'Rekordbox match',
      score: directionBonus,
    })
  }

  // ── Camelot relationship ─────────────────────────────────────────────────────
  const camelotRel = classifyCamelotRelationship(selected.camelot_key, candidate.camelot_key)
  switch (camelotRel) {
    case 'exact':
      score += SCORE_CAMELOT_EXACT
      reasons.push({ kind: 'same_camelot', label: 'Same Camelot key', score: SCORE_CAMELOT_EXACT })
      break
    case 'relative':
      score += SCORE_CAMELOT_RELATIVE
      reasons.push({ kind: 'relative_key', label: 'Relative major/minor', score: SCORE_CAMELOT_RELATIVE })
      break
    case 'adjacent_up':
    case 'adjacent_down':
      score += SCORE_CAMELOT_ADJACENT
      reasons.push({ kind: 'adjacent_camelot', label: 'Adjacent Camelot key', score: SCORE_CAMELOT_ADJACENT })
      break
    case 'energy_boost':
      score += SCORE_CAMELOT_ENERGY_BOOST
      reasons.push({ kind: 'energy_boost', label: 'Energy boost', score: SCORE_CAMELOT_ENERGY_BOOST })
      break
    default:
      // incompatible or unknown: no camelot bonus
      break
  }

  // ── BPM proximity ────────────────────────────────────────────────────────────
  if (shouldUseBpm(selected.bpm) && shouldUseBpm(candidate.bpm)) {
    const diff = Math.abs(candidate.bpm - selected.bpm)
    if (diff <= bpmTolerance) {
      const bpmScore = SCORE_BPM_MAX * (1 - diff / bpmTolerance)
      score += bpmScore
      reasons.push({
        kind: 'bpm_proximity',
        label: diff === 0 ? 'Same BPM' : `±${diff.toFixed(1)} BPM`,
        score: bpmScore,
      })
    }
  }

  // ── Same genre ───────────────────────────────────────────────────────────────
  if (
    selected.genre != null &&
    candidate.genre != null &&
    selected.genre.trim().toLowerCase() === candidate.genre.trim().toLowerCase()
  ) {
    score += SCORE_SAME_GENRE
    reasons.push({ kind: 'same_genre', label: 'Same genre', score: SCORE_SAME_GENRE })
  }

  // ── Same label ───────────────────────────────────────────────────────────────
  if (
    selected.label != null &&
    candidate.label != null &&
    selected.label.trim().toLowerCase() === candidate.label.trim().toLowerCase()
  ) {
    score += SCORE_SAME_LABEL
    reasons.push({ kind: 'same_label', label: 'Same label', score: SCORE_SAME_LABEL })
  }

  return {
    track: candidate,
    recommendationScore: score,
    reasons,
    rekordboxEvidence,
  }
}

// ── Merge and rank ─────────────────────────────────────────────────────────────

/**
 * Merge two candidate arrays (from recommendation edges + from DB key/BPM query).
 * Deduplicate by track.id. For duplicates, keep whichever has the higher score.
 */
export function mergeCandidates(
  edgeCandidates: SimilarTrackResult[],
  dbCandidates: SimilarTrackResult[],
): SimilarTrackResult[] {
  const byId = new Map<string, SimilarTrackResult>()

  for (const result of [...edgeCandidates, ...dbCandidates]) {
    const existing = byId.get(result.track.id)
    if (!existing || result.recommendationScore > existing.recommendationScore) {
      byId.set(result.track.id, result)
    }
  }

  return [...byId.values()]
}

/**
 * Final rank: sort by recommendationScore DESC, then title ASC. Slice to limit.
 */
export function rankScoredCandidates(
  candidates: SimilarTrackResult[],
  limit = SIMILAR_TRACKS_LIMIT,
): SimilarTrackResult[] {
  return candidates
    .slice()
    .sort((a, b) => {
      if (b.recommendationScore !== a.recommendationScore) {
        return b.recommendationScore - a.recommendationScore
      }
      return a.track.title.localeCompare(b.track.title)
    })
    .slice(0, limit)
}

// ── Legacy path ────────────────────────────────────────────────────────────────

/**
 * Legacy BPM-only ranking used by the old fetchSimilarTracks path.
 * Kept for backward compatibility while the new hook takes over.
 *
 * @deprecated Use scoreCandidate + mergeCandidates + rankScoredCandidates instead.
 */
export function rankSimilarTracks<T extends RankableTrack>(
  candidates: T[],
  selectedId: string,
  selectedBpm: number | null | undefined,
  bpmTolerance = BPM_TOLERANCE_DEFAULT,
  limit = SIMILAR_TRACKS_LIMIT,
): T[] {
  return candidates
    .filter((c) => {
      if (c.id === selectedId) return false
      if (shouldUseBpm(selectedBpm)) {
        if (c.bpm == null) return false
        return c.bpm >= selectedBpm - bpmTolerance && c.bpm <= selectedBpm + bpmTolerance
      }
      return true
    })
    .sort((a, b) => {
      if (shouldUseBpm(selectedBpm)) {
        const aDiff = Math.abs((a.bpm ?? Infinity) - selectedBpm)
        const bDiff = Math.abs((b.bpm ?? Infinity) - selectedBpm)
        if (aDiff !== bDiff) return aDiff - bDiff
      }
      return a.title.localeCompare(b.title)
    })
    .slice(0, limit)
}
