/**
 * Pure validation and state helpers for rekordbox waveform data.
 *
 * The central contract is `WaveformLoadState`. Every consumer can distinguish
 * an untouched request, an in-flight request, valid data, confirmed absence,
 * a retryable transport failure, and invalid or unsupported waveform data.
 */

// ── Column types ──────────────────────────────────────────────────────────────

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

// ── Waveform row shape (mirrors DB row) ───────────────────────────────────────

export interface WaveformRow {
  id: string;
  import_id: string;
  track_id: string;
  preview_format: string | null;
  preview_column_count: number | null;
  /** Raw JSON from Supabase. It is validated before rendering. */
  preview_columns: unknown;
  detail_format: string | null;
  detail_column_count: number | null;
  detail_storage_bucket: string | null;
  detail_storage_path: string | null;
  parser_version: string | null;
}

export type WaveformPreviewFormat = 'color' | 'mono';
export type WaveformInvalidReason = 'invalid' | 'unsupported';

/**
 * A validated, ergonomic view of a waveform row.
 * `previewColumns` is kept unmodified after validation.
 */
export interface TrackPreviewWaveform {
  trackId: string;
  previewFormat: string | null;
  previewColumnCount: number | null;
  previewColumns: PreviewColumn[];
  previewColumnsValid: boolean;
  inferredFormat: WaveformPreviewFormat | null;
  validationError: string | null;
  invalidReason: WaveformInvalidReason | null;
  detailFormat: string | null;
  detailColumnCount: number | null;
  detailStorageBucket: string | null;
  detailStoragePath: string | null;
  /** Divisor used to normalize raw column heights exactly once. */
  heightScale?: number | null;
  /** Parser version that produced this database row/storage object. */
  parserVersion?: string | null;
  /** Serialized detail payload version; null for inline preview rows. */
  dataVersion?: number | null;
}

/**
 * Track-scoped waveform state. A loaded state always carries validated data;
 * a missing database row is represented only by `unavailable`.
 */
export type WaveformLoadState =
  | { status: 'idle'; trackId: string | null }
  | { status: 'loading'; trackId: string }
  | { status: 'loaded'; trackId: string; waveform: TrackPreviewWaveform }
  | { status: 'unavailable'; trackId: string }
  | { status: 'error'; trackId: string; error: string; retryable: true }
  | {
      status: 'invalid';
      trackId: string;
      error: string;
      reason: WaveformInvalidReason;
      retryable: false;
    };

export type ResolvedWaveformLoadState = Exclude<
  WaveformLoadState,
  { status: 'idle' | 'loading' }
>;

export function idleWaveformState(
  trackId: string | null = null,
): WaveformLoadState {
  return { status: 'idle', trackId };
}

export function loadingWaveformState(trackId: string): WaveformLoadState {
  return { status: 'loading', trackId };
}

export function waveformStateForTrack(
  states: ReadonlyMap<string, WaveformLoadState>,
  trackId: string | null | undefined,
): WaveformLoadState {
  if (!trackId) return idleWaveformState(null);
  const state = states.get(trackId);
  return state?.trackId === trackId ? state : idleWaveformState(trackId);
}

// ── Column type guards ─────────────────────────────────────────────────────────

function isFiniteInRange(value: unknown, maximum: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= maximum
  );
}

export function isColorColumn(c: unknown): c is PreviewColumnColor {
  if (!c || typeof c !== 'object') return false;
  const obj = c as Record<string, unknown>;
  return (
    isFiniteInRange(obj.h, 127) &&
    isFiniteInRange(obj.r, 255) &&
    isFiniteInRange(obj.g, 255) &&
    isFiniteInRange(obj.b, 255)
  );
}

export function isMonoColumn(c: unknown): c is PreviewColumnMono {
  if (!c || typeof c !== 'object') return false;
  const obj = c as Record<string, unknown>;
  return isFiniteInRange(obj.h, 31) && isFiniteInRange(obj.i, 7);
}

// ── Column validation ─────────────────────────────────────────────────────────

