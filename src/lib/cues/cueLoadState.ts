import type { CueLoadState } from '../queries/analysisData';

export type CueStateFilter = 'all' | 'with-cues' | 'without-cues';

export interface CueLoadOwner {
  trackId: string;
  userId: string | null;
}

export function cueLoadCount(state: CueLoadState | undefined): number | null {
  if (state?.status === 'loaded-empty') return 0;
  if (state?.status === 'loaded-with-cues') return state.cues.length;
  return null;
}

export function cueFilterMatches(state: CueLoadState | undefined, filter: CueStateFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'with-cues') return state?.status === 'loaded-with-cues';
  return state?.status === 'loaded-empty';
}

export function cueLoadOwnerMatches(
  owner: CueLoadOwner | null,
  currentTrackId: string | null,
  currentUserId: string | null,
): boolean {
  return Boolean(
    owner
    && currentTrackId
    && owner.trackId === currentTrackId
    && owner.userId === currentUserId
  );
}
