import { useEffect, useState } from 'react';
import { CircleDash, Music, Playlist } from '@carbon/icons-react';
import { logger } from '../../lib/logger';
import { fetchUsbPlaylists, fetchUsbTracks, type UsbLibrarySummary, type UsbPlaylistRow, type UsbTrackRow } from '../../lib/queries/usbLibraries';
import { StatusBadge } from '../ui/feedback';
import { ControlButton } from '../ui/controls';

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
  if (!rows) return <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><CircleDash className="animate-spin text-primary" size={12} /> Loading…</p>;
  if (rows.length === 0) return <p className="mt-3 text-xs text-muted-foreground">{panel === 'playlists' ? 'No playlists on this USB.' : 'No tracks on this USB.'}</p>;
  return (
    <ul className="mt-3 max-h-56 divide-y divide-[var(--color-border-faint)] overflow-y-auto rounded-xl border border-[var(--color-border-subtle)] text-xs" data-testid={`usb-library-${panel}`}>
      {panel === 'playlists'
        ? playlists?.map((playlist) => (
          <li key={playlist.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span className="truncate font-medium">{playlist.name}</span>
            <span className="shrink-0 text-muted-foreground">{playlist.isFolder ? 'Folder' : `${playlist.trackCount.toLocaleString()} ${playlist.trackCount === 1 ? 'track' : 'tracks'}`}</span>
          </li>
        ))
        : tracks?.map((track) => (
          <li key={track.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span className="min-w-0 truncate"><span className="font-medium">{track.title}</span>{track.artist ? <span className="text-muted-foreground"> · {track.artist}</span> : null}</span>
            <span className="shrink-0 text-muted-foreground">{[track.bpm != null ? Math.round(track.bpm) : null, track.musicalKey].filter(Boolean).join(' · ')}</span>
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
    return <p className="mt-3 text-[11px] text-muted-foreground" data-testid="usb-library-empty">No library imported from this USB yet.</p>;
  }
  const { library } = summary;
  const toggle = (next: Exclude<Panel, null>) => setPanel((current) => (current === next ? null : next));

  return (
    <div className="mt-3 border-t border-[var(--color-border-faint)] pt-3" data-testid="usb-library">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-bold">
          {library.trackCount.toLocaleString()} {library.trackCount === 1 ? 'track' : 'tracks'} · {library.playlistCount.toLocaleString()} {library.playlistCount === 1 ? 'playlist' : 'playlists'}
        </p>
        {summary.isActive && <StatusBadge tone="online">Active library</StatusBadge>}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Imported {formatImported(library.importedAt)}{summary.snapshotCount > 1 ? ` · ${summary.snapshotCount} imports of this USB` : ''}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <ControlButton variant="neutral" onClick={() => toggle('playlists')} aria-expanded={panel === 'playlists'}><Playlist size={14} /> Playlists</ControlButton>
        <ControlButton variant="neutral" onClick={() => toggle('tracks')} aria-expanded={panel === 'tracks'}><Music size={14} /> Tracks</ControlButton>
        {!summary.isActive && (
          <ControlButton
            variant="primary"
            disabled={activating}
            onClick={() => { setActivating(true); void onMakeActive(library.importId).finally(() => setActivating(false)); }}
          >
            {activating ? <CircleDash className="animate-spin" size={14} /> : null} Use this library
          </ControlButton>
        )}
      </div>
      {panel && <LibraryList importId={library.importId} panel={panel} />}
    </div>
  );
}
