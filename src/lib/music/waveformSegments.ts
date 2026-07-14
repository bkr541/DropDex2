import type { TrackPreviewWaveform } from '../queries/waveformValidation';
import type { PreviewColumn } from '../queries/analysisData';

export interface WaveformSegment {
  waveform: TrackPreviewWaveform;
  startMs: number;
  endMs: number;
  durationMs: number;
  columns: PreviewColumn[];
  unavailableReason: string | null;
}

export interface RenderableWaveformColumn {
  height: number;
  r?: number;
  g?: number;
  b?: number;
  intensity?: number;
}

export function sliceWaveformSegment(
  waveform: TrackPreviewWaveform | null | undefined,
  startMs: number,
  endMs: number,
  sourceDurationMs: number | null,
): WaveformSegment | null {
  if (!waveform) return null;
  if (!sourceDurationMs || sourceDurationMs <= 0) {
    return { waveform, startMs, endMs, durationMs: 0, columns: [], unavailableReason: 'Missing duration' };
  }
  if (!waveform.previewColumnsValid || waveform.previewColumns.length === 0) {
    return { waveform, startMs, endMs, durationMs: 0, columns: [], unavailableReason: 'Missing waveform columns' };
  }

  const clampedStartMs = Math.max(0, Math.min(sourceDurationMs, startMs));
  const clampedEndMs = Math.max(clampedStartMs, Math.min(sourceDurationMs, endMs));
  const totalColumns = waveform.previewColumns.length;
  const startIndex = Math.max(0, Math.min(totalColumns, Math.floor((clampedStartMs / sourceDurationMs) * totalColumns)));
  const endIndex = Math.max(startIndex, Math.min(totalColumns, Math.ceil((clampedEndMs / sourceDurationMs) * totalColumns)));
  const columns = waveform.previewColumns.slice(startIndex, endIndex);

  return {
    waveform,
    startMs: clampedStartMs,
    endMs: clampedEndMs,
    durationMs: clampedEndMs - clampedStartMs,
    columns,
    unavailableReason: columns.length === 0 ? 'Empty waveform segment' : null,
  };
}

function columnHeight(column: PreviewColumn, heightScale: number): number {
  const raw = 'h' in column ? column.h : 0;
  const scale = heightScale > 0 ? heightScale : 1;
  return Math.max(0, Math.min(1, raw / scale));
}

export function toRenderableColumns(segment: WaveformSegment | null): RenderableWaveformColumn[] {
  if (!segment || segment.unavailableReason) return [];
  const heightScale = segment.waveform.heightScale ?? (segment.waveform.inferredFormat === 'mono' ? 31 : 127);
  return segment.columns.map((column) => {
    if ('r' in column) {
      return {
        height: columnHeight(column, heightScale),
        r: column.r,
        g: column.g,
        b: column.b,
      };
    }
    return {
      height: columnHeight(column, heightScale),
      intensity: 'i' in column ? Math.max(0, Math.min(1, column.i / 7)) : 0.75,
    };
  });
}

export function hasNoCenterTaper(
  left: RenderableWaveformColumn[],
  right: RenderableWaveformColumn[],
): boolean {
  const leftEdge = left.slice(Math.max(0, left.length - 4)).map((column) => column.height);
  const rightEdge = right.slice(0, 4).map((column) => column.height);
  return [...leftEdge, ...rightEdge].every((height) => height >= 0);
}

