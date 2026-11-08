import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSetLabDraft } from './session';
import { createSetLabSavedSet, fetchSetLabDraft, fetchSetLabSavedSet, fetchSetLabSavedSets, saveSetLabDraft } from './sessionRepository';
import { populatedDraft, scope } from './session.testFixtures';

const { from, rpc, query } = vi.hoisted(() => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn(),
  };
  return { from: vi.fn(() => query), rpc: vi.fn(() => query), query };
});
vi.mock('../../lib/supabase', () => ({ supabase: { from, rpc } }));

const draft = populatedDraft();
const draftRow = {
  id: 'draft-1', revision: 1, user_id: scope.userId, source_import_id: scope.sourceImportId,
  is_draft: true, name: null, schema_version: 1, document: draft,
};

beforeEach(() => vi.clearAllMocks());

describe('Set Lab session repository', () => {
  it('loads an exact account/import draft and distinguishes missing data from errors', async () => {
    const signal = new AbortController().signal;
    query.maybeSingle.mockResolvedValueOnce({ data: draftRow, error: null });
    await expect(fetchSetLabDraft(scope, signal)).resolves.toEqual({ id: 'draft-1', revision: 1, session: draft });
    expect(from).toHaveBeenCalledWith('set_lab_sessions');
    expect(query.eq.mock.calls).toEqual([
      ['user_id', scope.userId], ['source_import_id', scope.sourceImportId], ['is_draft', true],
    ]);
    expect(query.abortSignal).toHaveBeenCalledWith(signal);

    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchSetLabDraft(scope)).resolves.toBeNull();
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await expect(fetchSetLabDraft(scope)).rejects.toThrow('offline');
  });

  it('rejects a stale or malformed result even if the backend returns it', async () => {
    for (const patch of [
      { user_id: 'wrong-account' }, { source_import_id: 'wrong-import' }, { revision: 0 },
      { document: { ...draft, slots: [] } },
    ]) {
      query.maybeSingle.mockResolvedValueOnce({ data: { ...draftRow, ...patch }, error: null });
      await expect(fetchSetLabDraft(scope)).rejects.toThrow();
    }
  });

  it('sends the expected revision and reports conflicts as unsuccessful saves', async () => {
    query.single.mockResolvedValueOnce({ data: { ...draftRow, revision: 2 }, error: null });
    await expect(saveSetLabDraft(draft, 1)).resolves.toMatchObject({ revision: 2 });
    expect(rpc).toHaveBeenCalledWith('write_set_lab_session_v1', {
      p_user_id: scope.userId, p_source_import_id: scope.sourceImportId, p_document: draft,
      p_expected_revision: 1, p_saved_set_id: null,
    });
    query.single.mockResolvedValueOnce({ data: null, error: { message: 'set_lab_revision_conflict' } });
    await expect(saveSetLabDraft(draft, 1)).rejects.toThrow('changed elsewhere');
    await expect(saveSetLabDraft(draft, -1)).rejects.toThrow('revision');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('lists named sets across imports in scoped metadata pages', async () => {
    const signal = new AbortController().signal;
    query.range.mockReturnValueOnce(query);
    query.abortSignal.mockResolvedValueOnce({ data: [{
      id: 'saved-old', user_id: scope.userId, name: 'Friday',
      source_import_id: 'deleted-import', updated_at: '2026-11-07T00:00:00Z',
    }], error: null });
    await expect(fetchSetLabSavedSets(scope.userId, 1, signal)).resolves.toEqual({ sets: [{
      id: 'saved-old', name: 'Friday', sourceImportId: 'deleted-import', updatedAt: '2026-11-07T00:00:00Z',
    }], hasMore: false });
    expect(query.eq.mock.calls).toEqual([['user_id', scope.userId], ['is_draft', false]]);
    expect(query.range).toHaveBeenCalledWith(20, 40);
    expect(query.abortSignal).toHaveBeenCalledWith(signal);
    query.range.mockResolvedValueOnce({ data: [{ id: 'foreign', user_id: 'other' }], error: null });
    await expect(fetchSetLabSavedSets(scope.userId, 0)).rejects.toThrow('Invalid saved Set Lab listing');
  });

  it('creates a named copy and reads it by account and ID independently of the active import', async () => {
    const saved = { ...draft, status: 'saved', name: 'Friday' };
    const savedRow = { ...draftRow, id: 'saved-1', is_draft: false, name: 'Friday', document: saved };
    query.single.mockResolvedValueOnce({ data: savedRow, error: null });
    await expect(createSetLabSavedSet(draft, ' Friday ', 'saved-1')).resolves.toMatchObject({ session: saved });
    expect(rpc).toHaveBeenCalledWith('write_set_lab_session_v1', expect.objectContaining({
      p_saved_set_id: 'saved-1', p_expected_revision: 0, p_document: saved,
    }));
    expect(draft.status).toBe('draft');
    await expect(createSetLabSavedSet(createSetLabDraft(scope), 'Empty', 'saved-2')).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);

    query.maybeSingle.mockResolvedValueOnce({ data: savedRow, error: null });
    await expect(fetchSetLabSavedSet(scope.userId, 'saved-1')).resolves.toMatchObject({ session: saved });
    expect(query.eq.mock.calls).toEqual([['user_id', scope.userId], ['id', 'saved-1'], ['is_draft', false]]);
  });
});
