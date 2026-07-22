import type { RekordboxAnalysisStatus, RekordboxImport } from '../../types';

const TERMINAL_JOB_STATUSES = new Set<RekordboxImport['status']>([
  'cancelled',
  'completed',
  'failed',
]);

const ACTIVE_ANALYSIS_STATUSES = new Set<RekordboxAnalysisStatus>([
  'awaiting_upload',
  'uploading',
  'uploaded',
  'parsing',
]);

export const IMPORT_ACTIVITY_STALE_MS = 60 * 60 * 1000;

export interface ImportProgressSnapshot {
  processed: number;
  total: number;
  percent: number;
  currentTrackLabel: string | null;
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getImportLastActivityAt(item: RekordboxImport): number {
  const timestamps = [
    item.analysis_progress_updated_at,
    item.updated_at,
    item.processing_started_at,
    item.upload_completed_at,
    item.imported_at,
  ].map(parseTimestamp).filter((value): value is number => value != null);

  return timestamps.length > 0 ? Math.max(...timestamps) : 0;
}

export function isImportTerminal(item: RekordboxImport): boolean {
  return TERMINAL_JOB_STATUSES.has(item.status);
}

export function isAnalysisInFlight(status: RekordboxAnalysisStatus | null): boolean {
  return status != null && ACTIVE_ANALYSIS_STATUSES.has(status);
}

function hasActiveRuntimeState(item: RekordboxImport): boolean {
  if (item.status === 'failed' || item.status === 'cancelled') return false;
  if (item.status === 'completed') return isAnalysisInFlight(item.analysis_status);
  return true;
}

export function isImportStalled(
  item: RekordboxImport,
  now = Date.now(),
  staleAfterMs = IMPORT_ACTIVITY_STALE_MS,
): boolean {
  if (!hasActiveRuntimeState(item)) return false;
  const lastActivityAt = getImportLastActivityAt(item);
  return lastActivityAt <= 0 || now - lastActivityAt > staleAfterMs;
}

export function isImportInFlight(
  item: RekordboxImport,
  now = Date.now(),
  staleAfterMs = IMPORT_ACTIVITY_STALE_MS,
): boolean {
  return hasActiveRuntimeState(item) && !isImportStalled(item, now, staleAfterMs);
}

export function getImportProgress(item: RekordboxImport): ImportProgressSnapshot {
  const expected = Math.max(0, item.analysis_expected_track_count || 0);
  const persistedTotal = Math.max(0, item.analysis_progress_total_track_count || 0);
  const total = Math.max(expected, persistedTotal);

  const parsed = Math.max(0, item.analysis_parsed_track_count || 0);
  const persistedProcessed = Math.max(0, item.analysis_progress_processed_track_count || 0);
  const processed = total > 0
    ? Math.min(total, Math.max(parsed, persistedProcessed))
    : Math.max(parsed, persistedProcessed);

  const terminalAnalysis = item.analysis_status === 'completed'
    || item.analysis_status === 'partial'
    || item.analysis_status === 'failed';
  const percent = total > 0
    ? Math.max(0, Math.min(100, Math.round((processed / total) * 100)))
    : terminalAnalysis ? 100 : 0;

  return {
    processed,
    total,
    percent,
    currentTrackLabel: item.analysis_current_track_label || null,
  };
}

export function getInFlightImport(
  imports: RekordboxImport[],
  now = Date.now(),
): RekordboxImport | null {
  return imports
    .filter((item) => isImportInFlight(item, now))
    .sort((left, right) => getImportLastActivityAt(right) - getImportLastActivityAt(left))[0]
    ?? null;
}

export function describeAnalysisStatus(status: RekordboxAnalysisStatus | null): string {
  switch (status) {
    case 'awaiting_upload': return 'Waiting for analysis files';
    case 'uploading': return 'Uploading analysis files';
    case 'uploaded': return 'Preparing analysis';
    case 'parsing': return 'Parsing analysis data';
    case 'completed': return 'Analysis completed';
    case 'partial': return 'Analysis completed with warnings';
    case 'failed': return 'Analysis failed';
    case 'not_requested': return 'Metadata only';
    default: return 'Preparing import';
  }
}
