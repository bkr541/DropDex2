import { trackIdentityKey } from '../../lib/preview/trackIdentity';
import { fetchTracksByIds, type LibraryTrackFilters } from '../../lib/queries/rekordbox';
import type { RekordboxTrack } from '../../types';
import { fetchSetLabRecommendations, visitSetLabLibraryTracks, type SetLabRecommendation } from './candidateProvider';
import { reverseSetLabRecommendation, scoreSetLabTrackPair, type SetLabPairScore } from './generationCompatibility';
import type { SetLabDraft } from './session';

const BPM_TOLERANCE = 6;

export interface SetLabSwapContext {
  key: string;
  tracks: ReadonlyMap<string, RekordboxTrack>;
  recommendations: ReadonlyMap<string, ReadonlyMap<string, SetLabRecommendation>>;
  partial: boolean;
}

export function swapContextKey(draft: SetLabDraft): string | null {
  return draft.selectedSlot == null ? null : JSON.stringify([
    draft.userId, draft.sourceImportId, draft.selectedSlot, draft.slots.map(({ trackId, trackIdentityKey }) => [trackId, trackIdentityKey]),
  ]);
}

export function swapUnavailableReason(draft: SetLabDraft, track: RekordboxTrack): string | null {
  if (draft.selectedSlot == null) return 'Select a slot in a generated set first.';
  if (!track.id || track.import_id !== draft.sourceImportId) return 'This track is outside the active Rekordbox import.';
  const identity = trackIdentityKey(track);
  const used = draft.slots.find((slot) => slot.trackId === track.id || slot.trackIdentityKey === identity);
  if (!used) return null;
  return used.position === draft.selectedSlot
    ? 'This track is already selected for this slot.'
    : `This track already occupies slot ${used.position}.`;
}

export async function loadSetLabSwapContext(draft: SetLabDraft, signal: AbortSignal): Promise<SetLabSwapContext> {
  const key = swapContextKey(draft);
  if (!key || draft.selectedSlot == null) throw new Error('Select a slot before loading swap candidates.');
  const selected = draft.selectedSlot;
  const rows = await fetchTracksByIds(draft.slots.map(({ trackId }) => trackId), signal);
  signal.throwIfAborted();
  const expected = new Map(draft.slots.map(({ trackId, trackIdentityKey }) => [trackId, trackIdentityKey] as const));
  const tracks = new Map(rows.filter((track) => track.import_id === draft.sourceImportId
    && expected.get(track.id) === trackIdentityKey(track)).map((track) => [track.id, track]));
  const anchors = draft.slots.filter((slot) => Math.abs(slot.position - selected) <= 1 && tracks.has(slot.trackId));
  const recommendations = new Map<string, ReadonlyMap<string, SetLabRecommendation>>();
  let partial = false;
  await Promise.all(anchors.map(async ({ trackId }) => {
    try {
      recommendations.set(trackId, await fetchSetLabRecommendations(draft, trackId, signal));
    } catch {
      signal.throwIfAborted();
      partial = true;
    }
  }));
  signal.throwIfAborted();
  return { key, tracks, recommendations, partial };
}

export function swapTrackPair(context: SetLabSwapContext, left?: RekordboxTrack, right?: RekordboxTrack): SetLabPairScore | null {
  if (!left || !right) return null;
  const edge = context.recommendations.get(left.id)?.get(right.id)
    ?? reverseSetLabRecommendation(context.recommendations.get(right.id)?.get(left.id));
  return scoreSetLabTrackPair(left, right, BPM_TOLERANCE, edge);
}

export function rankSetLabSwapCandidate(draft: SetLabDraft, context: SetLabSwapContext, candidate: RekordboxTrack) {
  const position = draft.selectedSlot;
  if (position == null || swapUnavailableReason(draft, candidate)) return null;

  const current = context.tracks.get(draft.slots[position - 1].trackId);
  const original = current && swapTrackPair(context, current, candidate);
  const neighbors = draft.slots.filter((slot) => Math.abs(slot.position - position) === 1);
  const pairs = neighbors.map((slot) => {
    const neighbor = context.tracks.get(slot.trackId);
    const pair = slot.position < position ? swapTrackPair(context, neighbor, candidate) : swapTrackPair(context, candidate, neighbor);
    return { position: slot.position, pair };
  });
  const scores = pairs.map(({ pair }) => pair?.score ?? 0);
  const score = (Math.min(...scores) + scores.reduce((sum, value) => sum + value, 0) / scores.length) / 2;
  const caution = pairs.some(({ pair }) => !pair?.eligible || pair.severe);
  const reasons = pairs.map(({ position: adjacent, pair }) => {
    const evidence = pair?.reasons.slice(0, 2) ?? [];
    if (pair?.severe) evidence.push('large tempo change');
    else if (pair?.keyMismatch) evidence.push('different key');
    return `Slot ${adjacent} · ${evidence.join(', ') || (pair ? 'limited match' : 'track unavailable')}`;
  });

  return { score, caution, reasons, similar: original?.eligible ?? false, originalScore: original?.score ?? 0 };
}

export type SetLabSwapRank = NonNullable<ReturnType<typeof rankSetLabSwapCandidate>>;

export async function loadSimilarSetLabSwapIds(
  draft: SetLabDraft, context: SetLabSwapContext, filters: LibraryTrackFilters, signal: AbortSignal,
): Promise<string[]> {
  if (context.key !== swapContextKey(draft)) throw new Error('The selected slot changed before ranking.');
  const currentId = draft.selectedSlot == null ? null : draft.slots[draft.selectedSlot - 1]?.trackId;
  if (!currentId || !context.tracks.has(currentId)) return [];
  const ranked: Array<{ id: string; title: string; rank: SetLabSwapRank }> = [];
  await visitSetLabLibraryTracks(draft, filters, (track) => {
    const rank = rankSetLabSwapCandidate(draft, context, track);
    if (rank?.similar) ranked.push({ id: track.id, title: track.title, rank });
  }, signal);
  return ranked.sort((a, b) => Number(a.rank.caution) - Number(b.rank.caution)
    || b.rank.score - a.rank.score || b.rank.originalScore - a.rank.originalScore
    || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).map(({ id }) => id);
}
