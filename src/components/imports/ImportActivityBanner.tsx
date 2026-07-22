import { Database, Loader2 } from 'lucide-react';
import type { RekordboxImport } from '../../types';
import { cn } from '../../lib/utils';
import { describeAnalysisStatus, getImportProgress } from '../../lib/rekordbox/importLifecycle';

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
      className={cn(
        'mb-5 overflow-hidden rounded-2xl border border-primary/25 bg-primary/5 shadow-[0_10px_35px_rgba(207,107,101,0.08)]',
        className,
      )}
      aria-live="polite"
      data-testid="import-activity-banner"
    >
      <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Loader2 size={19} className="animate-spin" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="truncate text-sm font-black">{describeAnalysisStatus(item.analysis_status)}</p>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-primary">
                {progress.percent}%
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {sourceLabel} · {progress.processed.toLocaleString()} / {progress.total.toLocaleString()} tracks
            </p>
            {progress.currentTrackLabel && (
              <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                Current: {progress.currentTrackLabel}
              </p>
            )}
            <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
              <Database size={12} className="mt-0.5 shrink-0" />
              {activeImport && activeImport.id !== item.id
                ? `You are viewing the active library “${activeLabel}” until this snapshot finishes. DropDex will switch automatically.`
                : 'DropDex will activate this library automatically when processing finishes.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onViewStatus}
          className="shrink-0 rounded-xl border border-primary/25 bg-primary/10 px-4 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/15"
        >
          View status
        </button>
      </div>
      <div className="h-1.5 bg-[var(--color-surface)]">
        <div
          className="h-full bg-primary transition-[width] duration-500"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </section>
  );
}
