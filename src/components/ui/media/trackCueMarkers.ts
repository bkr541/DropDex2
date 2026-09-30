import type { CueLoadState } from '../../../lib/queries/analysisData';

export interface TrackCueMarker {
  id: string;
  startMs: number;
  color: string;
}

/** Cue markers for a track row, colored like Cue Points (hot cues brighter than memory cues). */
export function cueMarkersFromState(state: CueLoadState | undefined): TrackCueMarker[] {
  if (state?.status !== 'loaded-with-cues') return [];
  return state.cues
    .filter((cue) => cue.start_ms != null)
    .map((cue) => ({
      id: cue.id,
      startMs: cue.start_ms as number,
      color: cue.color_hex ?? (cue.cue_family === 'hot' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)'),
    }));
}
