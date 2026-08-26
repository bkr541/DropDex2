import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../queries/analysisData', () => ({ fetchTrackCueState: vi.fn() }));
vi.mock('../queries/cueDrafts', () => ({ fetchCueDraft: vi.fn() }));

import { fetchTrackCueState } from '../queries/analysisData';
import { fetchCueDraft } from '../queries/cueDrafts';
import { loadCueEditorBaseline } from './cueBaselineLoader';
import type { RekordboxTrack } from '../../types';

const track: RekordboxTrack = {
  id: 'track-1',
  import_id: 'import-1',
  rekordbox_content_id: 'rb-1',
  title: 'Test Track',
  artist: 'Artist',
  album: null,
  remixer: null,
  genre: null,
  label: null,
  musical_key: null,
  camelot_key: null,
  normalized_key_name: null,
  key_tonic: null,
  key_mode: null,
  bpm: 140,
  duration_seconds: 180,
  rating: null,
  comments: null,
  file_path: null,
  file_format: null,
  date_added: null,
  created_at: '2026-08-25T00:00:00Z',
  master_db_id: null,
  master_content_id: null,
  analysis_data_file_path: null,
  analysed_bits: null,
  cue_update_count: null,
  analysis_data_update_count: null,
  information_update_count: null,
  analysis_reused_from_track_id: null,
  analysis_parse_status: 'completed',
  analysis_parse_warnings: [],
};

const cueRow = {
  id: 'cue-1',
  import_id: 'import-1',
  track_id: 'track-1',
  rekordbox_cue_id: 'rb-cue-1',
  dedupe_key: 'db:rb-cue-1',
  cue_family: 'hot' as const,
  cue_family_authority: 'anlz' as const,
  hot_cue_slot: 1,
  point_type: 'cue' as const,
  source_kind: '0',
  start_ms: 1000,
  end_ms: null,
  color_table_index: null,
  color_hex: '#ffffff',
  color_name: null,
  comment: null,
  is_active_loop: false,
  beat_loop_numerator: null,
  beat_loop_denominator: null,
  source_db_present: true,
  source_anlz_present: true,
  source_conflict: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchTrackCueState).mockResolvedValue({ status: 'loaded-empty', trackId: track.id, cues: [] });
  vi.mocked(fetchCueDraft).mockResolvedValue(null);
});

describe('loadCueEditorBaseline', () => {
  it('distinguishes a successfully loaded zero-cue track from failure', async () => {
    const result = await loadCueEditorBaseline(track, 'user-1');

    expect(result).toMatchObject({ status: 'loaded-empty', importedCues: [], workingCues: [] });
    expect(fetchCueDraft).toHaveBeenCalledWith('user-1', 'track-1');
  });

  it('returns loaded-with-cues only after the imported cue request succeeds', async () => {
    vi.mocked(fetchTrackCueState).mockResolvedValue({
      status: 'loaded-with-cues',
      trackId: track.id,
      cues: [cueRow],
    });

    const result = await loadCueEditorBaseline(track, null);

    expect(result.status).toBe('loaded-with-cues');
    if (result.status !== 'failed') {
      expect(result.workingCues).toHaveLength(1);
      expect(result.workingCues[0].hotCueSlot).toBe(1);
    }
    expect(fetchCueDraft).not.toHaveBeenCalled();
  });

  it('blocks a successfully queryable cue table when reconciliation is known incomplete', async () => {
    const result = await loadCueEditorBaseline({
      ...track,
      analysis_feature_statuses: { cues: 'failed' },
    }, 'user-1');

    expect(result).toMatchObject({
      status: 'failed',
      phase: 'imported-cues',
      retryable: true,
    });
    expect(result.status === 'failed' ? result.error : '').toMatch(/reconciliation is failed/i);
    expect(fetchTrackCueState).not.toHaveBeenCalled();
    expect(fetchCueDraft).not.toHaveBeenCalled();
  });

  it('fails closed for legacy failed analysis when cue-specific completeness is unavailable', async () => {
    const result = await loadCueEditorBaseline({
      ...track,
      analysis_parse_status: 'failed',
      analysis_feature_statuses: {},
    }, 'user-1');

    expect(result).toMatchObject({ status: 'failed', phase: 'imported-cues' });
    expect(result.status === 'failed' ? result.error : '').toMatch(/cannot be proven/i);
    expect(fetchTrackCueState).not.toHaveBeenCalled();
  });

  it('keeps a cue query rejection as a failed baseline and never loads the draft', async () => {
    vi.mocked(fetchTrackCueState).mockResolvedValue({
      status: 'failed',
      trackId: track.id,
      error: 'RLS denied',
      retryable: true,
    });

    const result = await loadCueEditorBaseline(track, 'user-1');

    expect(result).toMatchObject({
      status: 'failed',
      phase: 'imported-cues',
      retryable: true,
    });
    expect(result.status === 'failed' ? result.error : '').toMatch(/RLS denied/);
    expect(fetchCueDraft).not.toHaveBeenCalled();
  });

  it('keeps saved-draft query failure visible and does not expose imported cues as working state', async () => {
    vi.mocked(fetchTrackCueState).mockResolvedValue({
      status: 'loaded-with-cues',
      trackId: track.id,
      cues: [cueRow],
    });
    vi.mocked(fetchCueDraft).mockRejectedValue(new Error('network offline'));

    const result = await loadCueEditorBaseline(track, 'user-1');

    expect(result).toMatchObject({
      status: 'failed',
      phase: 'saved-draft',
      importedCues: expect.any(Array),
    });
    expect(result.status === 'failed' ? result.importedCues : []).toHaveLength(1);
    expect(result.status === 'failed' ? result.error : '').toMatch(/network offline/);
    expect('workingCues' in result).toBe(false);
  });

  it('fails closed when a saved draft identity is malformed or belongs to another track', async () => {
    vi.mocked(fetchCueDraft).mockResolvedValue({
      id: 'draft-1',
      userId: 'user-1',
      importId: 'other-import',
      trackId: 'track-1',
      rekordboxContentId: 'rb-1',
      schemaVersion: 1,
      desiredDocument: {
        schemaVersion: 1,
        importId: 'other-import',
        trackId: 'track-1',
        rekordboxContentId: 'rb-1',
        cues: [],
      },
      desiredFingerprint: 'a'.repeat(64),
      importedBaselineFingerprint: 'b'.repeat(64),
      importedBaselineLocalCueFingerprint: 'c'.repeat(64),
      masterDbId: null,
      masterContentId: null,
      revision: 1,
      strategyVersion: null,
      strategySettings: null,
      createdAt: '2026-08-25T00:00:00Z',
      updatedAt: '2026-08-25T00:00:00Z',
      appliedRevision: null,
      appliedFingerprint: null,
      appliedAt: null,
      lastApplyOperationId: null,
      lastApplyState: null,
      lastApplySummary: null,
    });

    const result = await loadCueEditorBaseline(track, 'user-1');

    expect(result).toMatchObject({ status: 'failed', phase: 'saved-draft' });
    expect(result.status === 'failed' ? result.error : '').toMatch(/identity/i);
  });

  it('supports retry after a transient draft failure without retaining failed state', async () => {
    vi.mocked(fetchCueDraft)
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(null);

    const first = await loadCueEditorBaseline(track, 'user-1');
    const second = await loadCueEditorBaseline(track, 'user-1');

    expect(first.status).toBe('failed');
    expect(second.status).toBe('loaded-empty');
    expect(fetchCueDraft).toHaveBeenCalledTimes(2);
  });
});
