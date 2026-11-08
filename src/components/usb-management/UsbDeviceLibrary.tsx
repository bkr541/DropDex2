import { RecordTrackListing } from '../ui/display/RecordTrackListing';
import { useEffect, useState } from 'react';
import { CheckCircle, MusicNote, Playlist, Refresh } from 'iconoir-react/regular';
import { logger } from '../../lib/logger';
import { fetchUsbPlaylists, fetchUsbTracks, type UsbLibrarySummary, type UsbPlaylistRow, type UsbTrackRow } from '../../lib/queries/usbLibraries';
import { StatusBadge } from '../ui/feedback';
import { ToolbarIconButton, ToolbarIconGroup } from '../ui/controls';

type Panel = 'playlists' | 'tracks' | null;

function formatImported(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** The playlists or the first tracks of this USB's library, loaded when opened. */
function LibraryList({ importId, panel }: { importId: string; panel: 'playlists' | 'tracks' }) {
  const [playlists, setPlaylists] = useState<UsbPlaylistRow[] | null>(null);
  const [tracks, setTracks] = useState<UsbTrackRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const load = panel === 'playlists' ? fetchUsbPlaylists(importId).then((rows) => !cancelled && setPlaylists(rows)) : fetchUsbTracks(importId).then((rows) => !cancelled && setTracks(rows));
    load.catch((error: unknown) => {
      logger.error(`usb.library.${panel}_failed`, { importId, message: error instanceof Error ? error.message : String(error) });
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [importId, panel]);

  const rows = panel === 'playlists' ? playlists : tracks;
  if (failed) return <p className="mt-3 text-xs text-red-400" role="alert">Couldn&apos;t load this list. Close it and try again.</p>;
  if (!rows) return <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Refresh className="animate-spin text-control-primary" width={12} height={12} aria-hidden="true" /> Loading…</p>;
  if (rows.length === 0) return <p className="mt-3 text-xs text-muted-foreground">{panel === 'playlists' ? 'No playlists on this USB.' : 'No tracks on this USB.'}</p>;
  if (panel === 'tracks' && tracks) return (
    <RecordTrackListing
      tracks={tracks.map((track) => ({ ...track, musical_key: track.musicalKey }))}
      importId={importId}
      playback={false}
      className="usb-library-tracks mt-3 min-w-0 rounded-xl border border-[var(--color-border-subtle)]"
      scrollStyle={{ maxHeight: '20rem', overflowX: 'hidden' }}
      renderLeading={() => null}
      actions={() => '—'}
      data-testid="usb-library-tracks"
      ariaLabel="Tracks on this USB"
    />
  );
  return (
    <ul className="usb-library-playlists mt-3 max-h-80 min-w-0 divide-y divide-[var(--color-border-faint)] overflow-y-auto overflow-x-hidden rounded-xl border border-[var(--color-border-subtle)] text-xs" data-testid={`usb-library-${panel}`}>
      {playlists?.map((playlist) => (
          <li key={playlist.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-2">
            <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{playlist.name}</span>
            <span className="shrink-0 text-muted-foreground">{playlist.isFolder ? 'Folder' : `${playlist.trackCount.toLocaleString()} ${playlist.trackCount === 1 ? 'track' : 'tracks'}`}</span>
          </li>
        ))}
    </ul>
  );
}

/** What is on a saved USB: its library's track and playlist counts, and a way to look inside or make it the active library. */
export function UsbDeviceLibrary({ summary, onMakeActive }: { summary: UsbLibrarySummary | undefined; onMakeActive: (importId: string) => Promise<boolean> }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [activating, setActivating] = useState(false);

  if (!summary) {
    return <p className="text-[11px] text-muted-foreground" data-testid="usb-library-empty">No library imported from this USB yet.</p>;
  }
  const { library } = summary;
  const toggle = (next: Exclude<Panel, null>) => setPanel((current) => (current === next ? null : next));

  return (
    <div className="usb-device-library min-w-0 border-t border-[var(--color-border-faint)] pt-3" data-testid="usb-library">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium">
              {library.trackCount.toLocaleString()} {library.trackCount === 1 ? 'track' : 'tracks'} · {library.playlistCount.toLocaleString()} {library.playlistCount === 1 ? 'playlist' : 'playlists'}
            </p>
            {summary.isActive && <StatusBadge tone="online">Active library</StatusBadge>}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Imported {formatImported(library.importedAt)}{summary.snapshotCount > 1 ? ` · ${summary.snapshotCount} imports of this USB` : ''}
          </p>
        </div>
        <ToolbarIconGroup aria-label="USB library actions">
          <ToolbarIconButton label="Playlists" aria-expanded={panel === 'playlists'} aria-pressed={panel === 'playlists'} onClick={() => toggle('playlists')}><Playlist width={18} height={18} aria-hidden="true" /></ToolbarIconButton>
          <ToolbarIconButton label="Tracks" aria-expanded={panel === 'tracks'} aria-pressed={panel === 'tracks'} onClick={() => toggle('tracks')}><MusicNote width={18} height={18} aria-hidden="true" /></ToolbarIconButton>
          {!summary.isActive && <ToolbarIconButton label="Use this library" disabled={activating}
            onClick={() => { setActivating(true); void onMakeActive(library.importId).finally(() => setActivating(false)); }}>
            {activating ? <Refresh className="animate-spin" width={18} height={18} aria-hidden="true" /> : <CheckCircle width={18} height={18} aria-hidden="true" />}
          </ToolbarIconButton>}
        </ToolbarIconGroup>
      </div>
      {panel && <LibraryList importId={library.importId} panel={panel} />}
    </div>
  );
}
