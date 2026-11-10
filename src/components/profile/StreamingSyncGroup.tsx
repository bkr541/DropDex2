import { ProfileSwitch } from './ProfileSwitch';
import { SurfaceCard } from '../ui/display/SurfaceCard';
import { useState } from 'react';
import { Cloud, CloudUpload, Refresh } from 'iconoir-react/regular';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { logger } from '../../lib/logger';
import { previewSyncStore, usePreviewSync } from '../../lib/preview/previewSync';
import { fetchPreviewStates } from '../../lib/queries/trackPreviews';
import type { RekordboxTrack } from '../../types';
import { ControlButton } from '../ui/controls';
import { NoticeCard } from '../ui/feedback/NoticeCard';
import { CloudSyncDialog } from './CloudSyncDialog';
import { CloudSyncProgressDialog } from './CloudSyncProgressDialog';
import { CloudTracksGroup } from './CloudTracksGroup';
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
  userId: string | null;
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
export function StreamingSyncGroup({ userId, importId, trackCount, sourceName, deviceName }: StreamingSyncGroupProps) {
  const usb = useUsbConnection();
  const sync = usePreviewSync();
  const [allowed, setAllowed] = useState(readAllowed);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [showTracks, setShowTracks] = useState(false);
  const [syncedKeys, setSyncedKeys] = useState<ReadonlySet<string>>(new Set());
  const [loadingStates, setLoadingStates] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const desktop = typeof window !== 'undefined' && Boolean(window.dropdexDesktop);
  const hasSync = sync.phase !== 'idle';
  const running = sync.phase === 'preparing' || sync.phase === 'running';

  const toggle = () => {
    const next = !allowed;
    setAllowed(next);
    writeAllowed(next);
    if (!next) { setDialogOpen(false); setSelecting(false); setMessage(null); }
  };

  const openSync = () => {
    setMessage(null);
    if (hasSync) { setDialogOpen(true); return; }
    if (!desktop) { setMessage('Syncing needs the DropDex desktop app, because it reads the files from your USB.'); return; }
    if (usb.status !== 'connected') { setMessage('Connect your USB first. DropDex reads your tracks from it to make the Cloud copies. You can do that on the USB Management page.'); return; }
    setDialogOpen(true);
  };

  const start = (source: RekordboxTrack[] | string) => {
    setSelecting(false);
    setDialogOpen(true);
    void previewSyncStore.start(source, { expectedVolume: deviceName });
  };

  const closeProgress = () => {
    setDialogOpen(false);
    if (!running) previewSyncStore.reset();
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

  if (showTracks && userId) {
    return (
      <section className="profile-group" data-testid="streaming-sync-group">
        <CloudTracksGroup key={userId} userId={userId} syncing={running} onBack={() => setShowTracks(false)} />
      </section>
    );
  }

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

        {!selecting && (allowed || userId) && (
          <div className="space-y-3 p-4" data-testid="streaming-sync-panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {allowed && <div className="min-w-0">
                <p className="text-sm font-bold">{trackCount != null ? `${trackCount.toLocaleString()} tracks in your library` : 'Import your library first'}</p>
                <p className="text-xs text-muted-foreground">
                  {trackCount != null
                    ? `${sourceName ? `From ${sourceName}. ` : ''}Syncing all of them would take ${approxSize(trackCount)} in your Cloud (a rough estimate).`
                    : 'Once your Rekordbox library is imported, you can sync its tracks here.'}
                </p>
              </div>}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {userId && <ControlButton variant="secondary" disabled={loadingStates} onClick={() => setShowTracks(true)}>See Tracks</ControlButton>}
                {allowed && (
                  <ControlButton variant="primary" disabled={!hasSync && (!importId || trackCount == null || loadingStates)} onClick={openSync} data-testid="streaming-sync-button">
                    {loadingStates ? <Refresh className="animate-spin" width={14} height={14} aria-hidden="true" /> : <CloudUpload width={14} height={14} aria-hidden="true" />}
                    {hasSync ? (running ? 'View sync progress' : 'View sync results') : 'Sync to cloud'}
                  </ControlButton>
                )}
              </div>
            </div>
            {message && (
              <div data-testid="streaming-sync-notice"><NoticeCard tone="info">{message}</NoticeCard></div>
            )}
          </div>
        )}

        {allowed && selecting && importId && (
          <TrackSyncSelector importId={importId} syncedKeys={syncedKeys} onCancel={() => setSelecting(false)} onSync={start} />
        )}
      </SurfaceCard>

      <CloudSyncDialog
        open={dialogOpen && !hasSync}
        trackCount={trackCount}
        onClose={() => setDialogOpen(false)}
        onSelectTracks={() => void selectTracks()}
        onSyncAll={() => { if (importId) start(importId); }}
      />
      <CloudSyncProgressDialog
        open={dialogOpen && hasSync}
        sync={sync}
        onClose={closeProgress}
        onStop={previewSyncStore.cancel}
      />
    </section>
  );
}
