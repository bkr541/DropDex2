import { Trash } from 'iconoir-react/regular';
import { ToolbarIconButton, ToolbarIconGroup } from '../ui/controls/ToolbarIconButton';
import { getImportHistoryPresentation } from '../../lib/rekordbox/importHistoryPresentation';
import { isPendingHardDelete, isUsableLibrarySnapshot } from '../../lib/rekordbox/libraryDeletion';
import { getImportProgress, isImportInFlight, isImportStalled } from '../../lib/rekordbox/importLifecycle';
import type { RekordboxImport } from '../../types';
import { ControlButton } from '../ui/controls';
import { NoticeCard, ProgressBar, StatusBadge } from '../ui/feedback';

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
  const statusTone = importPresentation.tone === 'info' ? 'active' : importPresentation.tone;
  const resumable = imp.status === 'completed' || imp.status === 'paused' || imp.status === 'interrupted';

  return (
    <div data-testid={`import-history-row-${imp.id}`} className="profile-record grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`/imports/${encodeURIComponent(imp.id)}`}
            onClick={(event) => {
              if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                event.preventDefault();
                onOpen(imp);
              }
            }}
            aria-label={`Open import ${imp.source_filename}`}
            className="min-w-0 break-all text-sm font-medium hover:text-[var(--color-control-primary-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-control-focus)] focus-visible:outline-offset-2"
          >
            {imp.source_filename}
          </a>
          {isActive && <StatusBadge tone="success">Active</StatusBadge>}
          {showStatusBadge && (
            <StatusBadge tone={importStalled ? 'warning' : statusTone}>
              {importStalled ? 'Interrupted' : importPresentation.label}
            </StatusBadge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground font-mono">
          {new Date(imp.imported_at).toLocaleDateString()} · {imp.track_count.toLocaleString()} tracks · {imp.playlist_count} playlists
        </p>
        {importInFlight && (
          <div className="mt-2 max-w-md">
            <p className="mb-1 truncate text-xs text-muted-foreground">{importProgress.currentTrackLabel || 'Preparing current track…'}</p>
            <ProgressBar value={importProgress.percent} label="Import progress" showValue />
          </div>
        )}
        {(imp.status === 'failed' || imp.status === 'cancelled') && imp.error_message && (
          <NoticeCard tone="error" className="mt-1">{imp.error_message}</NoticeCard>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end justify-self-end gap-2">
        {!isActive && !importInFlight && !importStalled && isUsableLibrarySnapshot(imp) && importPresentation.canActivate && (
          <ControlButton variant="secondary" onClick={() => onMakeActive(imp)}>
            Make Active
          </ControlButton>
        )}
        {(importPresentation.canRetry || importStalled) && (
          <ControlButton variant="secondary" onClick={() => onResumeOrRetry(imp)}>
            {resumable ? 'Resume' : 'Retry'}
          </ControlButton>
        )}
        {(!importInFlight || imp.retryable || isPendingHardDelete(imp)) && (
          <div className="cue-studio">
            <ToolbarIconGroup>
              <ToolbarIconButton label={`${isPendingHardDelete(imp) ? 'Retry delete' : 'Delete'} import ${imp.source_filename}`} onClick={() => onDelete(imp)}>
                <Trash width={16} height={16} aria-hidden="true" />
              </ToolbarIconButton>
            </ToolbarIconGroup>
          </div>
        )}
      </div>
    </div>
  );
}
