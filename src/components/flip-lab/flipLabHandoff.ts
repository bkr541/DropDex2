import type { AppRoute } from '../../navigation/appRoutes';

export type FlipLabDropLabRoute = Extract<AppRoute, { name: 'drop-lab' }>;

/**
 * Drop Lab currently accepts parent track identities plus optional drop IDs.
 * Flip Lab prepared stems, mixer state, loop state, and playback position are
 * intentionally not part of this contract.
 */
export function buildFlipLabDropLabRoute(
  vocalParentTrackId: string,
  instrumentalParentTrackId: string,
): FlipLabDropLabRoute {
  return {
    name: 'drop-lab',
    sourceTrackId: vocalParentTrackId,
    candidateTrackId: instrumentalParentTrackId,
    sourceDropId: null,
    candidateDropId: null,
  };
}
