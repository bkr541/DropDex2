import { ProfileSwitch } from './ProfileSwitch';
import { SurfaceCard } from '../ui/display/SurfaceCard';
import { useState } from 'react';
import { Cloud, CloudUpload, Refresh, Square } from 'iconoir-react/regular';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { logger } from '../../lib/logger';
import { fetchAllImportTracks, previewSyncStore, usePreviewSync } from '../../lib/preview/previewSync';
import { fetchPreviewStates } from '../../lib/queries/trackPreviews';
import type { RekordboxTrack } from '../../types';
import { ControlButton } from '../ui/controls';
import { Dialog, QuietProgress, quietOverallPercent, type QuietPhase } from '../ui/feedback';
import { NoticeCard } from '../ui/feedback/NoticeCard';
import { TrackSyncSelector } from './TrackSyncSelector';

/** The phases of a cloud sync: getting ready, uploading the previews, and done. */
const SYNC_PHASES: readonly QuietPhase[] = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'upload', label: 'Upload' },
  { id: 'complete', label: 'Complete' },
];

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
    if (usb.status !== 'connected') { setMessage('Connect your USB first. DropDex reads your tracks from it to make the Cloud copies. You can do that on the USB Management page.'); return; }
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
    <section className="profile-group" data-testid="streaming-sync-group">
      <h2 className="profile-heading"><Cloud width={11} height={11} aria-hidden="true" />Streaming</h2>
      <SurfaceCard as="div" className="profile-records divide-y divide-[var(--color-border-faint)]">
        <div className="profile-record flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p id="streaming-sync-label" className="text-xs font-medium">Sync my music to the DropDex Cloud</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Lets you listen to your tracks and audition them away from your USB, on any device you sign in on. DropDex stores a smaller preview of each track in your own private Cloud folder and leaves your original files exactly as they are.
            </p>
          </div>
          <ProfileSwitch
            checked={allowed}
            aria-labelledby="streaming-sync-label"
            data-testid="streaming-sync-toggle"
            onClick={toggle}
            disabled={running}
          />
        </div>

        {allowed && !selecting && (
          <div className="space-y-3 p-4" data-testid="streaming-sync-panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold">{trackCount != null ? `${trackCount.toLocaleString()} tracks in your library` : 'Import your library first'}</p>
                <p className="text-xs text-muted-foreground">
                  {trackCount != null
                    ? `${sourceName ? `From ${sourceName}. ` : ''}Syncing all of them would take ${approxSize(trackCount)} in your Cloud (a rough estimate).`
                    : 'Once your Rekordbox library is imported, you can sync its tracks here.'}
                </p>
              </div>
              <ControlButton variant="primary" disabled={trackCount == null || running || loadingStates} onClick={openSync} data-testid="streaming-sync-button">
                {loadingStates ? <Refresh className="animate-spin" width={14} height={14} aria-hidden="true" /> : <CloudUpload width={14} height={14} aria-hidden="true" />} Sync to cloud
              </ControlButton>
            </div>
            {message && (
              <div data-testid="streaming-sync-notice"><NoticeCard tone="info">{message}</NoticeCard></div>
            )}
          </div>
        )}

        {allowed && selecting && importId && (
          <TrackSyncSelector importId={importId} syncedKeys={syncedKeys} onCancel={() => setSelecting(false)} onSync={start} />
        )}

        {sync.phase !== 'idle' && (
          <div className="p-4" data-testid="streaming-sync-progress">
            <QuietProgress
              title="Cloud sync"
              phases={SYNC_PHASES}
              activeIndex={sync.phase === 'preparing' ? 0 : sync.phase === 'running' || sync.phase === 'error' ? 1 : 2}
              percent={sync.phase === 'done' ? 100 : quietOverallPercent(sync.phase === 'preparing' ? 0 : 1, SYNC_PHASES.length, sync.total ? Math.round((sync.processed / sync.total) * 100) : 0)}
              stagePercent={sync.phase === 'preparing' ? 0 : sync.total ? Math.round((sync.processed / sync.total) * 100) : 0}
              status={sync.phase === 'done' ? 'done' : sync.phase === 'error' ? 'failed' : 'running'}
              caption={sync.phase === 'error' ? 'Stopped' : sync.phase === 'done' && sync.cancelled ? 'Stopped' : undefined}
              headline={
                sync.phase === 'preparing' ? 'Getting ready…'
                : sync.phase === 'running' ? `${sync.current ?? 'Working…'} · ${sync.processed.toLocaleString()} of ${sync.total.toLocaleString()}`
                : sync.phase === 'done' ? (sync.cancelled ? 'Sync stopped' : sync.failed === 0 ? 'Sync complete' : 'Sync finished with some problems')
                : null
              }
              figures={sync.phase === 'error' ? undefined : [
                { label: 'Synced', value: sync.synced.toLocaleString() },
                { label: 'Up to date', value: sync.skipped.toLocaleString() },
                { label: 'Could not sync', value: sync.failed.toLocaleString() },
              ]}
            >
              {running && (
                <div className="flex justify-center">
                  <ControlButton variant="danger-outline" onClick={() => previewSyncStore.cancel()}><Square width={14} height={14} aria-hidden="true" /> Stop</ControlButton>
                </div>
              )}
              {sync.phase === 'done' && (
                <>
                  {sync.failures.length > 0 && (
                    <ul className="max-h-40 divide-y divide-[var(--color-control-border-soft)] overflow-y-auto rounded-[var(--radius-control)] border border-[var(--color-control-border)] bg-transparent px-3 text-xs">
                      {sync.failures.slice(0, 50).map((failure) => (
                        <li key={failure.trackId} className="py-2"><span className="font-semibold">{failure.title}</span> <span className="text-muted-foreground">— {failure.message}</span></li>
                      ))}
                      {sync.failures.length > 50 && <li className="py-2 text-muted-foreground">…and {(sync.failures.length - 50).toLocaleString()} more (see the Developer tab's log).</li>}
                    </ul>
                  )}
                  <div className="flex justify-center"><ControlButton variant="primary" onClick={() => previewSyncStore.reset()}>Done</ControlButton></div>
                </>
              )}
              {sync.phase === 'error' && (
                <>
                  <NoticeCard tone="error">{sync.message}</NoticeCard>
                  <div className="flex justify-center"><ControlButton variant="secondary" onClick={() => previewSyncStore.reset()}>Close</ControlButton></div>
                </>
              )}
            </QuietProgress>
          </div>
        )}
      </SurfaceCard>

      <Dialog
        open={dialogOpen}
        title="Sync your tracks to the Cloud"
        onClose={() => setDialogOpen(false)}
        actions={[
          { label: 'Cancel', variant: 'secondary', onClick: () => setDialogOpen(false) },
          { label: 'Select Tracks', variant: 'secondary', onClick: () => void selectTracks() },
          { label: 'Sync All', variant: 'primary', onClick: () => void syncAll() },
        ]}
      >
        <p>DropDex makes a smaller 160 kbps copy of each track and uploads it to your private Cloud folder. Your original files are never changed. Tracks that are already synced and haven't changed are skipped.</p>
        <p className="mt-2 text-muted-foreground">Sync all {trackCount != null ? trackCount.toLocaleString() : ''} tracks, or choose which ones to sync.</p>
      </Dialog>
    </section>
  );
}
