import { hotCueLabel } from '../../lib/music/cueHelpers';
import type { CueLoadState, CueRow } from '../../lib/queries/analysisData';
import type { AuditionCueMarker } from './useAuditionTrackAnalysis';

/** Cue points as Audition draws them: the cue's own colour, and the letter (A, B, C…) for hot cues. */
export function auditionCueMarkers(cues: readonly CueRow[]): AuditionCueMarker[] {
  return cues
    .filter((cue) => cue.start_ms != null)
    .map((cue) => ({
      id: cue.id,
      startMs: cue.start_ms as number,
      color: cue.color_hex ?? (cue.cue_family === 'hot' ? '#ffffff' : '#9aa5b8'),
      label: cue.cue_family === 'hot' ? hotCueLabel(cue.hot_cue_slot) : null,
    }));
}

export function auditionCueMarkersFromState(state: CueLoadState | undefined): AuditionCueMarker[] {
  return state?.status === 'loaded-with-cues' ? auditionCueMarkers(state.cues) : [];
}
