import type { DropLabTrackAnalysis } from '../../hooks/useDropLabAnalysis';
import type { DropLabMatchLabel } from '../../hooks/useDropLabFlipPicks';
import type { TrackTableStatus } from '../ui/display';
import type { SemanticTone } from '../ui/feedback/types';

export interface CandidateStatus {
  tone: TrackTableStatus;
  text: string;
}

/** What a candidate row says about whether it can be previewed right now. */
export function candidateStatus(analysis: DropLabTrackAnalysis | undefined, usbReady: boolean): CandidateStatus {
  const waveformStatus = analysis?.waveformState.status ?? 'idle';
  if (waveformStatus !== 'loaded') {
    if (waveformStatus === 'error') return { tone: 'error', text: 'Waveform failed' };
    if (waveformStatus === 'invalid') return { tone: 'error', text: 'Invalid waveform' };
    if (waveformStatus === 'loading') return { tone: 'warning', text: 'Loading waveform' };
    return { tone: 'warning', text: 'Missing waveform' };
  }
  if (!analysis?.dropPoints.length) return { tone: 'warning', text: 'Missing drop' };
  if (!usbReady) return { tone: 'warning', text: 'Connect USB to preview' };
  return { tone: 'ready', text: 'Ready to preview' };
}

/** The badge color for a match label: green for the best, then blue, amber and gray. */
export function matchTone(label: DropLabMatchLabel): SemanticTone {
  switch (label) {
    case 'Strong Match': return 'success';
    case 'Good Match': return 'active';
    case 'Compatible': return 'amber';
    case 'Experimental': return 'neutral';
  }
}
