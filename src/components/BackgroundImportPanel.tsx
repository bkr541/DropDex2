import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchRekordboxAnalysisStatus,
  isExpectedHardDeleteNotFound,
  pauseRekordboxAnalysis,
  resumeRekordboxAnalysis,
  type AnalysisStatusResponse,
} from '../lib/api/rekordboxImport';
import { announceRekordboxAnalysisProgress } from '../lib/rekordbox/analysisProgressEvents';
import { ProgressBar } from './ui/feedback';
import { CheckmarkFilled, CircleDash, Close, Pause, Play, TrashCan, WarningAlt } from '@carbon/icons-react';

const POLL_MS = 2500;

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
      const next = await fetchRekordboxAnalysisStatus(importId, accessToken);
      if (!mounted.current) return;
      setStatus(next);
      setError(null);
      const readyCount = next.tracks_ready_count ?? next.parsed_track_count ?? 0;
      if (lastReadyCount.current !== readyCount) {
        lastReadyCount.current = readyCount;
        announceRekordboxAnalysisProgress({ importId, tracksReady: readyCount });
      }
      if (
        ['completed', 'partial', 'failed', 'paused'].includes(next.analysis_status) &&
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

  const affectedTrackIds = useMemo(
    () => Array.from(new Set(status?.unresolved_targets.map((target) => target.track_id) ?? [])),
    [status],
  );
  const paused = status?.analysis_status === 'paused' || status?.job_status === 'paused';
  const terminal = status ? ['completed', 'partial', 'failed'].includes(status.analysis_status) : false;
  const progress = status?.progress_percent ?? 0;

  const runAction = async (nextAction: 'pause' | 'resume') => {
    setAction(nextAction);
    setError(null);
    try {
      if (nextAction === 'pause') await pauseRekordboxAnalysis(importId, accessToken);
      if (nextAction === 'resume') {
        await resumeRekordboxAnalysis(importId, accessToken, { affectedTrackIds });
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
    <aside className="fixed bottom-20 right-4 z-[75] w-[min(390px,calc(100vw-2rem))] rounded-2xl border border-[var(--color-border-subtle)] bg-background/95 p-4 shadow-2xl backdrop-blur-xl md:bottom-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black">Rekordbox Import</p>
          <p className="mt-0.5 text-[11px] capitalize text-muted-foreground">
            {(status?.readiness_stage ?? 'library_metadata_ready').replaceAll('_', ' ')}
          </p>
        </div>
        {usbReleased ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Hide import panel"
            className="text-muted-foreground hover:text-foreground"
          >
            <Close size={16} />
          </button>
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
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-xs text-emerald-100">
          <CheckmarkFilled size={15} className="shrink-0 text-emerald-400" />
          USB released. The library is ready to browse.
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
          <div className="flex items-start gap-2">
            <WarningAlt size={15} className="mt-0.5 shrink-0 text-amber-400" />
            <p>Book metadata is ready. DropDex is still reading required DAT/EXT files, so keep the USB connected and Rekordbox closed.</p>
          </div>
          <button
            type="button"
            onClick={onManageLocalUpload}
            className="mt-3 w-full rounded-lg border border-amber-400/30 px-3 py-2 font-bold text-amber-100 hover:bg-amber-400/10"
          >
            Manage USB Upload
          </button>
        </div>
      )}

      <ProgressBar className="mt-4" value={progress} tone="active" label="Rekordbox import progress" />
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-[var(--color-surface)] p-2">
          <p className="text-muted-foreground">Tracks ready</p>
          <p className="mt-0.5 font-bold">{(status?.tracks_ready_count ?? status?.parsed_track_count ?? 0).toLocaleString()}</p>
        </div>
        <div className="rounded-lg bg-[var(--color-surface)] p-2">
          <p className="text-muted-foreground">Tracks remaining</p>
          <p className="mt-0.5 font-bold">{(status?.tracks_remaining_count ?? 0).toLocaleString()}</p>
        </div>
        <div className="rounded-lg bg-[var(--color-surface)] p-2">
          <p className="text-muted-foreground">Estimate</p>
          <p className="mt-0.5 font-bold">{estimateLabel(status?.estimated_seconds_remaining)}</p>
        </div>
        <div className="rounded-lg bg-[var(--color-surface)] p-2">
          <p className="text-muted-foreground">Raw DAT/EXT archive</p>
          <p className="mt-0.5 font-bold capitalize">{status?.raw_archival_status ?? 'skipped'}</p>
        </div>
      </div>

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
          {!terminal && !paused && (
            <button type="button" disabled={action !== null} onClick={() => void runAction('pause')} className="flex items-center justify-center gap-2 rounded-xl border border-primary/30 px-3 py-2 text-xs font-bold text-primary disabled:opacity-50">
              {action === 'pause' ? <CircleDash size={13} className="animate-spin" /> : <Pause size={13} />} Pause
            </button>
          )}
          {paused && (
            <button type="button" disabled={action !== null} onClick={() => void runAction('resume')} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              {action === 'resume' ? <CircleDash size={13} className="animate-spin" /> : <Play size={13} />} Resume
            </button>
          )}
          <button type="button" disabled={action !== null || deletionPending} onClick={onRequestDelete} className="flex items-center justify-center gap-2 rounded-xl border border-red-500/30 px-3 py-2 text-xs font-bold text-red-300 disabled:opacity-50">
            {deletionPending ? <CircleDash size={13} className="animate-spin" /> : <TrashCan size={13} />} {deletionPending ? 'Deleting…' : 'Delete Import'}
          </button>
        </div>
      )}
    </aside>
  );
}
