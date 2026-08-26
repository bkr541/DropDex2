import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  eqUser: vi.fn(),
  eqTrack: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  maybeSingle: vi.fn(),
  single: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

import { createCueDraftDocument } from '../cues/cueDraftDocument';
import { CueDraftRevisionConflictError, fetchCueDraft, fetchCueDraftsForApply, markCueDraftApplied, saveCueDraft } from './cueDrafts';

const desiredDocument = createCueDraftDocument({
  importId: 'import-1',
  trackId: 'track-1',
  rekordboxContentId: 'content-1',
  cues: [],
});

const row = {
  id: 'draft-1',
  user_id: 'user-1',
  import_id: 'import-1',
  track_id: 'track-1',
  rekordbox_content_id: 'content-1',
  schema_version: 1,
  desired_document: desiredDocument,
  desired_fingerprint: 'desired',
  imported_baseline_fingerprint: 'baseline',
  imported_baseline_local_cue_fingerprint: 'local-baseline',
  current_baseline_fingerprint: 'baseline',
  current_baseline_local_cue_fingerprint: 'local-baseline',
  master_db_id: 'db-main',
  master_content_id: 'content-101',
  revision: 2,
  strategy_version: null,
  strategy_settings: null,
  created_at: '2026-08-20T00:00:00Z',
  updated_at: '2026-08-20T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ eq: mocks.eqUser });
  mocks.eqUser.mockReturnValue({ eq: mocks.eqTrack });
  const terminal = { maybeSingle: mocks.maybeSingle, order: mocks.order };
  mocks.eqTrack.mockReturnValue(terminal);
  mocks.order.mockReturnValue({ order: mocks.order, range: mocks.range });
  mocks.rpc.mockReturnValue({ single: mocks.single });
});

