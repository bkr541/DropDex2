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
    return {
      waveform,
      startMs,
      endMs,
      durationMs: 0,
      columns: [],
      unavailableReason: 'Missing duration',
    };
  }
  if (!waveform.previewColumnsValid || waveform.previewColumns.length === 0) {
    return {
      waveform,
      startMs,
      endMs,
      durationMs: 0,
      columns: [],
      unavailableReason: 'Missing waveform columns',
    };
  }

  const clampedStartMs = Math.max(0, Math.min(sourceDurationMs, startMs));
  const clampedEndMs = Math.max(
    clampedStartMs,
    Math.min(sourceDurationMs, endMs),
  );
  const totalColumns = waveform.previewColumns.length;
  const startIndex = Math.max(
    0,
    Math.min(
      totalColumns,
      Math.floor((clampedStartMs / sourceDurationMs) * totalColumns),
    ),
  );
  const endIndex = Math.max(
    startIndex,
    Math.min(
      totalColumns,
      Math.ceil((clampedEndMs / sourceDurationMs) * totalColumns),
    ),
  );
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

export function toRenderableColumns(
  segment: WaveformSegment | null,
): RenderableWaveformColumn[] {
  if (!segment || segment.unavailableReason) return [];
  const heightScale =
    segment.waveform.heightScale ??
    (segment.waveform.inferredFormat === 'mono' ? 31 : 127);
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

export function bucketRenderableColumns(
  columns: RenderableWaveformColumn[],
  targetCount: number,
): RenderableWaveformColumn[] {
  const count = Math.max(1, Math.floor(targetCount));
  if (columns.length <= count) return columns;

  const buckets: RenderableWaveformColumn[] = [];
  for (let bucketIndex = 0; bucketIndex < count; bucketIndex += 1) {
    const start = Math.floor((bucketIndex * columns.length) / count);
    const end = Math.max(
      start + 1,
      Math.floor(((bucketIndex + 1) * columns.length) / count),
    );
    let peak = columns[start];
    for (let index = start + 1; index < end; index += 1) {
      if (columns[index].height > peak.height) peak = columns[index];
    }
    // Peak selection preserves transient height and its authentic Rekordbox
    // frequency color instead of averaging a kick into grey soup.
    buckets.push({ ...peak });
  }
  return buckets;
}

export function hasNoCenterTaper(
  left: RenderableWaveformColumn[],
  right: RenderableWaveformColumn[],
): boolean {
  if (left.length === 0 || right.length === 0) return false;

  const valuesAreValid = [...left, ...right].every(
    (column) =>
      Number.isFinite(column.height) &&
      column.height >= 0 &&
      column.height <= 1,
  );
  if (!valuesAreValid) return false;

  const edgeMean = (values: RenderableWaveformColumn[]) =>
    values.reduce((sum, column) => sum + column.height, 0) / values.length;
  const leftEdge = left.slice(Math.max(0, left.length - 4));
  const leftInner = left.slice(
    Math.max(0, left.length - 8),
    Math.max(0, left.length - 4),
  );
  const rightEdge = right.slice(0, 4);
  const rightInner = right.slice(4, 8);

  const retainsAmplitude = (
    edge: RenderableWaveformColumn[],
    inner: RenderableWaveformColumn[],
  ) => {
    if (inner.length === 0) return true;
    const innerMean = edgeMean(inner);
    if (innerMean <= 0.02) return true;
    return edgeMean(edge) >= innerMean * 0.25;
  };

  return (
    retainsAmplitude(leftEdge, leftInner) &&
    retainsAmplitude(rightEdge, rightInner)
  );
}
