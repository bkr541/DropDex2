/**
 * Typed Supabase queries for rekordbox_recommendation_edges.
 *
 * All queries enforce user ownership via RLS (import_id → user_id).
 * Never trust user-supplied user_id — RLS enforces ownership.
 * No service-role key is used here; reads go through the anon/user JWT.
 */

import { supabase } from '../supabase';
import type { RekordboxTrack } from '../../types';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RecommendationEdgeRow {
  id: string;
  import_id: string;
  source_track_id: string;
  target_track_id: string;
  rating: number | null;
  source_created_at: string | null;
  relationship_source: string;
  direction_preserved: boolean;
}

export type EdgeDirection = 'outgoing' | 'incoming' | 'reciprocal';

export interface DirectedEdge {
  edge: RecommendationEdgeRow;
  direction: EdgeDirection;
  /** The "other" track's id from the perspective of the selected track */
  otherTrackId: string;
}

// ── Queries ────────────────────────────────────────────────────────────────────

/**
 * Fetch all recommendation edges for a track (both outgoing and incoming),
 * and classify direction. Reciprocal = edges exist in both directions between
 * the same pair of tracks.
 */
export async function fetchRekordboxRecommendationEdges(
  importId: string,
  trackId: string,
): Promise<DirectedEdge[]> {
  const { data, error } = await supabase
    .from('rekordbox_recommendation_edges')
    .select(
      'id, import_id, source_track_id, target_track_id, rating, ' +
      'source_created_at, relationship_source, direction_preserved'
    )
    .eq('import_id', importId)
    .or(`source_track_id.eq.${trackId},target_track_id.eq.${trackId}`)

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as unknown as RecommendationEdgeRow[]

  // Build a set of pair keys where we have outgoing edges from trackId
  // so we can detect reciprocal pairs.
  const outgoingTargets = new Set<string>()
  const incomingSourcesWithEdge = new Set<string>()

  for (const row of rows) {
    if (row.source_track_id === trackId) {
      outgoingTargets.add(row.target_track_id)
    } else {
      incomingSourcesWithEdge.add(row.source_track_id)
    }
  }

  const result: DirectedEdge[] = []

  for (const row of rows) {
    if (row.source_track_id === trackId) {
      const isReciprocal = incomingSourcesWithEdge.has(row.target_track_id)
      result.push({
        edge: row,
        direction: isReciprocal ? 'reciprocal' : 'outgoing',
        otherTrackId: row.target_track_id,
      })
    } else {
      const isReciprocal = outgoingTargets.has(row.source_track_id)
      result.push({
        edge: row,
        direction: isReciprocal ? 'reciprocal' : 'incoming',
        otherTrackId: row.source_track_id,
      })
    }
  }

  return result
}

/**
 * Fetch the full RekordboxTrack rows for tracks that have a recommendation
 * edge to/from the given track. Returns at most `limit` track rows.
 */
export async function fetchRekordboxRecommendedTracks(
  importId: string,
  trackId: string,
  limit = 20,
): Promise<{ track: RekordboxTrack; direction: EdgeDirection; rating: number | null }[]> {
  const edges = await fetchRekordboxRecommendationEdges(importId, trackId)

  if (edges.length === 0) return []

  // Collect unique other-track IDs, keeping the highest-priority direction per pair
  const byOtherTrack = new Map<string, { direction: EdgeDirection; rating: number | null }>()
  for (const { otherTrackId, direction, edge } of edges) {
    const existing = byOtherTrack.get(otherTrackId)
    // reciprocal > outgoing > incoming — keep highest priority
    if (!existing || _directionPriority(direction) > _directionPriority(existing.direction)) {
      byOtherTrack.set(otherTrackId, { direction, rating: edge.rating })
    }
  }

  const otherIds = [...byOtherTrack.keys()].slice(0, limit)
  if (otherIds.length === 0) return []

  const { data, error } = await supabase
    .from('rekordbox_tracks')
    .select('*')
    .eq('import_id', importId)
    .in('id', otherIds)

  if (error) throw new Error(error.message)

  return ((data ?? []) as RekordboxTrack[]).map((track) => {
    const meta = byOtherTrack.get(track.id)!
    return { track, direction: meta.direction, rating: meta.rating }
  })
}

/**
 * Fetch edge evidence between exactly two tracks (for scoring).
 * Returns null if no edge exists.
 */
export async function fetchRecommendationEvidence(
  importId: string,
  sourceTrackId: string,
  targetTrackId: string,
): Promise<{ direction: EdgeDirection; rating: number | null; createdAt: string | null } | null> {
  const { data, error } = await supabase
    .from('rekordbox_recommendation_edges')
    .select('source_track_id, target_track_id, rating, source_created_at')
    .eq('import_id', importId)
    .or(
      `and(source_track_id.eq.${sourceTrackId},target_track_id.eq.${targetTrackId}),` +
      `and(source_track_id.eq.${targetTrackId},target_track_id.eq.${sourceTrackId})`
    )

  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Array<{
    source_track_id: string;
    target_track_id: string;
    rating: number | null;
    source_created_at: string | null;
  }>

  if (rows.length === 0) return null

  const hasForward = rows.some(
    (r) => r.source_track_id === sourceTrackId && r.target_track_id === targetTrackId
  )
  const hasReverse = rows.some(
    (r) => r.source_track_id === targetTrackId && r.target_track_id === sourceTrackId
  )

  let direction: EdgeDirection
  if (hasForward && hasReverse) {
    direction = 'reciprocal'
  } else if (hasForward) {
    direction = 'outgoing'
  } else {
    direction = 'incoming'
  }

  // Use the rating from the forward edge if available, else the reverse
  const ratingRow = rows.find(
    (r) => r.source_track_id === sourceTrackId
  ) ?? rows[0]

  return {
    direction,
    rating: ratingRow.rating,
    createdAt: ratingRow.source_created_at,
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function _directionPriority(d: EdgeDirection): number {
  if (d === 'reciprocal') return 2
  if (d === 'outgoing') return 1
  return 0
}
