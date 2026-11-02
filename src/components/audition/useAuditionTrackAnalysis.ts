import { useEffect, useState } from 'react';
import { fetchTrackBeatGrid, fetchTrackPhrases, type BeatGridRow, type PhraseRow } from '../../lib/queries/analysisData';
import { logger } from '../../lib/logger';

export interface AuditionTrackAnalysis {
  /** The track these rows belong to; rows are empty until they match the selected track. */
  trackId: string | null;
  phrases: PhraseRow[];
  beatGrid: BeatGridRow | null;
  loading: boolean;
  /** Plain-language message when the section data could not be loaded. */
  error: string | null;
}

const EMPTY: AuditionTrackAnalysis = { trackId: null, phrases: [], beatGrid: null, loading: false, error: null };

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
    setState({ trackId, phrases: [], beatGrid: null, loading: true, error: null });

    void Promise.allSettled([
      fetchTrackPhrases(trackId, controller.signal),
      fetchTrackBeatGrid(trackId, controller.signal),
    ]).then(([phraseResult, gridResult]) => {
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
      setState({
        trackId,
        phrases,
        beatGrid,
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
