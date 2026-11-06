import { useState } from 'react';
import { Cloud, CloudUpload, Information, StopFilled, WarningAlt, CheckmarkFilled, CircleDash } from '@carbon/icons-react';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { logger } from '../../lib/logger';
import { fetchAllImportTracks, previewSyncStore, usePreviewSync } from '../../lib/preview/previewSync';
import { fetchPreviewStates } from '../../lib/queries/trackPreviews';
import { cn } from '../../lib/utils';
import type { RekordboxTrack } from '../../types';
import { ControlButton } from '../ui/controls';
import { Dialog } from '../ui/feedback';
import { TrackSyncSelector } from './TrackSyncSelector';

const STORAGE_KEY = 'dropdex:streaming:cloud-sync-allowed';
/** A 160 kbps preview of a 4-minute track is about 5 MB. Only used for the rough size shown on the page. */
const APPROX_PREVIEW_MB = 5;

function readAllowed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeAllowed(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch { /* the switch still works for this visit */ }
}

function approxSize(trackCount: number): string {
  const gb = (trackCount * APPROX_PREVIEW_MB) / 1000;
  return gb >= 1 ? `about ${gb.toFixed(1)} GB` : `about ${Math.round(trackCount * APPROX_PREVIEW_MB)} MB`;
}

interface StreamingSyncGroupProps {
  /** The active import, or null when nothing has been imported yet. */
  importId: string | null;
  trackCount: number | null;
  sourceName: string | null;
  /** The USB name the import came from, used to check the connected drive is the right one. */
  deviceName: string | null;
}

/**
 * Library tab: Streaming. One switch lets DropDex sync your music to the DropDex cloud. With it on, the Sync button asks whether
 * to sync everything or only the tracks you pick, then makes a 160 kbps preview of each track and uploads it to your own cloud folder.
 */
