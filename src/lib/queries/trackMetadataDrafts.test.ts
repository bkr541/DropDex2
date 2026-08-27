import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  eqUser: vi.fn(),
  eqTrackOrImport: vi.fn(),
  eqField: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

import {
  discardGenreMetadataDraft,
  fetchGenreMetadataDraft,
  fetchTrackMetadataDraftsForImport,
  saveGenreMetadataDraft,
  TrackMetadataDraftRevisionConflictError,
} from './trackMetadataDrafts';

const fingerprint = 'a'.repeat(64);
const row = {
  id: 'metadata-draft-1',
  user_id: 'user-1',
  import_id: 'import-1',
  track_id: 'track-1',
  field: 'genre',
  schema_version: 1,
  pending_value: 'Bass   House',
  imported_baseline_value: 'House',
  current_baseline_value: 'House',
  master_db_id: 'master-db-1',
  master_content_id: 'master-content-1',
  revision: 2,
  draft_fingerprint: fingerprint,
  created_at: '2026-08-27T00:00:00Z',
  updated_at: '2026-08-27T01:00:00Z',
  applied_revision: null,
  applied_value: null,
  applied_at: null,
  last_apply_operation_id: null,
  last_apply_state: null,
  last_apply_summary: null,
};

beforeEach(() => {
  vi.clearAllMocks();

  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ eq: mocks.eqUser });
  mocks.eqUser.mockReturnValue({ eq: mocks.eqTrackOrImport });
  mocks.eqTrackOrImport.mockReturnValue({
    eq: mocks.eqField,
    order: mocks.order,
  });
  mocks.eqField.mockReturnValue({ maybeSingle: mocks.maybeSingle });

  mocks.order.mockReturnValue({ order: mocks.order, range: mocks.range });
  mocks.rpc.mockReturnValue({ maybeSingle: mocks.maybeSingle });
});

describe('track metadata draft query boundary', () => {
  it('loads the persisted Genre draft through the user/track/field scope', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: row, error: null });

    const result = await fetchGenreMetadataDraft('user-1', 'track-1');

    expect(mocks.from).toHaveBeenCalledWith('track_metadata_drafts');
    expect(mocks.eqUser).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mocks.eqTrackOrImport).toHaveBeenCalledWith('track_id', 'track-1');
    expect(mocks.eqField).toHaveBeenCalledWith('field', 'genre');
    expect(result?.pendingValue).toBe('Bass   House');
    expect(result?.masterDbId).toBe('master-db-1');
  });

  it('saves only the typed Genre field and lets the server own normalization and identity', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: row, error: null });

    const result = await saveGenreMetadataDraft({
      importId: 'import-1',
      trackId: 'track-1',
      pendingValue: '  Bass   House  ',
      expectedRevision: 1,
    });

    expect(mocks.rpc).toHaveBeenCalledWith('save_track_metadata_draft_v1', {
      p_import_id: 'import-1',
      p_track_id: 'track-1',
      p_field: 'genre',
      p_schema_version: 1,
      p_pending_value: '  Bass   House  ',
      p_expected_revision: 1,
    });
    const rpcPayload = mocks.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(rpcPayload).not.toHaveProperty('p_master_db_id');
    expect(rpcPayload).not.toHaveProperty('p_master_content_id');
    expect(rpcPayload).not.toHaveProperty('p_current_baseline_value');
    expect(result?.revision).toBe(2);
  });

  it('represents clear Genre as nullable pending input', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { ...row, pending_value: null }, error: null });

    const result = await saveGenreMetadataDraft({
      importId: 'import-1',
      trackId: 'track-1',
      pendingValue: null,
      expectedRevision: 1,
    });

    expect(mocks.rpc).toHaveBeenCalledWith('save_track_metadata_draft_v1', expect.objectContaining({
      p_pending_value: null,
    }));
    expect(result?.pendingValue).toBeNull();
  });

  it('maps baseline equality deletion/no-op to no pending draft', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(saveGenreMetadataDraft({
      importId: 'import-1',
      trackId: 'track-1',
      pendingValue: 'House',
      expectedRevision: 2,
    })).resolves.toBeNull();
  });

  it('surfaces stale writes as a dedicated optimistic-concurrency conflict', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'metadata_draft_revision_conflict' },
    });

    await expect(saveGenreMetadataDraft({
      importId: 'import-1',
      trackId: 'track-1',
      pendingValue: 'Techno',
      expectedRevision: 1,
    })).rejects.toBeInstanceOf(TrackMetadataDraftRevisionConflictError);
  });

  it('discards only the exact Genre draft revision through its RPC', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: row, error: null });

    const result = await discardGenreMetadataDraft({
      importId: 'import-1',
      trackId: 'track-1',
      expectedRevision: 2,
    });

    expect(mocks.rpc).toHaveBeenCalledWith('discard_track_metadata_draft_v1', {
      p_import_id: 'import-1',
      p_track_id: 'track-1',
      p_field: 'genre',
      p_expected_revision: 2,
    });
    expect(result?.trackId).toBe('track-1');
  });

  it('rejects malformed persisted identity instead of hydrating an unsafe draft', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { ...row, master_content_id: null }, error: null });

    await expect(fetchGenreMetadataDraft('user-1', 'track-1')).rejects.toThrow(/master content identity/i);
  });

  it('pages the complete import draft scope instead of trusting a server row cap', async () => {
    const firstPage = [
      { ...row, id: 'draft-1' },
      { ...row, id: 'draft-2', track_id: 'track-2' },
    ];
    const secondPage = [{ ...row, id: 'draft-3', track_id: 'track-3' }];
    mocks.range
      .mockResolvedValueOnce({ data: firstPage, error: null, count: 3 })
      .mockResolvedValueOnce({ data: secondPage, error: null, count: 3 });

    const result = await fetchTrackMetadataDraftsForImport('user-1', 'import-1');

    expect(result.map((draft) => draft.id)).toEqual(['draft-1', 'draft-2', 'draft-3']);
    expect(mocks.range).toHaveBeenNthCalledWith(1, 0, 499);
    expect(mocks.range).toHaveBeenNthCalledWith(2, 2, 501);
  });
});
