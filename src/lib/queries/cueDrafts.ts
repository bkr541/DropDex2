import { supabase } from '../supabase';
import { parseCueDraftDocument, type CueDraftDocument } from '../cues/cueDraftDocument';

const CUE_DRAFT_SELECT =
  'id,user_id,import_id,track_id,rekordbox_content_id,schema_version,desired_document,desired_fingerprint,'
  + 'imported_baseline_fingerprint,imported_baseline_local_cue_fingerprint,'
  + 'current_baseline_fingerprint,current_baseline_local_cue_fingerprint,'
  + 'master_db_id,master_content_id,revision,strategy_version,strategy_settings,created_at,updated_at,'
  + 'applied_revision,applied_fingerprint,applied_at,last_apply_operation_id,last_apply_state,last_apply_summary';

export interface CueDraftRow {
  id: string;
  userId: string;
  importId: string;
  trackId: string;
  rekordboxContentId: string;
  schemaVersion: number;
  desiredDocument: CueDraftDocument;
  desiredFingerprint: string;
  /** Immutable provenance captured from the imported canonical cue document. */
  importedBaselineFingerprint: string;
  /** Immutable provenance captured from imported DB-backed DjmdCue evidence. */
  importedBaselineLocalCueFingerprint: string | null;
  /** Moving semantic baseline used for the next Apply after a verified rebase. */
  currentBaselineFingerprint: string;
  /** Moving local DjmdCue baseline used by destructive stale-state preflight. */
  currentBaselineLocalCueFingerprint: string | null;
  masterDbId: string | null;
  masterContentId: string | null;
  revision: number;
  strategyVersion: string | null;
  strategySettings: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  appliedRevision: number | null;
  appliedFingerprint: string | null;
  appliedAt: string | null;
  lastApplyOperationId: string | null;
  lastApplyState: string | null;
  lastApplySummary: Record<string, unknown> | null;
}

export class CueDraftRevisionConflictError extends Error {
  constructor() {
    super('This cue draft changed in another session. Reload the track before saving again so your local edits are not overwritten.');
    this.name = 'CueDraftRevisionConflictError';
  }
}

