import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({
  supabase: { from: vi.fn() },
}));

import { supabase } from '../supabase';
import { fetchTrackPreviewWaveforms } from './analysisData';

function colorCol(h = 100, r = 50, g = 60, b = 70) {
  return { h, r, g, b };
}

function makeWaveformRow(trackId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `wf-${trackId}`,
    import_id: 'imp-1',
    track_id: trackId,
    preview_format: 'color',
    preview_column_count: 1,
    preview_columns: [colorCol()],
    detail_format: null,
    detail_column_count: null,
    detail_storage_bucket: null,
    detail_storage_path: null,
    parser_version: '1.0',
    ...overrides,
  };
}

function setupChain(result: { data: unknown[] | null; error: { message: string } | null }) {
  const chain = { select: vi.fn(), in: vi.fn() };
  chain.select.mockReturnValue(chain);
  chain.in.mockResolvedValue(result);
  vi.mocked(supabase.from).mockReturnValue(chain as never);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  setupChain({ data: [], error: null });
});

describe('fetchTrackPreviewWaveforms', () => {
  it('returns an empty state map for empty input', async () => {
    const result = await fetchTrackPreviewWaveforms([]);
    expect(result.states.size).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('returns loaded state for a valid waveform record', async () => {
    setupChain({ data: [makeWaveformRow('track-a')], error: null });

    const result = await fetchTrackPreviewWaveforms(['track-a']);
    const state = result.states.get('track-a');

    expect(state?.status).toBe('loaded');
    if (state?.status === 'loaded') {
      expect(state.trackId).toBe('track-a');
      expect(state.waveform.previewColumns).toEqual([colorCol()]);
      expect(state.waveform.previewColumnsValid).toBe(true);
    }
    expect(result.errors).toEqual([]);
  });

  it('returns unavailable only after a successful query confirms no record', async () => {
    setupChain({ data: [], error: null });

    const result = await fetchTrackPreviewWaveforms(['track-missing']);

    expect(result.states.get('track-missing')).toEqual({
      status: 'unavailable',
      trackId: 'track-missing',
    });
    expect(result.errors).toEqual([]);
  });

  it('returns retryable error state for a Supabase request failure', async () => {
    setupChain({ data: null, error: { message: 'connection refused' } });

    const result = await fetchTrackPreviewWaveforms(['track-a', 'track-b']);

    expect(result.states.get('track-a')).toEqual({
      status: 'error',
      trackId: 'track-a',
      error: 'connection refused',
      retryable: true,
    });
    expect(result.states.get('track-b')?.status).toBe('error');
    expect(result.errors).toEqual([
      {
        chunkIndex: 0,
        trackIds: ['track-a', 'track-b'],
        error: 'connection refused',
      },
    ]);
  });

  it('returns retryable error state when the query promise rejects', async () => {
    const chain = { select: vi.fn(), in: vi.fn() };
    chain.select.mockReturnValue(chain);
    chain.in.mockRejectedValue(new Error('network offline'));
    vi.mocked(supabase.from).mockReturnValue(chain as never);

    const result = await fetchTrackPreviewWaveforms(['track-a']);

    expect(result.states.get('track-a')).toMatchObject({
      status: 'error',
      trackId: 'track-a',
      error: 'network offline',
      retryable: true,
    });
  });


  it('returns invalid state when a successful response has null data', async () => {
    setupChain({ data: null, error: null });

    const result = await fetchTrackPreviewWaveforms(['track-a']);

    expect(result.states.get('track-a')).toMatchObject({
      status: 'invalid',
      trackId: 'track-a',
      reason: 'invalid',
      retryable: false,
    });
  });

  it('returns invalid state when the response itself is not an array', async () => {
    const chain = { select: vi.fn(), in: vi.fn() };
    chain.select.mockReturnValue(chain);
    chain.in.mockResolvedValue({ data: { unexpected: true }, error: null });
    vi.mocked(supabase.from).mockReturnValue(chain as never);

    const result = await fetchTrackPreviewWaveforms(['track-a']);

    expect(result.states.get('track-a')).toMatchObject({
      status: 'invalid',
      trackId: 'track-a',
      reason: 'invalid',
      retryable: false,
    });
  });

  it('returns invalid state for malformed waveform schema instead of unavailable', async () => {
    setupChain({
      data: [makeWaveformRow('track-bad', { preview_columns: [{ nope: true }] })],
      error: null,
    });

    const result = await fetchTrackPreviewWaveforms(['track-bad']);
    const state = result.states.get('track-bad');

    expect(state?.status).toBe('invalid');
    if (state?.status === 'invalid') {
      expect(state.reason).toBe('invalid');
      expect(state.retryable).toBe(false);
      expect(state.error).toMatch(/invalid|mixed/i);
    }
  });

  it('returns unsupported state for an empty waveform record instead of absence', async () => {
    setupChain({
      data: [makeWaveformRow('track-empty', {
        preview_column_count: 0,
        preview_columns: [],
      })],
      error: null,
    });

    const result = await fetchTrackPreviewWaveforms(['track-empty']);

    expect(result.states.get('track-empty')).toMatchObject({
      status: 'invalid',
      trackId: 'track-empty',
      reason: 'unsupported',
      retryable: false,
    });
  });

  it('keeps successful and failed chunks independently track-scoped', async () => {
    const successChain = { select: vi.fn(), in: vi.fn() };
    successChain.select.mockReturnValue(successChain);
    successChain.in.mockResolvedValue({ data: [makeWaveformRow('track-good')], error: null });

    const failChain = { select: vi.fn(), in: vi.fn() };
    failChain.select.mockReturnValue(failChain);
    failChain.in.mockResolvedValue({ data: null, error: { message: 'timeout' } });

    vi.mocked(supabase.from)
      .mockReturnValueOnce(successChain as never)
      .mockReturnValueOnce(failChain as never);

    const firstChunk = ['track-good', ...Array.from({ length: 199 }, (_, i) => `filler-${i}`)];
    const result = await fetchTrackPreviewWaveforms([...firstChunk, 'track-fail']);

    expect(result.states.get('track-good')?.status).toBe('loaded');
    expect(result.states.get('filler-0')?.status).toBe('unavailable');
    expect(result.states.get('track-fail')?.status).toBe('error');
    expect(result.errors[0].trackIds).toEqual(['track-fail']);
  });

  it('deduplicates input IDs before querying', async () => {
    const chain = setupChain({ data: [], error: null });

    await fetchTrackPreviewWaveforms(['track-a', 'track-a', 'track-a']);

    expect(chain.in).toHaveBeenCalledTimes(1);
    expect(chain.in.mock.calls[0][1]).toEqual(['track-a']);
  });

  it('supports retry after failure without caching absence', async () => {
    const failChain = { select: vi.fn(), in: vi.fn() };
    failChain.select.mockReturnValue(failChain);
    failChain.in.mockResolvedValue({ data: null, error: { message: 'transient' } });

    const successChain = { select: vi.fn(), in: vi.fn() };
    successChain.select.mockReturnValue(successChain);
    successChain.in.mockResolvedValue({ data: [makeWaveformRow('track-retry')], error: null });

    vi.mocked(supabase.from)
      .mockReturnValueOnce(failChain as never)
      .mockReturnValueOnce(successChain as never);

    const first = await fetchTrackPreviewWaveforms(['track-retry']);
    const second = await fetchTrackPreviewWaveforms(['track-retry']);

    expect(first.states.get('track-retry')?.status).toBe('error');
    expect(second.states.get('track-retry')?.status).toBe('loaded');
  });
});
