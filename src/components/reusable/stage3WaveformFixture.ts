import type {
  PreviewColumnColor,
  TrackPreviewWaveform,
  WaveformLoadState,
} from '../../lib/queries/waveformValidation';

export const STAGE3_WAVEFORM_COUNT = 420;

export const STAGE3_SPECTRUM: readonly [number, number, number][] = [
  [218, 54, 223],
  [86, 92, 241],
  [45, 158, 255],
  [58, 218, 218],
  [106, 225, 72],
  [238, 223, 67],
  [255, 147, 43],
  [247, 80, 84],
  [229, 72, 192],
  [119, 81, 232],
];

export const STAGE3_GRAY_PALETTE: readonly [number, number, number][] = [[118, 126, 139], [87, 95, 108]];
export const STAGE3_RED_PALETTE: readonly [number, number, number][] = [[222, 47, 43], [129, 25, 28]];
export const STAGE3_GREEN_PALETTE: readonly [number, number, number][] = [[71, 231, 107], [32, 161, 77]];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function interpolateColor(
  palette: readonly [number, number, number][],
  fraction: number,
): [number, number, number] {
  if (palette.length === 0) return [80, 140, 255];
  if (palette.length === 1) return palette[0];
  const position = clamp01(fraction) * (palette.length - 1);
  const startIndex = Math.min(palette.length - 2, Math.floor(position));
  const local = position - startIndex;
  const start = palette[startIndex];
  const end = palette[startIndex + 1];
  return [
    Math.round(start[0] + (end[0] - start[0]) * local),
    Math.round(start[1] + (end[1] - start[1]) * local),
    Math.round(start[2] + (end[2] - start[2]) * local),
  ];
}

/**
 * Deterministic preview data used only by the Reusable Components showcase.
 * It follows the real validated PWV4 contract so the production canvas renderer
 * and peak-preserving bucket logic remain the rendering path.
 */
export function createStage3WaveformState(
  trackId: string,
  palette: readonly [number, number, number][] = STAGE3_SPECTRUM,
  reverse = false,
): WaveformLoadState {
  const columns: PreviewColumnColor[] = Array.from({ length: STAGE3_WAVEFORM_COUNT }, (_, index) => {
    const x = index / Math.max(1, STAGE3_WAVEFORM_COUNT - 1);
    const envelope = 0.24
      + Math.abs(Math.sin(index * 0.173)) * 0.34
      + Math.abs(Math.sin(index * 0.057 + 0.7)) * 0.24
      + Math.abs(Math.sin(index * 0.013 + 1.9)) * 0.16;
    const transient = index % 47 < 3 ? 0.18 : index % 83 < 2 ? 0.13 : 0;
    const h = Math.round(Math.min(127, Math.max(7, (envelope + transient) * 104)));
    const [r, g, b] = interpolateColor(palette, reverse ? 1 - x : x);
    return { h, r, g, b };
  });

  const waveform: TrackPreviewWaveform = {
    trackId,
    previewFormat: 'PWV4',
    previewColumnCount: columns.length,
    previewColumns: columns,
    previewColumnsValid: true,
    inferredFormat: 'color',
    validationError: null,
    invalidReason: null,
    detailFormat: null,
    detailColumnCount: null,
    detailStorageBucket: null,
    detailStoragePath: null,
    heightScale: 127,
    parserVersion: 'stage3-showcase-fixture',
    dataVersion: null,
  };

  return { status: 'loaded', trackId, waveform };
}
