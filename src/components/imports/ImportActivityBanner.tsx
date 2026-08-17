import { Database } from 'lucide-react';
import type { RekordboxImport } from '../../types';
import { cn } from '../../lib/utils';
import { describeAnalysisStatus, getImportProgress } from '../../lib/rekordbox/importLifecycle';
import { ImportActivityBanner as FeedbackImportActivityBanner } from '../ui/DropDexFeedback';

interface Props {
  item: RekordboxImport;
  activeImport: RekordboxImport | null;
  onViewStatus: () => void;
  className?: string;
}

export function ImportActivityBanner({ item, activeImport, onViewStatus, className }: Props) {
  const progress = getImportProgress(item);
  const sourceLabel = item.device_name || item.source_filename;
  const activeLabel = activeImport?.device_name || activeImport?.source_filename || null;

  return (
    <section
      className={cn('mb-5', className)}
      aria-live="polite"
      data-testid="import-activity-banner"
    >
      <FeedbackImportActivityBanner
        title={describeAnalysisStatus(item.analysis_status)}
        source={sourceLabel}
        detail={`${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()} tracks ready`}
        secondaryDetail={progress.currentTrackLabel ? `Current: ${progress.currentTrackLabel}` : undefined}
        progress={progress.percent}
        onView={onViewStatus}
        viewLabel="VIEW STATUS"
      />
      <p className="mt-2 flex items-start gap-2 px-1 text-[10px] leading-relaxed text-muted-foreground">
        <Database size={12} className="mt-0.5 shrink-0" />
        {activeImport && activeImport.id !== item.id
          ? `You are viewing the active library “${activeLabel}” until this snapshot finishes. DropDex will switch automatically.`
          : 'DropDex will activate this library automatically when processing finishes.'}
      </p>
    </section>
  );
}