describe('cue draft production persistence queries', () => {
  it('loads only the authenticated user and explicitly selected track draft', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: row, error: null });
    const result = await fetchCueDraft('user-1', 'track-1');

    expect(mocks.from).toHaveBeenCalledWith('cue_drafts');
    expect(mocks.eqUser).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mocks.eqTrack).toHaveBeenCalledWith('track_id', 'track-1');
    expect(result?.revision).toBe(2);
    expect(result?.desiredDocument).toEqual(desiredDocument);
  });

  it('rejects malformed saved-draft hydration instead of treating it as no draft', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        ...row,
        desired_document: {
          ...desiredDocument,
          cues: [{ family: 'not-a-cue-family' }],
        },
      },
      error: null,
    });

    await expect(fetchCueDraft('user-1', 'track-1')).rejects.toThrow(/invalid family/i);
  });

  it('saves one complete document through the expected-revision RPC', async () => {
    mocks.single.mockResolvedValue({ data: row, error: null });
    const result = await saveCueDraft({
      importId: 'import-1',
      trackId: 'track-1',
      rekordboxContentId: 'content-1',
      document: desiredDocument,
      desiredFingerprint: 'desired',
      importedBaselineFingerprint: 'baseline',
      importedBaselineLocalCueFingerprint: 'local-baseline',
      expectedRevision: 1,
      strategyVersion: null,
      strategySettings: null,
    });

    expect(mocks.rpc).toHaveBeenCalledWith('save_cue_draft', expect.objectContaining({
      p_import_id: 'import-1',
      p_track_id: 'track-1',
      p_rekordbox_content_id: 'content-1',
      p_desired_document: desiredDocument,
      p_imported_baseline_local_cue_fingerprint: 'local-baseline',
      p_expected_revision: 1,
    }));
    expect(result.revision).toBe(2);
  });

  it('surfaces revision conflicts without converting them into last-write-wins', async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: { message: 'cue_draft_revision_conflict' },
    });

    await expect(saveCueDraft({
      importId: 'import-1',
      trackId: 'track-1',
      rekordboxContentId: 'content-1',
      document: desiredDocument,
      desiredFingerprint: 'desired',
      importedBaselineFingerprint: 'baseline',
      importedBaselineLocalCueFingerprint: 'local-baseline',
      expectedRevision: 1,
      strategyVersion: null,
      strategySettings: null,
    })).rejects.toBeInstanceOf(CueDraftRevisionConflictError);
  });

  it('pages Apply All drafts so API row limits cannot masquerade as a complete scope', async () => {
    const fullPage = Array.from({ length: 500 }, (_, index) => ({ ...row, id: `draft-${index}` }));
    const finalPage = [{ ...row, id: 'draft-500' }];
    mocks.range
      .mockResolvedValueOnce({ data: fullPage, error: null, count: 501 })
      .mockResolvedValueOnce({ data: finalPage, error: null, count: 501 });

    const result = await fetchCueDraftsForApply('user-1', 'import-1');

    expect(result).toHaveLength(501);
    expect(mocks.range).toHaveBeenNthCalledWith(1, 0, 499);
    expect(mocks.range).toHaveBeenNthCalledWith(2, 500, 999);
  });

  it('continues paging when the server cap is smaller than the requested range', async () => {
    const firstPage = [
      { ...row, id: 'draft-1' },
      { ...row, id: 'draft-2' },
    ];
    const secondPage = [{ ...row, id: 'draft-3' }];
    mocks.range
      .mockResolvedValueOnce({ data: firstPage, error: null, count: 3 })
      .mockResolvedValueOnce({ data: secondPage, error: null, count: 3 });

    const result = await fetchCueDraftsForApply('user-1', 'import-1');

    expect(result.map((item) => item.id)).toEqual(['draft-1', 'draft-2', 'draft-3']);
    expect(mocks.range).toHaveBeenNthCalledWith(1, 0, 499);
    expect(mocks.range).toHaveBeenNthCalledWith(2, 2, 501);
  });

  it('fails Apply All if a later page fails instead of applying the partial first page', async () => {
    mocks.range
      .mockResolvedValueOnce({ data: [{ ...row, id: 'draft-1' }], error: null, count: 2 })
      .mockResolvedValueOnce({ data: null, error: { message: 'page 2 unavailable' }, count: 2 });

    await expect(fetchCueDraftsForApply('user-1', 'import-1')).rejects.toThrow(/page 2 unavailable/i);
  });

  it('does not let already-applied early rows crowd a pending later draft out of Apply All', async () => {
    const applied = {
      ...row,
      id: 'draft-applied',
      current_baseline_fingerprint: 'desired',
      current_baseline_local_cue_fingerprint: 'post-apply-local',
      applied_revision: 2,
      applied_fingerprint: 'desired',
    };
    const pending = { ...row, id: 'draft-pending' };
    mocks.range
      .mockResolvedValueOnce({ data: [applied], error: null, count: 2 })
      .mockResolvedValueOnce({ data: [pending], error: null, count: 2 });

    const result = await fetchCueDraftsForApply('user-1', 'import-1');
    expect(result.map((item) => item.id)).toEqual(['draft-pending']);
  });

  it('rebases only the moving comparison baseline through the import-scoped verified post-apply RPC', async () => {
    const rebased = {
      ...row,
      current_baseline_fingerprint: 'desired',
      current_baseline_local_cue_fingerprint: 'post-apply-local',
      applied_revision: 2,
      applied_fingerprint: 'desired',
      applied_at: '2026-08-26T05:00:00Z',
      last_apply_operation_id: 'op-1',
      last_apply_state: 'applied',
      last_apply_summary: { state: 'applied' },
    };
    mocks.single.mockResolvedValue({ data: rebased, error: null });

    const result = await markCueDraftApplied({
      importId: 'import-1',
      trackId: 'track-1',
      revision: 2,
      desiredFingerprint: 'desired',
      postApplyLocalCueFingerprint: 'post-apply-local',
      operationId: 'op-1',
      resultSummary: { state: 'applied' },
    });

    expect(mocks.rpc).toHaveBeenCalledWith('mark_cue_draft_applied_v3', expect.objectContaining({
      p_import_id: 'import-1',
      p_track_id: 'track-1',
      p_revision: 2,
      p_desired_fingerprint: 'desired',
      p_post_apply_local_cue_fingerprint: 'post-apply-local',
      p_operation_id: 'op-1',
    }));
    expect(result.importedBaselineFingerprint).toBe('baseline');
    expect(result.importedBaselineLocalCueFingerprint).toBe('local-baseline');
    expect(result.currentBaselineFingerprint).toBe('desired');
    expect(result.currentBaselineLocalCueFingerprint).toBe('post-apply-local');
  });

});
