/**
 * Pure rendering utilities for Rekordbox preview waveform data.
 *
 * Data format reference (from waveform_parser.py):
 *
 *   PWV4 (color, from EXT file):
 *     h — raw blue-channel byte d5 & 0x7F  → range [0, 127]  — used as height
 *     r — d3 * (d1/127), clamped uint8     → range [0, 255]  — pre-scaled red
 *     g — d4 * (d1/127), clamped uint8     → range [0, 255]  — pre-scaled green
 *     b — d5 * (d1/127), clamped uint8     → range [0, 255]  — pre-scaled blue
 *
 *   PWAV / PWV2 (mono, from DAT file):
 *     h — bv & 0x1F   → range [0, 31]  — 5 bits of height
 *     i — bv >> 5     → range [0, 7]   — 3 bits of intensity/brightness
 *
 * Color normalization:
 *   PWV4: normalizedHeight = h / 127; colors r,g,b pass through unchanged (already 0-255).
 *   PWAV/PWV2: normalizedHeight = h / 31; normalizedIntensity = i / 7.
 *
 * Downsampling method:
 *   Peak-preserving: for each output bucket, pick the source column with the
 *   maximum h value. This preserves transient peaks that a simple average would mask.
 *   The picked column's color channels are used unchanged (no channel averaging).
 *   Works identically for upsampling (each output pixel maps to one source column).
 *
 * No Supabase dependency — safe to import in Node test environments.
 */

import type {
  PreviewColumnColor,
  PreviewColumnMono,
  TrackPreviewWaveform,
} from '../queries/waveformValidation';

// ── Format constants ───────────────────────────────────────────────────────────

/** Persisted preview_format values from the Python importer. */
export const PREVIEW_FORMAT_COLOR = 'PWV4' as const;
export const PREVIEW_FORMAT_MONO_PWAV = 'PWAV' as const;
export const PREVIEW_FORMAT_MONO_PWV2 = 'PWV2' as const;

/** Maximum h value for PWV4 color preview (raw blue byte d5 & 0x7F). */
export const COLOR_HEIGHT_MAX = 127;

/** Maximum h value for PWAV / PWV2 monochrome preview (5-bit field: bv & 0x1F). */
export const MONO_HEIGHT_MAX = 31;

/** Maximum i value for PWAV / PWV2 (3-bit intensity field: bv >> 5). */
export const MONO_INTENSITY_MAX = 7;

// ── Normalized column types ────────────────────────────────────────────────────

/** PWV4 column with normalized height and pass-through 0-255 RGB. */
export interface NormalizedColorCol {
  /** Bar half-height, [0, 1]. Normalized from PWV4 h ∈ [0, 127]. */
  h: number;
  /** Red channel, [0, 255]. Passed through unchanged from DB. */
  r: number;
  /** Green channel, [0, 255]. Passed through unchanged from DB. */
  g: number;
  /** Blue channel, [0, 255]. Passed through unchanged from DB. */
  b: number;
}

/** PWAV / PWV2 column with normalized height and intensity. */
export interface NormalizedMonoCol {
  /** Bar half-height, [0, 1]. Normalized from h ∈ [0, 31]. */
  h: number;
  /** Intensity/brightness multiplier, [0, 1]. Normalized from i ∈ [0, 7]. */
  i: number;
}

export type WaveformKind = 'color' | 'mono';
export type NormalizedCol = NormalizedColorCol | NormalizedMonoCol;

export interface NormalizedWaveform {
  kind: WaveformKind;
  cols: NormalizedCol[];
}

// ── Normalization ──────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Normalize one PWV4 color column. Heights map to [0,1]; RGB passes through. */
export function normalizeColorColumn(col: PreviewColumnColor): NormalizedColorCol {
  return {
    h: clamp(col.h, 0, COLOR_HEIGHT_MAX) / COLOR_HEIGHT_MAX,
    r: Math.round(clamp(col.r, 0, 255)),
    g: Math.round(clamp(col.g, 0, 255)),
    b: Math.round(clamp(col.b, 0, 255)),
  };
}

