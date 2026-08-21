import { supabase } from '../supabase';
import { parseCueDraftDocument, type CueDraftDocument } from '../cues/cueDraftDocument';

export interface CueDraftRow {
  id: string;
  userId: string;
  importId: string;
  trackId: string;
  rekordboxContentId: string;
  schemaVersion: number;
  desiredDocument: CueDraftDocument;
  desiredFingerprint: string;
  importedBaselineFingerprint: string;
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
  return {
    id: row.id as string,
    userId: row.user_id as string,
    importId: row.import_id as string,
    trackId: row.track_id as string,
    rekordboxContentId: row.rekordbox_content_id as string,
    schemaVersion: row.schema_version as number,
    desiredDocument,
    desiredFingerprint: row.desired_fingerprint as string,
    importedBaselineFingerprint: row.imported_baseline_fingerprint as string,
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
    .select('id,user_id,import_id,track_id,rekordbox_content_id,schema_version,desired_document,desired_fingerprint,imported_baseline_fingerprint,revision,strategy_version,strategy_settings,created_at,updated_at,applied_revision,applied_fingerprint,applied_at,last_apply_operation_id,last_apply_state,last_apply_summary')
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
  if (row.desiredFingerprint === row.importedBaselineFingerprint) return false;
  return row.appliedRevision !== row.revision || row.appliedFingerprint !== row.desiredFingerprint;
}

export async function fetchCueDraftsForApply(userId: string, importId: string): Promise<CueDraftRow[]> {
  const { data, error } = await supabase
    .from('cue_drafts')
    .select('id,user_id,import_id,track_id,rekordbox_content_id,schema_version,desired_document,desired_fingerprint,imported_baseline_fingerprint,revision,strategy_version,strategy_settings,created_at,updated_at,applied_revision,applied_fingerprint,applied_at,last_apply_operation_id,last_apply_state,last_apply_summary')
    .eq('user_id', userId)
    .eq('import_id', importId)
    .order('rekordbox_content_id', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapCueDraftRow).filter(cueDraftNeedsApply);
}

export async function markCueDraftApplied(input: {
  trackId: string;
  revision: number;
  desiredFingerprint: string;
  operationId: string;
  resultSummary: Record<string, unknown>;
}): Promise<CueDraftRow> {
  const { data, error } = await supabase
    .rpc('mark_cue_draft_applied', {
      p_track_id: input.trackId,
      p_revision: input.revision,
      p_desired_fingerprint: input.desiredFingerprint,
      p_operation_id: input.operationId,
      p_result_summary: input.resultSummary,
    })
    .single();
  if (error) throw new Error(error.message);
  return mapCueDraftRow(data);
}
