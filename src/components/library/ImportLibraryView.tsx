import type { RekordboxImport } from '../../types';
import { getImportHistoryPresentation } from '../../lib/rekordbox/importHistoryPresentation';
import { getImportProgress, isImportInFlight, isImportStalled } from '../../lib/rekordbox/importLifecycle';
import { isPendingHardDelete, isUsableLibrarySnapshot } from '../../lib/rekordbox/libraryDeletion';
import { CheckCircle, Database, Refresh, Upload, Xmark } from 'iconoir-react/regular';
import { ControlButton } from '../ui/controls';
import { StatusBadge } from '../ui/feedback';
import { ImportTrackBrowser } from './ImportTrackBrowser';
import '../ui/studio-surface.css';
import '../cues/cue-studio.css';
import './import-library.css';

export function ImportLibraryView({
  item,
  isActive,
  onResume,
  onRetryImport,
  onMakeActive,
  onRetryDelete,
  onBack,
}: {
  item: RekordboxImport;
  isActive: boolean;
  onResume: () => void;
  onRetryImport: () => void;
  onMakeActive: () => void;
  onRetryDelete?: () => void;
  onBack?: () => void;
}) {
  const presentation = getImportHistoryPresentation(
    item.status,
    Boolean(item.retryable),
    item.analysis_status,
  );
  const progress = getImportProgress(item);
  const inFlight = isImportInFlight(item);
  const stalled = isImportStalled(item);
  const statusLabel = stalled ? 'Interrupted' : presentation.label;
  const statusTone = stalled ? 'warning' : presentation.tone;
  const analysisCanResume = (item.status === 'completed' || item.status === 'paused' || item.status === 'interrupted')
    && !inFlight
    && item.analysis_status !== 'completed'
    && item.analysis_status !== 'not_requested';

  return (
    <section className="studio-surface cue-studio import-library-studio" data-testid="import-status-screen">
      <div className="import-library__summary">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
              <Database className="text-primary" width={20} height={20} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold truncate">{item.source_filename}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{item.device_name || 'Imported Rekordbox library'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <StatusBadge tone={statusTone === 'info' ? 'active' : statusTone}>{statusLabel}</StatusBadge>
            {onBack && (
              <ControlButton variant="ghost" onClick={onBack} aria-label="Close imported library" title="Close imported library">
                <Xmark width={18} height={18} aria-hidden="true" />
              </ControlButton>
            )}
          </div>
        </div>

        {stalled && (
          <div className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-sm font-bold text-amber-300">This import stopped reporting progress</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              DropDex will no longer treat this historical job as active. Retry the import, or resume analysis when the metadata snapshot is complete.
            </p>
          </div>
        )}

        {inFlight && (
          <div className="mb-5 rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold">Analysis is continuing in the background</p>
              <span className="font-mono text-xs font-bold text-primary">{progress.percent}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-surface)]">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {progress.processed.toLocaleString()} / {progress.total.toLocaleString()} tracks
              {progress.currentTrackLabel ? ` · ${progress.currentTrackLabel}` : ''}
            </p>
            {!isActive && (
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                Your previous active library remains visible until this snapshot reaches a terminal state. A successful snapshot will become active automatically.
              </p>
            )}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><dt className="text-[9px] uppercase text-muted-foreground">Tracks</dt><dd className="font-mono font-bold">{item.track_count.toLocaleString()}</dd></div>
          <div><dt className="text-[9px] uppercase text-muted-foreground">Playlists</dt><dd className="font-mono font-bold">{item.playlist_count.toLocaleString()}</dd></div>
          <div><dt className="text-[9px] uppercase text-muted-foreground">Imported</dt><dd className="font-mono text-xs font-bold">{new Date(item.imported_at).toLocaleDateString()}</dd></div>
          <div><dt className="text-[9px] uppercase text-muted-foreground">Library</dt><dd className="font-mono text-xs font-bold">{isActive ? 'Active' : inFlight ? 'Pending' : 'Snapshot'}</dd></div>
        </dl>

        {item.error_message && (
          <p className="mt-5 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">{item.error_message}</p>
        )}

        <div className="import-library__summary-actions mt-4 flex flex-wrap items-center gap-3">
          {!isActive && !inFlight && !stalled && isUsableLibrarySnapshot(item) && presentation.canActivate && (
            <ControlButton type="button" variant="primary" onClick={onMakeActive}>
              <CheckCircle width={16} height={16} aria-hidden="true" /> Make Active
            </ControlButton>
          )}
          {analysisCanResume && (
            <ControlButton type="button" variant="primary" onClick={onResume}>
              <Refresh width={16} height={16} aria-hidden="true" /> Resume Analysis
            </ControlButton>
          )}
          {(presentation.canRetry || stalled) && !analysisCanResume && (
            <ControlButton type="button" variant="primary" onClick={onRetryImport}>
              <Upload width={16} height={16} aria-hidden="true" /> Retry Import
            </ControlButton>
          )}
          {isPendingHardDelete(item) && onRetryDelete && (
            <ControlButton type="button" variant="danger-outline" onClick={onRetryDelete}>
              Retry Delete
            </ControlButton>
          )}
        </div>
      </div>
      <ImportTrackBrowser key={item.id} importId={item.id} />
    </section>
  );
}

