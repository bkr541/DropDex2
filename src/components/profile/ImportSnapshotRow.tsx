import { cn } from '../../lib/utils';
import { getImportHistoryPresentation } from '../../lib/rekordbox/importHistoryPresentation';
import { isPendingHardDelete, isUsableLibrarySnapshot } from '../../lib/rekordbox/libraryDeletion';
import { getImportProgress, isImportInFlight, isImportStalled } from '../../lib/rekordbox/importLifecycle';
import type { RekordboxImport } from '../../types';
import { ControlButton } from '../ui/controls';

interface ImportSnapshotRowProps {
  snapshot: RekordboxImport;
  isActive: boolean;
  onOpen: (snapshot: RekordboxImport) => void;
  onMakeActive: (snapshot: RekordboxImport) => void;
  /** Resume a paused or interrupted import, or retry a failed one. */
  onResumeOrRetry: (snapshot: RekordboxImport) => void;
  onDelete: (snapshot: RekordboxImport) => void;
}

/** One library snapshot (one exportLibrary.db import): its file, when and how big, its status, and what can be done with it. */
export function ImportSnapshotRow({ snapshot: imp, isActive, onOpen, onMakeActive, onResumeOrRetry, onDelete }: ImportSnapshotRowProps) {
  const importPresentation = getImportHistoryPresentation(imp.status, Boolean(imp.retryable), imp.analysis_status);
  const importProgress = getImportProgress(imp);
  const importInFlight = isImportInFlight(imp);
  const importStalled = isImportStalled(imp);
  const showStatusBadge = imp.status !== 'completed'
    || (imp.analysis_status !== 'completed' && imp.analysis_status !== 'not_requested');
  const resumable = imp.status === 'completed' || imp.status === 'paused' || imp.status === 'interrupted';

  return (
    <div data-testid={`import-history-row-${imp.id}`} className="p-4 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <ControlButton
            type="button"
            variant="ghost"
            onClick={() => onOpen(imp)}
            aria-label={`Open import ${imp.source_filename}`}
            className="max-w-full text-left font-mono text-sm font-bold"
          >
            {imp.source_filename}
          </ControlButton>
          {isActive && (
            <span className="text-[9px] font-bold capitalize tracking-widest px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full shrink-0">
              Active
            </span>
          )}
          {showStatusBadge && (
            <span className={cn(
              'text-[9px] font-bold capitalize tracking-widest px-1.5 py-0.5 rounded-full shrink-0',
              importPresentation.tone === 'error' ? 'bg-red-500/10 text-red-400' :
              (importPresentation.tone === 'warning' || importStalled) ? 'bg-amber-500/10 text-amber-400' :
              'bg-blue-500/10 text-blue-400',
            )}>
              {importStalled ? 'Interrupted' : importPresentation.label}
            </span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
          {new Date(imp.imported_at).toLocaleDateString()} · {imp.track_count.toLocaleString()} tracks · {imp.playlist_count} playlists
        </p>
        {importInFlight && (
          <div className="mt-2 max-w-md">
            <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
              <span className="truncate">{importProgress.currentTrackLabel || 'Preparing current track…'}</span>
              <span className="shrink-0 font-mono">{importProgress.percent}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface)]">
              <div className="h-full rounded-full bg-primary" style={{ width: `${importProgress.percent}%` }} />
            </div>
          </div>
        )}
        {(imp.status === 'failed' || imp.status === 'cancelled') && imp.error_message && (
          <p className="text-[10px] text-red-400 mt-1">{imp.error_message}</p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0 pt-0.5">
        {!isActive && !importInFlight && !importStalled && isUsableLibrarySnapshot(imp) && importPresentation.canActivate && (
          <button onClick={() => onMakeActive(imp)} className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors">
            Make Active
          </button>
        )}
        {(importPresentation.canRetry || importStalled) && (
          <button onClick={() => onResumeOrRetry(imp)} className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors">
            {resumable ? 'Resume' : 'Retry'}
          </button>
        )}
        {(!importInFlight || imp.retryable || isPendingHardDelete(imp)) && (
          <button onClick={() => onDelete(imp)} className="text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors">
            {isPendingHardDelete(imp) ? 'Retry Delete' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}
