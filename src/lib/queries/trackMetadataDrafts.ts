import { supabase } from '../supabase';

export const TRACK_METADATA_DRAFT_SCHEMA_VERSION = 1 as const;
export const REKORDBOX_GENRE_MAX_LENGTH = 255 as const;

export type TrackMetadataField = 'genre';
export type TrackMetadataDraftApplyState = 'applied' | 'rejected' | 'rolled-back' | 'recovery-unverified';

export interface TrackMetadataDraftRow {
  id: string;
  userId: string;
  importId: string;
  trackId: string;
  field: TrackMetadataField;
  schemaVersion: number;
  pendingValue: string | null;
  importedBaselineValue: string | null;
  currentBaselineValue: string | null;
  masterDbId: string;
  masterContentId: string;
  revision: number;
  draftFingerprint: string;
  createdAt: string;
  updatedAt: string;
  appliedRevision: number | null;
  appliedValue: string | null;
  appliedAt: string | null;
  lastApplyOperationId: string | null;
  lastApplyState: TrackMetadataDraftApplyState | null;
  lastApplySummary: Record<string, unknown> | null;
}

const TRACK_METADATA_DRAFT_SELECT =
  'id,user_id,import_id,track_id,field,schema_version,pending_value,imported_baseline_value,current_baseline_value,'
  + 'master_db_id,master_content_id,revision,draft_fingerprint,created_at,updated_at,applied_revision,applied_value,'
  + 'applied_at,last_apply_operation_id,last_apply_state,last_apply_summary';

const TRACK_METADATA_DRAFT_PAGE_SIZE = 500;

export class TrackMetadataDraftRevisionConflictError extends Error {
  constructor() {
    super('This metadata draft changed in another session. Reload the track before saving again so your edit is not overwritten.');
    this.name = 'TrackMetadataDraftRevisionConflictError';
  }
}

function mapTrackMetadataDraftRow(raw: unknown): TrackMetadataDraftRow {
  const row = raw as Record<string, unknown>;
  if (row.field !== 'genre') {
    throw new Error(`Unsupported saved metadata draft field: ${String(row.field)}`);
  }
  if (row.schema_version !== TRACK_METADATA_DRAFT_SCHEMA_VERSION) {
    throw new Error('Saved metadata draft has an unsupported schema version.');
  }
  if (!Number.isInteger(row.revision) || (row.revision as number) <= 0) {
    throw new Error('Saved metadata draft has an invalid revision.');
  }
  if (typeof row.master_db_id !== 'string' || row.master_db_id.trim() === '') {
    throw new Error('Saved metadata draft is missing its trusted master database identity.');
  }
  if (typeof row.master_content_id !== 'string' || row.master_content_id.trim() === '') {
    throw new Error('Saved metadata draft is missing its trusted master content identity.');
  }
  if (typeof row.draft_fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(row.draft_fingerprint)) {
    throw new Error('Saved metadata draft has an invalid fingerprint.');
  }

  return {
    id: row.id as string,
    userId: row.user_id as string,
    importId: row.import_id as string,
    trackId: row.track_id as string,
    field: row.field,
    schemaVersion: row.schema_version as number,
    pendingValue: (row.pending_value as string | null) ?? null,
    importedBaselineValue: (row.imported_baseline_value as string | null) ?? null,
    currentBaselineValue: (row.current_baseline_value as string | null) ?? null,
    masterDbId: row.master_db_id,
    masterContentId: row.master_content_id,
    revision: row.revision as number,
    draftFingerprint: row.draft_fingerprint,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    appliedRevision: (row.applied_revision as number | null) ?? null,
    appliedValue: (row.applied_value as string | null) ?? null,
    appliedAt: (row.applied_at as string | null) ?? null,
    lastApplyOperationId: (row.last_apply_operation_id as string | null) ?? null,
    lastApplyState: (row.last_apply_state as TrackMetadataDraftApplyState | null) ?? null,
    lastApplySummary: (row.last_apply_summary as Record<string, unknown> | null) ?? null,
  };
}

