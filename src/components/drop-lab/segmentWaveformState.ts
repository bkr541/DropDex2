import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import type { WaveformSegment } from '../../lib/music/waveformSegments';

/** Wraps a sliced segment so the shared Rekordbox waveform can draw it. */
export function segmentWaveformState(segment: WaveformSegment | null): WaveformLoadState | null {
  if (!segment || segment.columns.length === 0) return null;
  return {
    status: 'loaded',
    trackId: segment.waveform.trackId,
    waveform: {
      ...segment.waveform,
      previewColumns: segment.columns,
      previewColumnCount: segment.columns.length,
      previewColumnsValid: true,
    },
  };
}
