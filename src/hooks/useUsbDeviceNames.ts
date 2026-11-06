import { useEffect, useState } from 'react';
import { logger } from '../lib/logger';
import { fetchUsbDevices } from '../lib/queries/usbDevices';

/** The name to show for each of the user's USBs, by USB id: the nickname if there is one, otherwise the drive's own name. Reloads when `refreshKey` changes. */
export function useUsbDeviceNames(userId: string | null, refreshKey: unknown = null): ReadonlyMap<string, string> {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    if (!userId) {
      setNames(new Map());
      return;
    }
    let cancelled = false;
    fetchUsbDevices()
      .then((devices) => { if (!cancelled) setNames(new Map(devices.map((device) => [device.id, device.nickname || device.label]))); })
      .catch((error: unknown) => logger.error('usb.names.load_failed', { message: error instanceof Error ? error.message : String(error) }));
    return () => { cancelled = true; };
  }, [userId, refreshKey]);

  return names;
}