export function StreamingSyncGroup({ importId, trackCount, sourceName, deviceName }: StreamingSyncGroupProps) {
  const usb = useUsbConnection();
  const sync = usePreviewSync();
  const [allowed, setAllowed] = useState(readAllowed);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [syncedKeys, setSyncedKeys] = useState<ReadonlySet<string>>(new Set());
  const [loadingStates, setLoadingStates] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const desktop = typeof window !== 'undefined' && Boolean(window.dropdexDesktop);
  const running = sync.phase === 'preparing' || sync.phase === 'running';

  const toggle = () => {
    const next = !allowed;
    setAllowed(next);
    writeAllowed(next);
    if (!next) { setDialogOpen(false); setSelecting(false); setMessage(null); }
  };

  const openSync = () => {
    setMessage(null);
    if (!desktop) { setMessage('Syncing needs the DropDex desktop app, because it reads the files from your USB.'); return; }
    if (usb.status !== 'connected') { setMessage('Connect your USB first. DropDex reads your tracks from it to make the cloud copies. You can do that on the USB Management page.'); return; }
    setDialogOpen(true);
  };

  const start = (tracks: RekordboxTrack[]) => {
    setSelecting(false);
    void previewSyncStore.start(tracks, { expectedVolume: deviceName });
  };

  const syncAll = async () => {
    setDialogOpen(false);
    if (!importId) return;
    try {
      start(await fetchAllImportTracks(importId));
    } catch (err: unknown) {
      logger.error('preview.sync.load_tracks_failed', { importId, message: err instanceof Error ? err.message : String(err) });
      setMessage('Could not load your tracks to sync. Try again.');
    }
  };

  const selectTracks = async () => {
    setDialogOpen(false);
    setLoadingStates(true);
    try {
      const states = await fetchPreviewStates();
      setSyncedKeys(new Set([...states].filter(([, state]) => state.status === 'ready').map(([key]) => key)));
    } catch (err: unknown) {
      logger.error('preview.select.states_failed', { message: err instanceof Error ? err.message : String(err) });
      setSyncedKeys(new Set());
    } finally {
      setLoadingStates(false);
      setSelecting(true);
    }
  };

  return (
    <section className="space-y-3" data-testid="streaming-sync-group">
      <h2 className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground"><Cloud size={11} />Streaming</h2>
      <div className="glass divide-y divide-[var(--color-border-faint)] rounded-2xl">
        <div className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <p id="streaming-sync-label" className="text-sm font-bold">Sync my music to the DropDex cloud</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Lets you listen to your tracks and audition them away from your USB, on any device you sign in on. DropDex stores a smaller preview of each track in your own private cloud folder and leaves your original files exactly as they are.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={allowed}
            aria-labelledby="streaming-sync-label"
            data-testid="streaming-sync-toggle"
            onClick={toggle}
            disabled={running}
            className={cn(
              'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50',
              allowed ? 'border-primary bg-primary' : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)]',
            )}
          >
            <span className={cn('absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-all', allowed ? 'left-[22px]' : 'left-0.5')} />
          </button>
        </div>

        {allowed && !selecting && (
          <div className="space-y-3 p-4" data-testid="streaming-sync-panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold">{trackCount != null ? `${trackCount.toLocaleString()} tracks in your library` : 'Import your library first'}</p>
                <p className="text-xs text-muted-foreground">
                  {trackCount != null
                    ? `${sourceName ? `From ${sourceName}. ` : ''}Syncing all of them would take ${approxSize(trackCount)} in your cloud (a rough estimate).`
                    : 'Once your Rekordbox library is imported, you can sync its tracks here.'}
                </p>
              </div>
              <ControlButton variant="primary" disabled={trackCount == null || running || loadingStates} onClick={openSync} data-testid="streaming-sync-button">
                {loadingStates ? <CircleDash className="animate-spin" size={14} /> : <CloudUpload size={14} />} Sync to cloud
              </ControlButton>
            </div>
            {message && (
              <p className="flex items-start gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-white/[0.03] p-3 text-xs text-muted-foreground" role="status" data-testid="streaming-sync-notice">
                <Information size={14} className="mt-0.5 shrink-0 text-primary" /> {message}
              </p>
            )}
          </div>
        )}

        {allowed && selecting && importId && (
          <TrackSyncSelector importId={importId} syncedKeys={syncedKeys} onCancel={() => setSelecting(false)} onSync={start} />
        )}

        {sync.phase !== 'idle' && (
          <div className="space-y-3 p-4" data-testid="streaming-sync-progress">
            {running && (
              <>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-bold">{sync.phase === 'preparing' ? 'Getting ready…' : sync.current ?? 'Working…'}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">{sync.processed.toLocaleString()} of {sync.total.toLocaleString()}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${sync.total ? Math.round((sync.processed / sync.total) * 100) : 0}%` }} /></div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">{sync.synced.toLocaleString()} synced · {sync.skipped.toLocaleString()} already up to date{sync.failed > 0 ? ` · ${sync.failed.toLocaleString()} could not be synced` : ''}</p>
                  <ControlButton variant="danger-outline" onClick={() => previewSyncStore.cancel()}><StopFilled size={14} /> Stop</ControlButton>
                </div>
              </>
            )}
            {sync.phase === 'done' && (
              <>
                <p className="flex items-center gap-2 text-sm font-black">
                  {sync.failed === 0 && !sync.cancelled ? <CheckmarkFilled size={16} className="text-emerald-500" /> : <WarningAlt size={16} className="text-amber-400" />}
                  {sync.cancelled ? 'Sync stopped' : sync.failed === 0 ? 'Sync complete' : 'Sync finished with some problems'}
                </p>
                <p className="text-xs text-muted-foreground">{sync.synced.toLocaleString()} synced · {sync.skipped.toLocaleString()} already up to date · {sync.failed.toLocaleString()} could not be synced</p>
                {sync.failures.length > 0 && (
                  <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-3 text-[11px]">
                    {sync.failures.slice(0, 50).map((failure) => (
                      <li key={failure.trackId}><span className="font-bold">{failure.title}</span> <span className="text-muted-foreground">— {failure.message}</span></li>
                    ))}
                    {sync.failures.length > 50 && <li className="text-muted-foreground">…and {(sync.failures.length - 50).toLocaleString()} more (see the Developer tab's log).</li>}
                  </ul>
                )}
                <ControlButton variant="primary" onClick={() => previewSyncStore.reset()}>Done</ControlButton>
              </>
            )}
            {sync.phase === 'error' && (
              <>
                <p className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300" role="alert"><WarningAlt size={16} className="mt-0.5 shrink-0" /> {sync.message}</p>
                <ControlButton variant="neutral" onClick={() => previewSyncStore.reset()}>Close</ControlButton>
              </>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={dialogOpen}
        title="Sync your tracks to the cloud"
        onClose={() => setDialogOpen(false)}
        actions={[
          { label: 'Cancel', variant: 'neutral', onClick: () => setDialogOpen(false) },
          { label: 'Select Tracks', variant: 'neutral', onClick: () => void selectTracks() },
          { label: 'Sync All', variant: 'primary', onClick: () => void syncAll() },
        ]}
      >
        <p>DropDex makes a smaller 160 kbps copy of each track and uploads it to your private cloud folder. Your original files are never changed. Tracks that are already synced and haven't changed are skipped.</p>
        <p className="mt-2 text-muted-foreground">Sync all {trackCount != null ? trackCount.toLocaleString() : ''} tracks, or choose which ones to sync.</p>
      </Dialog>
    </section>
  );
}
