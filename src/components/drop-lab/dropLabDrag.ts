/** Which half of the Drop Lab timeline a track is loaded into. */
export type DropLabSide = 'build' | 'drop';

/** How the user asked to load the track. Used for the log only. */
export type DropLabLoadMethod = 'drag' | 'menu' | 'click';

export const DROP_LAB_TRACK_MIME = 'application/x-dropdex-track';

/**
 * The build is to the left of the swap line and the drop to the right. `splitFraction` is
 * where the swap line sits across the timeline: 0.5 when fully zoomed out, elsewhere when zoomed in.
 */
export function dropSideForPointer(clientX: number, rect: { left: number; width: number }, splitFraction = 0.5): DropLabSide {
  if (rect.width <= 0) return 'drop';
  return (clientX - rect.left) / rect.width < splitFraction ? 'build' : 'drop';
}

/** True when the thing being dragged is a Drop Lab track row. */
export function isDropLabTrackDrag(types: ReadonlyArray<string> | DOMStringList | null | undefined): boolean {
  if (!types) return false;
  return Array.from(types as ArrayLike<string>).includes(DROP_LAB_TRACK_MIME);
}

export const DROP_LAB_SIDE_LABEL: Record<DropLabSide, string> = {
  build: 'Load as build',
  drop: 'Load as drop',
};

export type DropLabLoadAction =
  | { kind: 'none' }
  /** Make this track the active candidate (the right side). */
  | { kind: 'set-candidate'; trackId: string }
  /** Make this track the selected track (the left side), keeping the candidate when it still makes sense. */
  | { kind: 'set-source'; sourceTrackId: string; candidateTrackId: string | null };

/** Decide what loading a track into the left (build) or right (drop) side should change. */
export function resolveDropLabLoad(
  side: DropLabSide,
  trackId: string,
  sourceTrackId: string | null,
  activeCandidateId: string | null,
): DropLabLoadAction {
  if (side === 'drop') {
    return trackId === activeCandidateId ? { kind: 'none' } : { kind: 'set-candidate', trackId };
  }
  if (trackId === sourceTrackId) return { kind: 'none' };
  return {
    kind: 'set-source',
    sourceTrackId: trackId,
    candidateTrackId: activeCandidateId && activeCandidateId !== trackId ? activeCandidateId : null,
  };
}
