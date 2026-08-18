import type { RekordboxTrackParseStatus } from '../../types';
import { AnalysisStatusBadge, type AnalysisBadgeState } from '../ui/feedback';

const LABELS: Record<RekordboxTrackParseStatus, string> = {
  not_requested: 'Metadata ready',
  queued: 'Analysis queued',
  parsing: 'Analysis running',
  completed: 'Analysis complete',
  partial: 'Analysis partial',
  failed: 'Analysis failed',
  missing_required: 'Source file missing',
  skipped: 'Analysis skipped',
  reused: 'Analysis reused',
};

const STATE_MAP: Record<RekordboxTrackParseStatus, AnalysisBadgeState> = {
  not_requested: 'not-analyzed',
  queued: 'analyzing',
  parsing: 'analyzing',
  completed: 'complete',
  partial: 'partial',
  failed: 'failed',
  missing_required: 'failed',
  skipped: 'not-analyzed',
  reused: 'reused',
};

export function TrackAnalysisStatusBadge({
  status,
  className,
}: {
  status: RekordboxTrackParseStatus | null | undefined;
  className?: string;
}) {
  const normalized = status ?? 'not_requested';
  return <AnalysisStatusBadge state={STATE_MAP[normalized]} label={LABELS[normalized]} className={className} />;
}
