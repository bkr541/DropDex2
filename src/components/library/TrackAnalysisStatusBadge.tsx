import { cn } from '../../lib/utils';
import type { RekordboxTrackParseStatus } from '../../types';

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

export function TrackAnalysisStatusBadge({
  status,
  className,
}: {
  status: RekordboxTrackParseStatus | null | undefined;
  className?: string;
}) {
  const normalized = status ?? 'not_requested';
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none',
        normalized === 'completed' || normalized === 'reused'
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : normalized === 'failed' || normalized === 'missing_required'
            ? 'border-red-500/30 bg-red-500/10 text-red-300'
            : normalized === 'partial'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              : 'border-primary/25 bg-primary/10 text-primary',
        className,
      )}
    >
      {LABELS[normalized]}
    </span>
  );
}
