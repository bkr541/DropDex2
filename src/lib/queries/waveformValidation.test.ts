import { describe, expect, it } from 'vitest';
import {
  buildDetailWaveformState,
  buildResolvedWaveformState,
  buildTrackPreviewWaveform,
  chunkIds,
  isColorColumn,
  isMonoColumn,
  validatePreviewColumns,
  waveformStateForTrack,
} from './waveformValidation';
import type {
  PreviewColumnColor,
  PreviewColumnMono,
  WaveformLoadState,
  WaveformRow,
} from './waveformValidation';

function colorCol(h = 100, r = 50, g = 60, b = 70): PreviewColumnColor {
  return { h, r, g, b };
}

function monoCol(h = 20, i = 4): PreviewColumnMono {
  return { h, i };
}

function makeRow(overrides: Partial<WaveformRow> = {}): WaveformRow {
  return {
    id: 'wf-1',
    import_id: 'imp-1',
    track_id: 'track-a',
    preview_format: 'color',
    preview_column_count: 2,
    preview_columns: [colorCol(), colorCol()],
    detail_format: 'color',
    detail_column_count: 2,
    detail_storage_bucket: 'waveforms',
    detail_storage_path: 'imp-1/track-a.json.gz',
    parser_version: '1.0',
    ...overrides,
  };
}

describe('waveform column guards', () => {
  it('accepts finite nonnegative color and mono columns', () => {
    expect(isColorColumn(colorCol())).toBe(true);
    expect(isMonoColumn(monoCol())).toBe(true);
  });

  it('rejects mixed, missing, negative, and nonnumeric fields', () => {
    expect(isColorColumn(monoCol())).toBe(false);
    expect(isMonoColumn(colorCol())).toBe(false);
    expect(isColorColumn({ h: -1, r: 0, g: 0, b: 0 })).toBe(false);
    expect(isMonoColumn({ h: 1, i: Number.NaN })).toBe(false);
    expect(isColorColumn({ h: 128, r: 0, g: 0, b: 0 })).toBe(false);
    expect(isMonoColumn({ h: 1, i: 8 })).toBe(false);
    expect(isColorColumn(null)).toBe(false);
  });
});

describe('validatePreviewColumns', () => {
  it('accepts valid color and mono waveforms', () => {
    expect(validatePreviewColumns([colorCol()], 1)).toMatchObject({
      valid: true,
      inferredFormat: 'color',
      error: null,
    });
    expect(validatePreviewColumns([monoCol()], 1)).toMatchObject({
      valid: true,
      inferredFormat: 'mono',
      error: null,
    });
  });

  it('classifies non-array and mixed schemas as invalid', () => {
    expect(validatePreviewColumns(null, null)).toMatchObject({ valid: false, reason: 'invalid' });
    expect(validatePreviewColumns([colorCol(), monoCol()], 2)).toMatchObject({
      valid: false,
      reason: 'invalid',
    });
  });

  it('classifies an empty waveform record as unsupported', () => {
    expect(validatePreviewColumns([], 0)).toMatchObject({
      valid: false,
      reason: 'unsupported',
    });
  });

  it('classifies a column count mismatch as invalid', () => {
    expect(validatePreviewColumns([colorCol()], 2)).toMatchObject({
      valid: false,
      reason: 'invalid',
    });
  });
});

describe('waveform row mapping and terminal state', () => {
  it('preserves a valid waveform and its detail metadata', () => {
    const columns = [colorCol(10, 20, 30, 40)];
    const waveform = buildTrackPreviewWaveform(makeRow({
      preview_column_count: 1,
      preview_columns: columns,
    }));

    expect(waveform.trackId).toBe('track-a');
    expect(waveform.previewColumns).toBe(columns);
    expect(waveform.previewColumnsValid).toBe(true);
    expect(waveform.validationError).toBeNull();
    expect(waveform.detailStorageBucket).toBe('waveforms');
  });

  it('rejects a declared format that contradicts the column schema', () => {
    const state = buildResolvedWaveformState(makeRow({
      preview_format: 'PWV4',
      preview_columns: [monoCol(), monoCol()],
    }));

    expect(state).toMatchObject({
      status: 'invalid',
      trackId: 'track-a',
      reason: 'invalid',
    });
  });

  it('maps malformed rows to invalid terminal state', () => {
    const state = buildResolvedWaveformState(makeRow({ preview_columns: ['broken'] }));
    expect(state).toMatchObject({
      status: 'invalid',
      trackId: 'track-a',
      reason: 'invalid',
      retryable: false,
    });
  });
});

describe('detailed waveform payload mapping', () => {
  const preview = buildTrackPreviewWaveform(makeRow());

  it('loads the importer payload columns field', () => {
    const detailColumns = [colorCol(12, 1, 2, 3), colorCol(24, 4, 5, 6)];
    const state = buildDetailWaveformState('track-a', preview, {
      version: 1,
      format: 'color',
      column_count: 2,
      columns: detailColumns,
    });

    expect(state.status).toBe('loaded');
    if (state.status === 'loaded') {
      expect(state.waveform.previewColumns).toBe(detailColumns);
      expect(state.waveform.previewColumnCount).toBe(2);
    }
  });

  it('does not silently fall back when the detail payload schema is malformed', () => {
    const state = buildDetailWaveformState('track-a', preview, {
      version: 1,
      format: 'color',
      column_count: 2,
      previewColumns: [colorCol(), colorCol()],
    });

    expect(state).toMatchObject({
      status: 'invalid',
      trackId: 'track-a',
      retryable: false,
    });
  });
});

describe('track-scoped state selection', () => {
  it('never returns Track A waveform for Track B', () => {
    const loadedA = buildResolvedWaveformState(makeRow({ track_id: 'track-a' }));
    const states = new Map<string, WaveformLoadState>([['track-a', loadedA]]);

    expect(waveformStateForTrack(states, 'track-b')).toEqual({
      status: 'idle',
      trackId: 'track-b',
    });
  });
});

describe('chunkIds', () => {
  it('deduplicates, filters empty IDs, and chunks deterministically', () => {
    expect(chunkIds(['a', '', 'b', 'a', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
  });

  it('returns no chunks for empty input or invalid size', () => {
    expect(chunkIds([], 100)).toEqual([]);
    expect(chunkIds(['a'], 0)).toEqual([]);
  });
});
