import type { CueLoadState } from '../../../lib/queries/analysisData';
import { hotCueLabel } from '../../../lib/music/cueHelpers';

export interface TrackCueMarker {
  id: string;
  startMs: number;
  color: string;
  label?: string;
}

/** Cue markers for a track row, with the Audition fallback colors. */
export function cueMarkersFromState(state: CueLoadState | undefined): TrackCueMarker[] {
  if (state?.status !== 'loaded-with-cues') return [];
  let memoryNumber = 0;
  return state.cues
    .filter((cue) => cue.start_ms != null)
    .map((cue) => ({
      id: cue.id,
      startMs: cue.start_ms as number,
      color: cue.color_hex ?? (cue.cue_family === 'hot' ? '#ffffff' : '#9aa5b8'),
      label: cue.cue_family === 'hot' ? hotCueLabel(cue.hot_cue_slot) ?? undefined : String(++memoryNumber),
    }));
}
