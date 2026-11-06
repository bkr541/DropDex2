import { useEffect, useState } from 'react';
import { fetchTrackBeatGrid, fetchTrackCueState, fetchTrackPhrases, type BeatGridRow, type PhraseRow } from '../../lib/queries/analysisData';
import { auditionCueMarkersFromState } from './auditionCueMarkers';
import { logger } from '../../lib/logger';

/** A cue point shown above the full-song waveform. Hot cues carry their letter (A, B, C…); memory cues have none. */
export interface AuditionCueMarker {
  id: string;
  startMs: number;
  color: string;
  label: string | null;
}

export interface AuditionTrackAnalysis {
  /** The track these rows belong to; rows are empty until they match the selected track. */
  trackId: string | null;
  phrases: PhraseRow[];
  beatGrid: BeatGridRow | null;
  cues: AuditionCueMarker[];
  loading: boolean;
  /** Plain-language message when the section data could not be loaded. */
  error: string | null;
}

const EMPTY: AuditionTrackAnalysis = { trackId: null, phrases: [], beatGrid: null, cues: [], loading: false, error: null };

/**
 * Loads the Rekordbox sections (phrases) and beat grid for the selected track.
 * Results are only exposed for the track they were requested for, so a slow
 * response for a previous track can never appear on the current one.
 */
export function useAuditionTrackAnalysis(trackId: string | null, retryNonce = 0): AuditionTrackAnalysis {
  const [state, setState] = useState<AuditionTrackAnalysis>(EMPTY);

  useEffect(() => {
    if (!trackId) {
      setState(EMPTY);
      return;
    }
    const controller = new AbortController();
    setState({ trackId, phrases: [], beatGrid: null, cues: [], loading: true, error: null });

    void Promise.allSettled([
      fetchTrackPhrases(trackId, controller.signal),
      fetchTrackBeatGrid(trackId, controller.signal),
      fetchTrackCueState(trackId),
    ]).then(([phraseResult, gridResult, cueResult]) => {
      if (controller.signal.aborted) return;
      const phrases = phraseResult.status === 'fulfilled' ? phraseResult.value : [];
      const beatGrid = gridResult.status === 'fulfilled' ? gridResult.value : null;
      if (phraseResult.status === 'rejected') {
        logger.error('audition.sections.load_failed', { trackId, error: describeError(phraseResult.reason) });
      }
      if (gridResult.status === 'rejected') {
        // Sections can still be placed from their own timestamps, so this alone is not shown to the user.
        logger.warn('audition.beat_grid.load_failed', { trackId, error: describeError(gridResult.reason) });
      }
      const cues = cueResult.status === 'fulfilled' ? auditionCueMarkersFromState(cueResult.value) : [];
      if (cueResult.status === 'rejected' || (cueResult.status === 'fulfilled' && cueResult.value.status === 'failed')) {
        logger.warn('audition.cues.load_failed', { trackId, error: cueResult.status === 'rejected' ? describeError(cueResult.reason) : 'error' in cueResult.value ? cueResult.value.error : null });
      }
      setState({
        trackId,
        phrases,
        beatGrid,
        cues,
        loading: false,
        error: phraseResult.status === 'rejected' ? 'Track sections could not be loaded.' : null,
      });
    });

    return () => controller.abort();
  }, [trackId, retryNonce]);

  return state.trackId === trackId ? state : { ...EMPTY, trackId, loading: Boolean(trackId) };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
