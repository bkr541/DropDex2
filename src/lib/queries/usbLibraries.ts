import { supabase } from '../supabase';
import { isUsableLibrarySnapshot } from '../rekordbox/libraryDeletion';
import type { RekordboxImport } from '../../types';

/** One library snapshot, as it belongs to a saved USB. */
export interface UsbSnapshot {
  importId: string;
  usbDeviceId: string;
  sourceFilename: string;
  trackCount: number;
  playlistCount: number;
  importedAt: string;
  isActive: boolean;
}

/** What a saved USB holds: its newest usable snapshot, how many it has, and whether one of them is the active library. */
export interface UsbLibrarySummary {
  usbDeviceId: string;
  /** The library to show for this USB: the active one if it has one, otherwise the newest. */
  library: UsbSnapshot;
  snapshotCount: number;
  isActive: boolean;
}

export interface UsbPlaylistRow {
  id: string;
  name: string;
  isFolder: boolean;
  trackCount: number;
}

export interface UsbTrackRow {
  id: string;
  title: string;
  artist: string | null;
  bpm: number | null;
  musicalKey: string | null;
}

type SnapshotRow = Pick<RekordboxImport, 'id' | 'source_filename' | 'track_count' | 'playlist_count' | 'imported_at' | 'status' | 'library_ready_at'> & { usb_device_id: string };

/** Groups snapshots by USB. Snapshots that are not usable yet (still importing, failed) are left out. Newest first within a USB. */
export function summarizeUsbLibraries(snapshots: readonly UsbSnapshot[]): Map<string, UsbLibrarySummary> {
  const byUsb = new Map<string, UsbSnapshot[]>();
  for (const snapshot of snapshots) {
    byUsb.set(snapshot.usbDeviceId, [...(byUsb.get(snapshot.usbDeviceId) ?? []), snapshot]);
  }
  const summaries = new Map<string, UsbLibrarySummary>();
  for (const [usbDeviceId, list] of byUsb) {
    const newestFirst = [...list].sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    const active = newestFirst.find((snapshot) => snapshot.isActive);
    summaries.set(usbDeviceId, { usbDeviceId, library: active ?? newestFirst[0], snapshotCount: newestFirst.length, isActive: Boolean(active) });
  }
  return summaries;
}

/** Every usable snapshot that is linked to a saved USB, and which one is the active library. */
export async function fetchUsbSnapshots(userId: string): Promise<UsbSnapshot[]> {
  const [imports, settings] = await Promise.all([
    supabase
      .from('rekordbox_imports')
      .select('id, usb_device_id, source_filename, track_count, playlist_count, imported_at, status, library_ready_at')
      .eq('user_id', userId)
      .not('usb_device_id', 'is', null)
      .order('imported_at', { ascending: false }),
    supabase.from('rekordbox_user_settings').select('active_import_id').eq('user_id', userId).maybeSingle(),
  ]);
  if (imports.error) throw new Error(imports.error.message);
  if (settings.error) throw new Error(settings.error.message);
  const activeId = (settings.data as { active_import_id: string | null } | null)?.active_import_id ?? null;
  return ((imports.data ?? []) as SnapshotRow[])
    .filter((row) => isUsableLibrarySnapshot(row))
    .map((row) => ({
      importId: row.id,
      usbDeviceId: row.usb_device_id,
      sourceFilename: row.source_filename,
      trackCount: row.track_count,
      playlistCount: row.playlist_count,
      importedAt: row.imported_at,
      isActive: row.id === activeId,
    }));
}

/** The playlists on a USB's library, with how many tracks each holds. */
export async function fetchUsbPlaylists(importId: string): Promise<UsbPlaylistRow[]> {
  const { data, error } = await supabase
    .from('rekordbox_playlists')
    .select('id, name, is_folder, sort_order, rekordbox_playlist_tracks(count)')
    .eq('import_id', importId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; name: string; is_folder: boolean; rekordbox_playlist_tracks: Array<{ count: number }> | null }>).map((row) => ({
    id: row.id,
    name: row.name,
    isFolder: row.is_folder,
    trackCount: row.rekordbox_playlist_tracks?.[0]?.count ?? 0,
  }));
}

/** The first tracks on a USB's library, by title. */
export async function fetchUsbTracks(importId: string, limit = 100): Promise<UsbTrackRow[]> {
  const { data, error } = await supabase
    .from('rekordbox_tracks')
    .select('id, title, artist, bpm, musical_key')
    .eq('import_id', importId)
    .order('title', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; title: string; artist: string | null; bpm: number | string | null; musical_key: string | null }>).map((row) => ({
    id: row.id,
    title: row.title,
    artist: row.artist,
    bpm: row.bpm == null ? null : Number(row.bpm),
    musicalKey: row.musical_key,
  }));
}
