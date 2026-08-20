import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  eqUser: vi.fn(),
  eqTrack: vi.fn(),
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
import { CueDraftRevisionConflictError, fetchCueDraft, saveCueDraft } from './cueDrafts';

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
  mocks.eqTrack.mockReturnValue({ maybeSingle: mocks.maybeSingle });
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

  it('saves one complete document through the expected-revision RPC', async () => {
    mocks.single.mockResolvedValue({ data: row, error: null });
    const result = await saveCueDraft({
      importId: 'import-1',
      trackId: 'track-1',
      rekordboxContentId: 'content-1',
      document: desiredDocument,
      desiredFingerprint: 'desired',
      importedBaselineFingerprint: 'baseline',
      expectedRevision: 1,
      strategyVersion: null,
      strategySettings: null,
    });

    expect(mocks.rpc).toHaveBeenCalledWith('save_cue_draft', expect.objectContaining({
      p_import_id: 'import-1',
      p_track_id: 'track-1',
      p_rekordbox_content_id: 'content-1',
      p_desired_document: desiredDocument,
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
      expectedRevision: 1,
      strategyVersion: null,
      strategySettings: null,
    })).rejects.toBeInstanceOf(CueDraftRevisionConflictError);
  });
});
