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

export interface ImportProgressSnapshot {
  processed: number;
  total: number;
  percent: number;
  currentTrackLabel: string | null;
}

export function isImportTerminal(item: RekordboxImport): boolean {
  return TERMINAL_JOB_STATUSES.has(item.status);
}

export function isImportInFlight(item: RekordboxImport): boolean {
  // Failed and cancelled jobs are always terminal. A completed metadata import
  // may legitimately re-enter analysis during the resume/reprocess workflow,
  // so completed + active analysis remains visible as background work. The
  // runtime-truth migration removes historical stale combinations once.
  if (item.status === 'failed' || item.status === 'cancelled') return false;
  if (item.status === 'completed') return isAnalysisInFlight(item.analysis_status);
  return true;
}

export function isAnalysisInFlight(status: RekordboxAnalysisStatus | null): boolean {
  return status != null && ACTIVE_ANALYSIS_STATUSES.has(status);
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

export function getInFlightImport(imports: RekordboxImport[]): RekordboxImport | null {
  return imports.find(isImportInFlight) ?? null;
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