export interface ValidationResult {
  columns: PreviewColumn[];
  valid: boolean;
  inferredFormat: WaveformPreviewFormat | null;
  error: string | null;
  reason: WaveformInvalidReason | null;
}

/** Validate raw preview waveform JSON without mutating it. */
export function validatePreviewColumns(
  rawColumns: unknown,
  expectedCount: number | null,
): ValidationResult {
  if (!Array.isArray(rawColumns)) {
    return {
      columns: [],
      valid: false,
      inferredFormat: null,
      error: 'Waveform preview columns are not an array.',
      reason: 'invalid',
    };
  }

  if (rawColumns.length === 0) {
    return {
      columns: [],
      valid: false,
      inferredFormat: null,
      error: 'Waveform record contains no renderable preview columns.',
      reason: 'unsupported',
    };
  }

  const allColor = rawColumns.every(isColorColumn);
  const allMono = rawColumns.every(isMonoColumn);

  if (!allColor && !allMono) {
    return {
      columns: rawColumns as PreviewColumn[],
      valid: false,
      inferredFormat: null,
      error: 'Waveform preview columns use an invalid or mixed schema.',
      reason: 'invalid',
    };
  }

  const inferredFormat: WaveformPreviewFormat = allColor ? 'color' : 'mono';
  const countMatch =
    expectedCount == null || rawColumns.length === expectedCount;

  if (!countMatch) {
    return {
      columns: rawColumns as PreviewColumn[],
      valid: false,
      inferredFormat,
      error: `Waveform column count mismatch: expected ${expectedCount}, received ${rawColumns.length}.`,
      reason: 'invalid',
    };
  }

  return {
    columns: rawColumns as PreviewColumn[],
    valid: true,
    inferredFormat,
    error: null,
    reason: null,
  };
}

function expectedFormatKind(
  format: string | null | undefined,
): WaveformPreviewFormat | null {
  const normalized = format?.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === 'PWV4' || normalized === 'PWV5' || normalized === 'COLOR')
    return 'color';
  if (
    normalized === 'PWAV' ||
    normalized === 'PWV2' ||
    normalized === 'PWV3' ||
    normalized === 'MONO'
  ) {
    return 'mono';
  }
  return null;
}

function validateDeclaredFormat(
  format: string | null | undefined,
  validation: ValidationResult,
): ValidationResult {
  if (!validation.valid || !validation.inferredFormat) return validation;
  const expectedKind = expectedFormatKind(format);
  if (!expectedKind || expectedKind === validation.inferredFormat)
    return validation;
  return {
    ...validation,
    valid: false,
    error: `Waveform format ${format} does not match ${validation.inferredFormat} column data.`,
    reason: 'invalid',
  };
}

export function heightScaleForFormat(
  format: string | null | undefined,
  dataVersion: number | null = null,
): number {
  const normalized = format?.trim().toUpperCase();
  if (normalized === 'PWV4' || normalized === 'COLOR') return 127;
  if (normalized === 'PWV5') return dataVersion === 1 ? 1 : 31;
  if (
    normalized === 'PWAV' ||
    normalized === 'PWV2' ||
    normalized === 'PWV3' ||
    normalized === 'MONO'
  )
    return 31;
  return 1;
}

// ── Row transformer ────────────────────────────────────────────────────────────

/** Map a raw DB waveform row to the ergonomic `TrackPreviewWaveform` shape. */
export function buildTrackPreviewWaveform(
  row: WaveformRow,
): TrackPreviewWaveform {
  const validation = validateDeclaredFormat(
    row.preview_format,
    validatePreviewColumns(row.preview_columns, row.preview_column_count),
  );

  return {
    trackId: row.track_id,
    previewFormat: row.preview_format,
    previewColumnCount: row.preview_column_count,
    previewColumns: validation.columns,
    previewColumnsValid: validation.valid,
    inferredFormat: validation.inferredFormat,
    validationError: validation.error,
    invalidReason: validation.reason,
    detailFormat: row.detail_format,
    detailColumnCount: row.detail_column_count,
    detailStorageBucket: row.detail_storage_bucket,
    detailStoragePath: row.detail_storage_path,
    heightScale: heightScaleForFormat(row.preview_format),
    parserVersion: row.parser_version,
    dataVersion: null,
  };
}

