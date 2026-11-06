import { isUsableLibrarySnapshot } from '../rekordbox/libraryDeletion';
import type { UsbDeviceRecord } from '../queries/usbDevices';
import type { RekordboxImport } from '../../types';

/** One saved USB with the library snapshots (exportLibrary.db imports) that came from it. */
export interface UsbImportGroup {
  /** The USB's id, or 'unassigned' for imports that are not linked to a USB. */
  key: string;
  device: UsbDeviceRecord | null;
  /** What to show for the USB: its nickname, otherwise its own name. */
  name: string;
  /** Snapshots from this USB, newest first. */
  imports: RekordboxImport[];
  /** The snapshot that stands for this USB: the active library if it is one of these, otherwise the newest usable one. */
  library: RekordboxImport | null;
  hasActive: boolean;
  retired: boolean;
}

export const UNASSIGNED_KEY = 'unassigned';
export const UNASSIGNED_NAME = 'Other imports';

const byNewest = (a: RekordboxImport, b: RekordboxImport) => b.imported_at.localeCompare(a.imported_at);

function newestDate(group: UsbImportGroup): string {
  return group.imports[0]?.imported_at ?? '';
}

/** Order: the USB with the active library, then USBs with libraries (newest first), then USBs with none, then other imports, then retired USBs. */
function rank(group: UsbImportGroup): number {
  if (group.retired) return 4;
  if (group.key === UNASSIGNED_KEY) return 3;
  if (group.hasActive) return 0;
  return group.imports.length > 0 ? 1 : 2;
}

/**
 * Groups snapshots by the USB they came from, using the USB's own id. Every saved USB gets a group, even one with no snapshots.
 * A snapshot whose USB is not in the list (the list did not load) still gets a group of its own, named from the drive name it was saved with.
 */
export function groupImportsByUsb(
  imports: readonly RekordboxImport[],
  devices: readonly UsbDeviceRecord[],
  activeImportId: string | null,
): UsbImportGroup[] {
  const groups = new Map<string, UsbImportGroup>();
  const empty = (key: string, device: UsbDeviceRecord | null, name: string): UsbImportGroup => ({
    key, device, name, imports: [], library: null, hasActive: false, retired: device?.retiredAt != null,
  });

  for (const device of devices) groups.set(device.id, empty(device.id, device, device.nickname || device.label));

  for (const snapshot of [...imports].sort(byNewest)) {
    const key = snapshot.usb_device_id ?? UNASSIGNED_KEY;
    let group = groups.get(key);
    if (!group) {
      group = empty(key, null, key === UNASSIGNED_KEY ? UNASSIGNED_NAME : snapshot.device_name?.trim() || 'USB');
      groups.set(key, group);
    }
    group.imports.push(snapshot);
  }

  for (const group of groups.values()) {
    const active = group.imports.find((snapshot) => snapshot.id === activeImportId) ?? null;
    group.hasActive = active != null;
    group.library = active ?? group.imports.find((snapshot) => isUsableLibrarySnapshot(snapshot)) ?? null;
  }

  return [...groups.values()].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (a.imports.length > 0 || b.imports.length > 0) return newestDate(b).localeCompare(newestDate(a));
    return (b.device?.lastSeenAt ?? '').localeCompare(a.device?.lastSeenAt ?? '');
  });
}