function mapCueDraftRow(raw: unknown): CueDraftRow {
  const row = raw as Record<string, unknown>;
  const desiredDocument = parseCueDraftDocument(row.desired_document);
  if (
    row.schema_version !== desiredDocument.schemaVersion
    || row.import_id !== desiredDocument.importId
    || row.track_id !== desiredDocument.trackId
    || row.rekordbox_content_id !== desiredDocument.rekordboxContentId
  ) {
    throw new Error('Saved cue draft row identity does not match its canonical document.');
  }
  const importedBaselineFingerprint = row.imported_baseline_fingerprint as string;
  const importedBaselineLocalCueFingerprint = (row.imported_baseline_local_cue_fingerprint as string | null) ?? null;
  return {
    id: row.id as string,
    userId: row.user_id as string,
    importId: row.import_id as string,
    trackId: row.track_id as string,
    rekordboxContentId: row.rekordbox_content_id as string,
    schemaVersion: row.schema_version as number,
    desiredDocument,
    desiredFingerprint: row.desired_fingerprint as string,
    importedBaselineFingerprint,
    importedBaselineLocalCueFingerprint,
    // Backward-compatible hydration for rows encountered during a rolling
    // migration. Once Stage 10 has run these columns are populated explicitly.
    currentBaselineFingerprint: (row.current_baseline_fingerprint as string | null) ?? importedBaselineFingerprint,
    currentBaselineLocalCueFingerprint:
      (row.current_baseline_local_cue_fingerprint as string | null) ?? importedBaselineLocalCueFingerprint,
    masterDbId: (row.master_db_id as string | null) ?? null,
    masterContentId: (row.master_content_id as string | null) ?? null,
    revision: row.revision as number,
    strategyVersion: (row.strategy_version as string | null) ?? null,
    strategySettings: (row.strategy_settings as Record<string, unknown> | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    appliedRevision: (row.applied_revision as number | null) ?? null,
    appliedFingerprint: (row.applied_fingerprint as string | null) ?? null,
    appliedAt: (row.applied_at as string | null) ?? null,
    lastApplyOperationId: (row.last_apply_operation_id as string | null) ?? null,
    lastApplyState: (row.last_apply_state as string | null) ?? null,
    lastApplySummary: (row.last_apply_summary as Record<string, unknown> | null) ?? null,
  };
}

export async function fetchCueDraft(userId: string, trackId: string): Promise<CueDraftRow | null> {
  const { data, error } = await supabase
    .from('cue_drafts')
    .select(CUE_DRAFT_SELECT)
    .eq('user_id', userId)
    .eq('track_id', trackId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data == null ? null : mapCueDraftRow(data);
}

export async function saveCueDraft(input: {
  importId: string;
  trackId: string;
  rekordboxContentId: string;
  document: CueDraftDocument;
  desiredFingerprint: string;
  importedBaselineFingerprint: string;
  importedBaselineLocalCueFingerprint: string | null;
  expectedRevision: number;
  strategyVersion: string | null;
  strategySettings: Record<string, unknown> | null;
}): Promise<CueDraftRow> {
  const { data, error } = await supabase
    .rpc('save_cue_draft', {
      p_import_id: input.importId,
      p_track_id: input.trackId,
      p_rekordbox_content_id: input.rekordboxContentId,
      p_schema_version: input.document.schemaVersion,
      p_desired_document: input.document,
      p_desired_fingerprint: input.desiredFingerprint,
      p_imported_baseline_fingerprint: input.importedBaselineFingerprint,
      p_imported_baseline_local_cue_fingerprint: input.importedBaselineLocalCueFingerprint,
      p_expected_revision: input.expectedRevision,
      p_strategy_version: input.strategyVersion,
      p_strategy_settings: input.strategySettings,
    })
    .single();

  if (error) {
    if (/cue_draft_revision_conflict/i.test(error.message)) throw new CueDraftRevisionConflictError();
    throw new Error(error.message);
  }
  return mapCueDraftRow(data);
}

export function cueDraftNeedsApply(row: CueDraftRow): boolean {
  if (row.desiredFingerprint === row.currentBaselineFingerprint) return false;
  return row.appliedRevision !== row.revision || row.appliedFingerprint !== row.desiredFingerprint;
}

const CUE_DRAFT_APPLY_PAGE_SIZE = 500;

/**
 * Fetch every draft row in the Apply-All scope and prove that the result set is
 * complete before filtering eligibility. `count: exact` is deliberate: a
 * Supabase/PostgREST max-rows setting may return fewer rows than the requested
 * range, so page length alone cannot prove end-of-data.
 */
export async function fetchCueDraftsForApply(userId: string, importId: string): Promise<CueDraftRow[]> {
  const rows: unknown[] = [];
  const seenIds = new Set<string>();
  let offset = 0;
  let expectedCount: number | null = null;

  for (;;) {
    const page = await supabase
      .from('cue_drafts')
      .select(CUE_DRAFT_SELECT, { count: 'exact' })
      .eq('user_id', userId)
      .eq('import_id', importId)
      .order('rekordbox_content_id', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + CUE_DRAFT_APPLY_PAGE_SIZE - 1);

    if (page.error) throw new Error(page.error.message);
    if (!Array.isArray(page.data)) throw new Error('Cue draft response schema is invalid: expected an array of rows.');
    if (!Number.isInteger(page.count) || (page.count as number) < 0) {
      throw new Error('Cue draft retrieval is incomplete: the server did not return an exact result count.');
    }
    if (expectedCount == null) expectedCount = page.count as number;
    else if (page.count !== expectedCount) {
      throw new Error('Cue draft retrieval changed while paging; reload before Apply All.');
    }

    if (page.data.length === 0) {
      if (offset === expectedCount) break;
      throw new Error(`Cue draft retrieval stopped after ${offset} of ${expectedCount} rows.`);
    }

    for (const raw of page.data) {
      const id = (raw as Record<string, unknown>)?.id;
      if (typeof id !== 'string' || id.length === 0) throw new Error('Cue draft response contains a row without a stable ID.');
      if (seenIds.has(id)) throw new Error('Cue draft retrieval returned a duplicate row while paging.');
      seenIds.add(id);
      rows.push(raw);
    }
    offset += page.data.length;
    if (offset === expectedCount) break;
    if (offset > expectedCount) throw new Error('Cue draft retrieval returned more rows than the server-reported total.');
  }

  if (rows.length !== expectedCount) {
    throw new Error(`Cue draft retrieval is incomplete: loaded ${rows.length} of ${expectedCount ?? 0} rows.`);
  }
  return rows.map(mapCueDraftRow).filter(cueDraftNeedsApply);
}

export async function markCueDraftApplied(input: {
  importId: string;
  trackId: string;
  revision: number;
  desiredFingerprint: string;
  postApplyLocalCueFingerprint: string;
  operationId: string;
  resultSummary: Record<string, unknown>;
}): Promise<CueDraftRow> {
  const { data, error } = await supabase
    .rpc('mark_cue_draft_applied_v3', {
      p_import_id: input.importId,
      p_track_id: input.trackId,
      p_revision: input.revision,
      p_desired_fingerprint: input.desiredFingerprint,
      p_post_apply_local_cue_fingerprint: input.postApplyLocalCueFingerprint,
      p_operation_id: input.operationId,
      p_result_summary: input.resultSummary,
    })
    .single();
  if (error) throw new Error(error.message);
  return mapCueDraftRow(data);
}
