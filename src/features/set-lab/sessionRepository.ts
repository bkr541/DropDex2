import { supabase } from '../../lib/supabase';
import {
  parseSetLabSession, SET_LAB_SCHEMA_VERSION,
  type SetLabDraft, type SetLabSavedSet, type SetLabScope, type SetLabSession,
} from './session';

export interface StoredSetLabSession<T extends SetLabSession> {
  readonly id: string;
  readonly revision: number;
  readonly session: T;
}

interface SessionRow {
  id: string;
  revision: number;
  user_id: string;
  source_import_id: string;
  is_draft: boolean;
  name: string | null;
  schema_version: number;
  document: unknown;
}

const COLUMNS = 'id,revision,user_id,source_import_id,is_draft,name,schema_version,document';

function unpack(row: SessionRow, scope: SetLabScope): StoredSetLabSession<SetLabSession> {
  if (row.user_id !== scope.userId || row.source_import_id !== scope.sourceImportId
    || typeof row.id !== 'string' || !row.id || !Number.isSafeInteger(row.revision) || row.revision < 1
    || row.schema_version !== SET_LAB_SCHEMA_VERSION) {
    throw new Error('Invalid Set Lab storage record.');
  }
  const session = parseSetLabSession(row.document, scope);
  if (row.is_draft !== (session.status === 'draft')
    || row.name !== (session.status === 'saved' ? session.name : null)) {
    throw new Error('Set Lab storage record does not match its document.');
  }
  return { id: row.id, revision: row.revision, session };
}

function unpackDraft(row: SessionRow, scope: SetLabScope): StoredSetLabSession<SetLabDraft> {
  const { session, ...metadata } = unpack(row, scope);
  if (session.status !== 'draft') throw new Error('Expected a Set Lab draft.');
  return { ...metadata, session };
}

function unpackSavedSet(row: SessionRow, scope: SetLabScope): StoredSetLabSession<SetLabSavedSet> {
  const { session, ...metadata } = unpack(row, scope);
  if (session.status !== 'saved') throw new Error('Expected a named Set Lab set.');
  return { ...metadata, session };
}

export async function fetchSetLabDraft(scope: SetLabScope, signal?: AbortSignal) {
  const query = supabase.from('set_lab_sessions').select(COLUMNS)
    .eq('user_id', scope.userId).eq('source_import_id', scope.sourceImportId).eq('is_draft', true);
  if (signal) query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data == null ? null : unpackDraft(data as SessionRow, scope);
}

export async function fetchSetLabSavedSet(userId: string, id: string, signal?: AbortSignal) {
  const query = supabase.from('set_lab_sessions').select(COLUMNS)
    .eq('user_id', userId).eq('id', id).eq('is_draft', false);
  if (signal) query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (data == null) return null;
  const row = data as SessionRow;
  if (row.id !== id) throw new Error('Invalid saved Set Lab ID.');
  return unpackSavedSet(row, { userId, sourceImportId: row.source_import_id });
}

const SAVED_PAGE_SIZE = 20;
export interface SetLabSavedSetSummary {
  id: string;
  name: string;
  sourceImportId: string;
  updatedAt: string;
}

export async function fetchSetLabSavedSets(userId: string, page: number, signal?: AbortSignal) {
  const start = page * SAVED_PAGE_SIZE;
  const query = supabase.from('set_lab_sessions')
    .select('id,user_id,name,source_import_id,updated_at')
    .eq('user_id', userId).eq('is_draft', false)
    .order('updated_at', { ascending: false }).order('id', { ascending: false })
    .range(start, start + SAVED_PAGE_SIZE);
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; user_id: string; name: string; source_import_id: string; updated_at: string }[];
  const sets: SetLabSavedSetSummary[] = rows.slice(0, SAVED_PAGE_SIZE).map((row) => {
    if (row.user_id !== userId || !row.id || !row.name?.trim() || !row.source_import_id || !Number.isFinite(Date.parse(row.updated_at))) {
      throw new Error('Invalid saved Set Lab listing.');
    }
    return { id: row.id, name: row.name, sourceImportId: row.source_import_id, updatedAt: row.updated_at };
  });
  return { sets, hasMore: rows.length > SAVED_PAGE_SIZE };
}

export class SetLabRevisionConflict extends Error {
  constructor() {
    super('This Set Lab session changed elsewhere. Your changes could not be saved.');
  }
}

async function write(session: SetLabSession, expectedRevision: number, savedSetId?: string): Promise<SessionRow> {
  const { data, error } = await supabase.rpc('write_set_lab_session_v1', {
    p_user_id: session.userId,
    p_source_import_id: session.sourceImportId,
    p_document: session,
    p_expected_revision: expectedRevision,
    p_saved_set_id: savedSetId ?? null,
  }).select(COLUMNS).single();
  if (error?.message === 'set_lab_revision_conflict') {
    throw new SetLabRevisionConflict();
  }
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Set Lab storage did not confirm the write.');
  return data as SessionRow;
}

export async function saveSetLabDraft(draft: SetLabDraft, expectedRevision: number) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('Invalid Set Lab draft revision.');
  }
  const session = parseSetLabSession(draft, draft);
  if (session.status !== 'draft') throw new Error('Expected a Set Lab draft.');
  return unpackDraft(await write(session, expectedRevision), draft);
}

/** Use the same client-generated ID when retrying one named save. */
export async function createSetLabSavedSet(draft: SetLabDraft, name: string, id: string) {
  if (!id) throw new Error('A named Set Lab save requires a request ID.');
  const session = parseSetLabSession({ ...draft, status: 'saved', name }, draft);
  if (session.status !== 'saved') throw new Error('Expected a named Set Lab set.');
  const saved = unpackSavedSet(await write(session, 0, id), draft);
  if (saved.id !== id) throw new Error('Set Lab storage confirmed a different saved set.');
  return saved;
}
