/**
 * Pure validation and transformation helpers for rekordbox_track_waveforms data.
 * No Supabase dependency — safe to import in test environments.
 */

// ── Column types (re-exported for backward compat with analysisData.ts) ───────

export interface PreviewColumnColor {
  h: number;
  r: number;
  g: number;
  b: number;
}

export interface PreviewColumnMono {
  h: number;
  i: number;
}

export type PreviewColumn = PreviewColumnColor | PreviewColumnMono;

// ── Waveform row shape (mirrors DB row, raw values preserved) ─────────────────

export interface WaveformRow {
  id: string;
  import_id: string;
  track_id: string;
  preview_format: string | null;
  preview_column_count: number | null;
  preview_columns: PreviewColumn[];
  detail_format: string | null;
  detail_column_count: number | null;
  detail_storage_bucket: string | null;
  detail_storage_path: string | null;
  parser_version: string | null;
}

// ── New types ─────────────────────────────────────────────────────────────────

export type WaveformPreviewFormat = 'color' | 'mono';

export type WaveformLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded' }
  | { status: 'unavailable' }
  | { status: 'error'; error: string };

/**
 * A validated, ergonomic view of a waveform row.
 * `previewColumns` is the raw database value — never pre-transformed or mutated.
 */
export interface TrackPreviewWaveform {
  trackId: string;
  previewFormat: string | null;
  previewColumnCount: number | null;
  /** Raw columns from the database — preserved as-is. */
  previewColumns: PreviewColumn[];
  /** True when columns array passes all validation checks. */
  previewColumnsValid: boolean;
  /** Format inferred from column structure ('color' | 'mono'), null if indeterminate. */
  inferredFormat: WaveformPreviewFormat | null;
  detailFormat: string | null;
  detailColumnCount: number | null;
  detailStorageBucket: string | null;
  detailStoragePath: string | null;
}

// ── Column type guards ─────────────────────────────────────────────────────────

export function isColorColumn(c: unknown): c is PreviewColumnColor {
  if (!c || typeof c !== 'object') return false;
  const obj = c as Record<string, unknown>;
  return (
    typeof obj.h === 'number' && obj.h >= 0 &&
    typeof obj.r === 'number' && obj.r >= 0 &&
    typeof obj.g === 'number' && obj.g >= 0 &&
    typeof obj.b === 'number' && obj.b >= 0
  );
}

export function isMonoColumn(c: unknown): c is PreviewColumnMono {
  if (!c || typeof c !== 'object') return false;
  const obj = c as Record<string, unknown>;
  return (
    typeof obj.h === 'number' && obj.h >= 0 &&
    typeof obj.i === 'number' && obj.i >= 0
  );
}

// ── Column validation ─────────────────────────────────────────────────────────

export interface ValidationResult {
  columns: PreviewColumn[];
  valid: boolean;
  inferredFormat: WaveformPreviewFormat | null;
}

/**
 * Validate the raw `preview_columns` JSON from the database.
 *
 * Returns the original columns array unmodified, a validity flag, and the
 * inferred format. Failures are non-throwing — callers receive `valid: false`
 * instead of an exception so one bad row never crashes the view.
 */
export function validatePreviewColumns(
  rawColumns: unknown,
  expectedCount: number | null,
): ValidationResult {
  // Must be an array
  if (!Array.isArray(rawColumns)) {
    return { columns: [], valid: false, inferredFormat: null };
  }
  if (rawColumns.length === 0) {
    // Empty is valid only when expectedCount is 0 or null
    const valid = expectedCount == null || expectedCount === 0;
    return { columns: [], valid, inferredFormat: null };
  }

  // Validate every element against one of the two known shapes
  const allColor = rawColumns.every(isColorColumn);
  const allMono = rawColumns.every(isMonoColumn);

  if (!allColor && !allMono) {
    // Mixed or malformed — return raw cast as PreviewColumn[] but flag invalid
    return {
      columns: rawColumns as PreviewColumn[],
      valid: false,
      inferredFormat: null,
    };
  }

  const inferredFormat: WaveformPreviewFormat = allColor ? 'color' : 'mono';

  // Check count mismatch — warn only (could be a parser version difference)
  const countMatch = expectedCount == null || rawColumns.length === expectedCount;

  return {
    columns: rawColumns as PreviewColumn[],
    valid: countMatch,
    inferredFormat,
  };
}

// ── Row transformer ────────────────────────────────────────────────────────────

/** Map a raw DB waveform row to the ergonomic `TrackPreviewWaveform` shape. */
export function buildTrackPreviewWaveform(row: WaveformRow): TrackPreviewWaveform {
  const { columns, valid, inferredFormat } = validatePreviewColumns(
    row.preview_columns,
    row.preview_column_count,
  );

  return {
    trackId: row.track_id,
    previewFormat: row.preview_format,
    previewColumnCount: row.preview_column_count,
    previewColumns: columns,
    previewColumnsValid: valid,
    inferredFormat,
    detailFormat: row.detail_format,
    detailColumnCount: row.detail_column_count,
    detailStorageBucket: row.detail_storage_bucket,
    detailStoragePath: row.detail_storage_path,
  };
}

// ── Chunking utility ───────────────────────────────────────────────────────────

/**
 * Split an array of IDs into chunks of at most `size`.
 * Deduplicates before chunking.
 */
export function chunkIds(ids: string[], size: number): string[][] {
  const unique = [...new Set(ids)];
  if (unique.length === 0 || size <= 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += size) {
    chunks.push(unique.slice(i, i + size));
  }
  return chunks;
}
