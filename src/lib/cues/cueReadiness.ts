import type { RekordboxTrack } from '../../types';

const OVERALL_READY_STATUSES = new Set(['completed', 'reused']);

function cueFeatureStatus(track: RekordboxTrack): string | null {
  const status = track.analysis_feature_statuses?.cues;
  return typeof status === 'string' && status.length > 0 ? status : null;
}

function titleCaseStatus(status: string): string {
  return status
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * The Cue Points workflow is ready only when the overall analysis checkpoint is
 * final and any explicitly persisted cue-feature checkpoint is completed.
 * Feature-level truth wins over the coarser overall status.
 */
export function cueAnalysisReady(track: RekordboxTrack): boolean {
  if (!OVERALL_READY_STATUSES.has(String(track.analysis_parse_status ?? ''))) return false;
  const status = cueFeatureStatus(track);
  return status == null || status === 'completed';
}

export function cueAnalysisLabel(track: RekordboxTrack): string {
  const status = cueFeatureStatus(track);
  if (OVERALL_READY_STATUSES.has(String(track.analysis_parse_status ?? ''))
    && status != null
    && status !== 'completed') {
    return `Cue ${titleCaseStatus(status)}`;
  }

  switch (track.analysis_parse_status) {
    case 'completed': return 'Ready';
    case 'reused': return 'Reused';
    case 'partial': return 'Partial';
    case 'failed': return 'Failed';
    case 'missing_required': return 'Missing';
    case 'parsing': return 'Parsing';
    case 'queued': return 'Queued';
    default: return 'Pending';
  }
}

export function cueSourceCompletenessError(track: RekordboxTrack): string | null {
  const status = cueFeatureStatus(track);
  if (status != null && status !== 'completed') {
    return `Cue reconciliation is ${status}; refresh or re-run track analysis before editing cues.`;
  }

  if (
    status == null
    && (track.analysis_parse_status === 'failed'
      || track.analysis_parse_status === 'partial'
      || track.analysis_parse_status === 'missing_required'
      || track.analysis_parse_status === 'queued'
      || track.analysis_parse_status === 'parsing')
  ) {
    return `Cue completeness cannot be proven while track analysis is ${track.analysis_parse_status}.`;
  }
  return null;
}
