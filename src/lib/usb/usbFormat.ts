import type { DesktopTransferCategory, DesktopUsbDetails } from '../../types/dropdex-desktop';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1536 → "1.5 KB". Drives are sold in powers of 1000, so this uses 1000, not 1024. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const text = digits > 0 ? value.toFixed(digits).replace(/\.?0+$/, '') : value.toFixed(0);
  return `${text} ${UNITS[unit]}`;
}

/** How full the drive is, 0 to 100, or null when its size is unknown. */
export function percentUsed(details: Pick<DesktopUsbDetails, 'totalBytes' | 'usedBytes'> | null | undefined): number | null {
  if (!details || details.totalBytes == null || details.usedBytes == null || details.totalBytes <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((details.usedBytes / details.totalBytes) * 100)));
}

/** A stable identity for a drive, so the same USB is recognised each time it is plugged in. */
export function deviceKeyFor(details: Pick<DesktopUsbDetails, 'volumeUuid' | 'volumeName' | 'totalBytes'>): string {
  if (details.volumeUuid) return `uuid:${details.volumeUuid.toLowerCase()}`;
  return details.totalBytes == null ? nameOnlyDeviceKey(details.volumeName) : `name:${details.volumeName.trim().toLowerCase()}|${details.totalBytes}`;
}

/** The key for a drive that is only known by its name, which is how libraries imported before drives had ids are recorded. */
export function nameOnlyDeviceKey(volumeName: string): string {
  return `name:${volumeName.trim().toLowerCase()}|unknown`;
}

/** "SanDisk Cruzer Blade", or whichever parts are known. */
export function makeAndModel(details: Pick<DesktopUsbDetails, 'brand' | 'model'>): string | null {
  const text = [details.brand, details.model].filter(Boolean).join(' ').trim();
  return text || null;
}

export const TRANSFER_CATEGORY_LABELS: Record<DesktopTransferCategory, { title: string; description: string }> = {
  tracks: { title: 'Tracks', description: 'The music files in the Contents and Music folders.' },
  rekordbox: { title: 'Rekordbox library', description: 'Playlists, cue points, waveforms and artwork (the PIONEER folder).' },
  other: { title: 'Other files', description: 'Anything else on the drive, like notes or backups.' },
};

export function describeCategories(categories: readonly string[]): string {
  const labels = categories.map((id) => TRANSFER_CATEGORY_LABELS[id as DesktopTransferCategory]?.title ?? id);
  if (labels.length === 0) return 'Nothing';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