function throwMetadataDraftMutationError(error: { message: string }): never {
  if (/metadata_draft_revision_conflict/i.test(error.message)) {
    throw new TrackMetadataDraftRevisionConflictError();
  }
  throw new Error(error.message);
}

export async function fetchGenreMetadataDraft(
  userId: string,
  trackId: string,
): Promise<TrackMetadataDraftRow | null> {
  const { data, error } = await supabase
    .from('track_metadata_drafts')
    .select(TRACK_METADATA_DRAFT_SELECT)
    .eq('user_id', userId)
    .eq('track_id', trackId)
    .eq('field', 'genre')
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data == null ? null : mapTrackMetadataDraftRow(data);
}

export async function saveGenreMetadataDraft(input: {
  importId: string;
  trackId: string;
  pendingValue: string | null;
  expectedRevision: number;
}): Promise<TrackMetadataDraftRow | null> {
  const { data, error } = await supabase
    .rpc('save_track_metadata_draft_v1', {
      p_import_id: input.importId,
      p_track_id: input.trackId,
      p_field: 'genre',
      p_schema_version: TRACK_METADATA_DRAFT_SCHEMA_VERSION,
      p_pending_value: input.pendingValue,
      p_expected_revision: input.expectedRevision,
    })
    .maybeSingle();

  if (error) throwMetadataDraftMutationError(error);
  // A null row is intentional when the normalized desired value equals the
  // moving baseline, in which case the server leaves no false pending draft.
  return data == null ? null : mapTrackMetadataDraftRow(data);
}

export async function discardGenreMetadataDraft(input: {
  importId: string;
  trackId: string;
  expectedRevision: number;
}): Promise<TrackMetadataDraftRow | null> {
  const { data, error } = await supabase
    .rpc('discard_track_metadata_draft_v1', {
      p_import_id: input.importId,
      p_track_id: input.trackId,
      p_field: 'genre',
      p_expected_revision: input.expectedRevision,
    })
    .maybeSingle();

  if (error) throwMetadataDraftMutationError(error);
  return data == null ? null : mapTrackMetadataDraftRow(data);
}

/**
 * Load the complete persisted metadata-draft scope for an import. Exact-count
 * pagination prevents a PostgREST max-row limit from silently hiding drafts.
 */
export async function fetchTrackMetadataDraftsForImport(
  userId: string,
  importId: string,
): Promise<TrackMetadataDraftRow[]> {
  const rows: unknown[] = [];
  const seenIds = new Set<string>();
  let offset = 0;
  let expectedCount: number | null = null;

  for (;;) {
    const page = await supabase
      .from('track_metadata_drafts')
      .select(TRACK_METADATA_DRAFT_SELECT, { count: 'exact' })
      .eq('user_id', userId)
      .eq('import_id', importId)
      .order('track_id', { ascending: true })
      .order('field', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + TRACK_METADATA_DRAFT_PAGE_SIZE - 1);

    if (page.error) throw new Error(page.error.message);
    if (!Array.isArray(page.data)) throw new Error('Metadata draft response schema is invalid: expected an array of rows.');
    if (!Number.isInteger(page.count) || (page.count as number) < 0) {
      throw new Error('Metadata draft retrieval is incomplete: the server did not return an exact result count.');
    }
    if (expectedCount == null) expectedCount = page.count as number;
    else if (page.count !== expectedCount) {
      throw new Error('Metadata draft retrieval changed while paging; reload before reviewing pending changes.');
    }

    if (page.data.length === 0) {
      if (offset === expectedCount) break;
      throw new Error(`Metadata draft retrieval stopped after ${offset} of ${expectedCount} rows.`);
    }

    for (const raw of page.data) {
      const id = (raw as Record<string, unknown>)?.id;
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error('Metadata draft response contains a row without a stable ID.');
      }
      if (seenIds.has(id)) throw new Error('Metadata draft retrieval returned a duplicate row while paging.');
      seenIds.add(id);
      rows.push(raw);
    }

    offset += page.data.length;
    if (offset === expectedCount) break;
    if (offset > expectedCount) {
      throw new Error('Metadata draft retrieval returned more rows than the server-reported total.');
    }
  }

  return rows.map(mapTrackMetadataDraftRow);
}