/** Normalize one PWAV / PWV2 monochrome column. Both fields map to [0,1]. */
export function normalizeMonoColumn(col: PreviewColumnMono): NormalizedMonoCol {
  return {
    h: clamp(col.h, 0, MONO_HEIGHT_MAX) / MONO_HEIGHT_MAX,
    i: clamp(col.i, 0, MONO_INTENSITY_MAX) / MONO_INTENSITY_MAX,
  };
}

/**
 * Detect waveform kind from preview_format string (or fallback to column shape).
 * Returns null when data is invalid or empty.
 */
export function normalizeWaveform(wf: TrackPreviewWaveform): NormalizedWaveform | null {
  if (!wf.previewColumnsValid || wf.previewColumns.length === 0) return null;

  const fmt = wf.previewFormat ?? wf.inferredFormat ?? '';
  const isColor =
    fmt === PREVIEW_FORMAT_COLOR ||
    wf.inferredFormat === 'color';

  if (isColor) {
    const cols = wf.previewColumns as PreviewColumnColor[];
    return {
      kind: 'color',
      cols: cols.map(normalizeColorColumn),
    };
  }

  // PWAV, PWV2, or mono fallback
  const cols = wf.previewColumns as PreviewColumnMono[];
  return {
    kind: 'mono',
    cols: cols.map(normalizeMonoColumn),
  };
}

// ── Downsampling ───────────────────────────────────────────────────────────────

/**
 * Build a display-ready column array exactly `targetCount` elements long.
 *
 * Downsampling (srcCount > targetCount): each output bucket covers multiple source
 * columns; the one with the highest h (peak-preserving) is selected.
 *
 * Upsampling (srcCount ≤ targetCount): adjacent output positions map to the same
 * source column — nearest-neighbour, no interpolation.
 *
 * The same formula handles both cases without branching.
 */
export function buildDisplayBuckets(
  cols: NormalizedCol[],
  targetCount: number,
): NormalizedCol[] {
  const n = cols.length;
  if (n === 0 || targetCount <= 0) return [];

  const result: NormalizedCol[] = new Array(targetCount);
  for (let x = 0; x < targetCount; x++) {
    const srcStart = Math.floor((x * n) / targetCount);
    const srcEnd = Math.floor(((x + 1) * n) / targetCount);

    if (srcEnd <= srcStart) {
      // Upsampling: single source column for this output pixel.
      result[x] = cols[Math.min(srcStart, n - 1)];
    } else {
      // Downsampling: pick the column with the maximum h value within the bucket.
      let peak = cols[srcStart];
      for (let i = srcStart + 1; i < srcEnd; i++) {
        if (cols[i].h > peak.h) peak = cols[i];
      }
      result[x] = peak;
    }
  }
  return result;
}

// ── Utilities ──────────────────────────────────────────────────────────────────

/** Parse a CSS hex color string (#rrggbb or #rgb) into an [R, G, B] tuple. */
export function parseHexColor(hex: string): [number, number, number] | null {
  const s = hex.trim().replace(/^#/, '');
  if (s.length === 3) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  if (s.length === 6) {
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

/** Clamp a playback progress value to [0, 1]. */
export function clampProgress(p: number): number {
  if (!isFinite(p)) return 0;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/**
 * Compute normalized playback progress [0, 1] from audio element time values.
 * Returns 0 for any invalid input: NaN, Infinity, zero or negative duration.
 */
export function computeProgress(currentTime: number, duration: number): number {
  if (!isFinite(duration) || duration <= 0) return 0;
  if (!isFinite(currentTime) || currentTime < 0) return 0;
  return Math.min(1, currentTime / duration);
}

/**
 * Select the monochrome waveform base color for the given theme.
 * Dark: near-white (foreground). Light: near-black (foreground).
 */
export function resolveMonoBaseColor(
  theme: 'dark' | 'light',
): [number, number, number] {
  // Values match CSS variables --color-foreground in index.css:
  // dark: #f0ede9 (240, 237, 233), light: #1a1c2e (26, 28, 46)
  return theme === 'light' ? [26, 28, 46] : [240, 237, 233];
}

/** Type guard — true when a normalized column has r/g/b fields (color). */
export function isNormalizedColorCol(c: NormalizedCol): c is NormalizedColorCol {
  return 'r' in c;
}