/** Convert one returned DB row into a terminal waveform state. */
export function buildResolvedWaveformState(
  row: WaveformRow,
): ResolvedWaveformLoadState {
  const waveform = buildTrackPreviewWaveform(row);
  if (!waveform.previewColumnsValid) {
    return {
      status: 'invalid',
      trackId: waveform.trackId,
      error:
        waveform.validationError ?? 'Waveform data is invalid or unsupported.',
      reason: waveform.invalidReason ?? 'invalid',
      retryable: false,
    };
  }
  return { status: 'loaded', trackId: waveform.trackId, waveform };
}

// ── Detail payload validation ──────────────────────────────────────────────────

export interface DetailWaveformPayload {
  version: number;
  format: string;
  column_count: number;
  columns: unknown;
}

export function buildDetailWaveformState(
  trackId: string,
  previewWaveform: TrackPreviewWaveform,
  raw: unknown,
): ResolvedWaveformLoadState {
  const invalid = (
    error: string,
    reason: WaveformInvalidReason = 'invalid',
  ): ResolvedWaveformLoadState => ({
    status: 'invalid',
    trackId,
    error,
    reason,
    retryable: false,
  });

  if (!raw || typeof raw !== 'object') {
    return invalid('Detailed waveform payload is not an object.');
  }

  const payload = raw as Partial<DetailWaveformPayload>;
  if (
    !Number.isInteger(payload.version) ||
    (payload.version !== 1 && payload.version !== 2)
  ) {
    return invalid(
      `Detailed waveform payload version ${String(payload.version)} is unsupported.`,
      'unsupported',
    );
  }
  if (typeof payload.format !== 'string' || !payload.format.trim()) {
    return invalid('Detailed waveform payload is missing its format.');
  }
  if (
    !Number.isInteger(payload.column_count) ||
    Number(payload.column_count) < 0
  ) {
    return invalid('Detailed waveform payload has an invalid column_count.');
  }

  const payloadFormat = payload.format.trim().toUpperCase();
  const dbFormat = previewWaveform.detailFormat?.trim().toUpperCase() ?? null;
  if (dbFormat && payloadFormat !== dbFormat) {
    return invalid(
      `Detailed waveform format mismatch: database=${dbFormat}, payload=${payloadFormat}.`,
    );
  }
  if (
    previewWaveform.detailColumnCount != null &&
    payload.column_count !== previewWaveform.detailColumnCount
  ) {
    return invalid(
      `Detailed waveform column count mismatch: database=${previewWaveform.detailColumnCount}, payload=${payload.column_count}.`,
    );
  }

  const validation = validateDeclaredFormat(
    payloadFormat,
    validatePreviewColumns(payload.columns, payload.column_count),
  );
  if (!validation.valid) {
    return invalid(
      validation.error ?? 'Detailed waveform data is invalid or unsupported.',
      validation.reason ?? 'invalid',
    );
  }

  const heightScale = heightScaleForFormat(payloadFormat, payload.version);
  const maxHeight = validation.columns.reduce(
    (maximum, column) => Math.max(maximum, column.h),
    0,
  );
  if (maxHeight > heightScale) {
    return invalid(
      `Detailed waveform height exceeds the ${payloadFormat} maximum of ${heightScale}.`,
    );
  }

  return {
    status: 'loaded',
    trackId,
    waveform: {
      ...previewWaveform,
      previewFormat: payloadFormat,
      previewColumnCount: validation.columns.length,
      previewColumns: validation.columns,
      previewColumnsValid: true,
      inferredFormat: validation.inferredFormat,
      validationError: null,
      invalidReason: null,
      heightScale,
      dataVersion: payload.version,
    },
  };
}

// ── Chunking utility ───────────────────────────────────────────────────────────

/** Split an array of IDs into de-duplicated chunks of at most `size`. */
export function chunkIds(ids: string[], size: number): string[][] {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0 || size <= 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += size) {
    chunks.push(unique.slice(i, i + size));
  }
  return chunks;
}
