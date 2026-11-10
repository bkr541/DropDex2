import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchRekordboxAnalysisStatus,
  isExpectedHardDeleteNotFound,
  pauseRekordboxAnalysis,
  resumeRekordboxAnalysis,
  type AnalysisStatusResponse,
} from '../lib/api/rekordboxImport';
import { announceRekordboxAnalysisProgress } from '../lib/rekordbox/analysisProgressEvents';
import { QuietProgress, quietOverallPercent, type QuietPhase } from './ui/feedback';
import { CheckCircle, Pause, Play, Refresh, Trash, Upload, WarningTriangle, Xmark } from 'iconoir-react/regular';
import { ControlButton } from './ui/controls';

const POLL_MS = 2500;

const IMPORT_PHASES: QuietPhase[] = [
  { id: 'library', label: 'Library' },
  { id: 'files', label: 'Read files' },
  { id: 'analysis', label: 'Analyze' },
  { id: 'complete', label: 'Complete' },
];

function estimateLabel(seconds: number | null | undefined): string {
  if (seconds == null) return 'Measuring throughput…';
  if (seconds < 60) return 'Under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `About ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `About ${hours} hr ${remainder} min` : `About ${hours} hr`;
}

export function BackgroundImportPanel({
  importId,
  accessToken,
  usbReleased,
  onClose,
  onChanged,
  onManageLocalUpload,
  onRequestDelete,
  deletionPending,
}: {
  importId: string;
  accessToken: string;
  usbReleased: boolean;
  onClose: () => void;
  onChanged: () => void;
  onManageLocalUpload: () => void;
  onRequestDelete: () => void;
  deletionPending: boolean;
}) {
  const [status, setStatus] = useState<AnalysisStatusResponse | null>(null);
  const [action, setAction] = useState<'pause' | 'resume' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const lastNotifiedStatus = useRef<string | null>(null);
  const lastReadyCount = useRef<number | null>(null);
  const hardDeleteCompleteRef = useRef(false);
  const onChangedRef = useRef(onChanged);

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const load = useCallback(async () => {
    if (hardDeleteCompleteRef.current) return;
    try {
      const next = await fetchRekordboxAnalysisStatus(importId, accessToken, undefined, false);
      if (!mounted.current) return;
      setStatus(next);
      setError(null);
      const readyCount = next.tracks_ready_count ?? next.parsed_track_count ?? 0;
      if (lastReadyCount.current !== readyCount) {
        lastReadyCount.current = readyCount;
        announceRekordboxAnalysisProgress({ importId, tracksReady: readyCount });
      }
      if (
        ['completed', 'partial', 'failed', 'paused', 'interrupted'].includes(next.analysis_status) &&
        lastNotifiedStatus.current !== next.analysis_status
      ) {
        lastNotifiedStatus.current = next.analysis_status;
        onChangedRef.current();
      }
    } catch (err) {
      if (mounted.current && isExpectedHardDeleteNotFound(err, deletionPending)) {
        // This exact import is known to be in a client-requested hard-delete
        // lifecycle, so disappearance is the expected terminal state. Stop this
        // panel's polling immediately even before React finishes unmounting it.
        hardDeleteCompleteRef.current = true;
        onChangedRef.current();
        onClose();
        return;
      }
      if (mounted.current) setError(err instanceof Error ? err.message : 'Could not refresh import progress.');
    }
  }, [accessToken, deletionPending, importId, onClose]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
    // The access token can rotate during a long import; restart polling with it.
  }, [load]);

  const runAction = async (nextAction: 'pause' | 'resume') => {
    setAction(nextAction);
    setError(null);
    try {
      if (nextAction === 'pause') await pauseRekordboxAnalysis(importId, accessToken);
      if (nextAction === 'resume') {
        await resumeRekordboxAnalysis(importId, accessToken);
      }
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${nextAction} this import.`);
    } finally {
      setAction(null);
    }
  };

  return (
    <BackgroundImportPanelView
      status={status}
      usbReleased={usbReleased}
      error={error}
      action={action}
      deletionPending={deletionPending}
      onClose={onClose}
      onManageLocalUpload={onManageLocalUpload}
      onRequestDelete={onRequestDelete}
      onPause={() => void runAction('pause')}
      onResume={() => void runAction('resume')}
    />
  );
}

/** The panel itself, drawn from its status. The live panel and Layout Lab both render this. */
export function BackgroundImportPanelView({
  status, usbReleased, error, action, deletionPending, onClose, onManageLocalUpload, onRequestDelete, onPause, onResume,
}: {
  status: AnalysisStatusResponse | null;
  usbReleased: boolean;
  error: string | null;
  action: 'pause' | 'resume' | null;
  deletionPending: boolean;
  onClose: () => void;
  onManageLocalUpload: () => void;
  onRequestDelete: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const paused = status?.analysis_status === 'paused' || status?.job_status === 'paused';
  const interrupted = Boolean(
    status && (
      status.analysis_status === 'interrupted' ||
      status.job_status === 'interrupted' ||
      (status.worker_status === 'failed' && status.worker_active === false)
    ),
  );
  const resumable = paused || interrupted;
  const terminal = status ? ['completed', 'partial', 'failed'].includes(status.analysis_status) : false;
  const progress = status?.progress_percent ?? 0;
  const activeIndex = terminal ? IMPORT_PHASES.length - 1 : usbReleased ? 2 : 1;

  return (
    <aside className="studio-surface profile-modal import-modal fixed bottom-20 right-4 z-[75] w-[min(390px,calc(100vw-2rem))] p-4 md:bottom-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="import-heading !m-0 !text-base">Rekordbox Import</h2>
          <p className="mt-0.5 text-[11px] capitalize text-muted-foreground">
            {(status?.readiness_stage ?? 'library_metadata_ready').replaceAll('_', ' ')}
          </p>
        </div>
        {usbReleased ? (
          <ControlButton type="button" variant="ghost" onClick={onClose} aria-label="Hide import panel">
            <Xmark width={16} height={16} aria-hidden="true" />
          </ControlButton>
        ) : (
          <span
            role="status"
            aria-label="USB reading is still active; this panel cannot be hidden"
            className="rounded-full border border-amber-400/30 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-amber-200"
          >
            Keep open
          </span>
        )}
      </div>

      {usbReleased ? (
        <div className="import-group import-group--success mt-3 flex items-center gap-3 text-xs text-green-100">
          <CheckCircle width={16} height={16} aria-hidden="true" className="shrink-0 text-green-500" />
          USB released. The library is ready to browse.
        </div>
      ) : (
        <div className="import-group import-group--amber mt-3 text-xs text-amber-100">
          <div className="flex items-start gap-3">
            <WarningTriangle width={16} height={16} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-400" />
            <p>Book metadata is ready. DropDex is still reading required DAT/EXT files, so keep the USB connected and Rekordbox closed.</p>
          </div>
          <ControlButton type="button" variant="secondary" onClick={onManageLocalUpload} className="mt-3 w-full">
            <Upload width={14} height={14} aria-hidden="true" /> Manage USB Upload
          </ControlButton>
        </div>
      )}

      <QuietProgress
        className="mt-4"
        title="Rekordbox import"
        phases={IMPORT_PHASES}
        activeIndex={activeIndex}
        stagePercent={progress}
        percent={quietOverallPercent(activeIndex, IMPORT_PHASES.length, progress, terminal && status?.analysis_status === 'completed')}
        status={status?.analysis_status === 'failed' ? 'failed' : terminal ? 'done' : 'running'}
        headline={paused ? 'Paused. Resume to keep analyzing tracks.' : interrupted ? 'Interrupted. Resume to pick up where it stopped.' : undefined}
        figures={[
          { label: 'Tracks ready', value: (status?.tracks_ready_count ?? status?.parsed_track_count ?? 0).toLocaleString() },
          { label: 'Remaining', value: (status?.tracks_remaining_count ?? 0).toLocaleString() },
          { label: 'Estimate', value: estimateLabel(status?.estimated_seconds_remaining) },
          { label: 'Raw archive', value: <span className="capitalize">{status?.raw_archival_status ?? 'skipped'}</span> },
        ]}
      />

      {status?.optional_archival_status && status.optional_archival_status !== 'skipped' && (
        <p className="mt-3 text-xs text-muted-foreground">
          Operator-enabled .2EX archival: <span className="font-bold capitalize">{status.optional_archival_status}</span>. It never blocks library readiness.
        </p>
      )}
      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
      {(status?.failed_track_count ?? 0) > 0 && (
        <p className="mt-3 text-xs text-amber-300">
          {(status?.failed_track_count ?? 0).toLocaleString()} track
          {status?.failed_track_count === 1 ? '' : 's'} need attention. Other tracks remain usable.
        </p>
      )}

      {usbReleased && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {!terminal && !resumable && (
            <ControlButton type="button" variant="secondary" disabled={action !== null} onClick={() => onPause()}>
              {action === 'pause' ? <Refresh width={13} height={13} aria-hidden="true" className="animate-spin" /> : <Pause width={13} height={13} aria-hidden="true" />} Pause
            </ControlButton>
          )}
          {resumable && (
            <ControlButton type="button" variant="primary" disabled={action !== null} onClick={() => onResume()}>
              {action === 'resume' ? <Refresh width={13} height={13} aria-hidden="true" className="animate-spin" /> : <Play width={13} height={13} aria-hidden="true" />} Resume
            </ControlButton>
          )}
          <ControlButton type="button" variant="danger-outline" disabled={action !== null || deletionPending} onClick={onRequestDelete}>
            {deletionPending ? <Refresh width={13} height={13} aria-hidden="true" className="animate-spin" /> : <Trash width={13} height={13} aria-hidden="true" />} {deletionPending ? 'Deleting…' : 'Delete Import'}
          </ControlButton>
        </div>
      )}
    </aside>
  );
}

