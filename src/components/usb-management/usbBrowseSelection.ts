import type { UsbDeviceRecord } from '../../lib/queries/usbDevices';
import type { UsbSnapshot } from '../../lib/queries/usbLibraries';

export interface UsbBrowseSelection { left: string; right: string }

/** Preserve valid choices across refreshes; never put the same USB in both panels. */
export function resolveUsbBrowseSelection(devices: readonly UsbDeviceRecord[], requested: UsbBrowseSelection = { left: '', right: '' }): UsbBrowseSelection {
  const has = (id: string) => devices.some((device) => device.id === id);
  const left = has(requested.left) ? requested.left
    : devices.find((device) => device.id !== requested.right)?.id ?? devices[0]?.id ?? '';
  const right = has(requested.right) && requested.right !== left ? requested.right
    : devices.find((device) => device.id !== left)?.id ?? '';
  return { left, right };
}

export function usbBrowseSnapshots(snapshots: readonly UsbSnapshot[], deviceId: string): UsbSnapshot[] {
  return snapshots.filter((snapshot) => snapshot.usbDeviceId === deviceId)
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt) || a.importId.localeCompare(b.importId));
}
