import { useEffect, useState } from 'react';
import { logger } from '../lib/logger';
import { fetchUsbDevices, type UsbDeviceRecord } from '../lib/queries/usbDevices';

/**
 * The user's saved USBs. Reloads when `refreshKey` changes (for example after an import), so a drive saved by a new import shows up.
 * `error` is true when the list could not be read; snapshots then still show, named from the drive name they were saved with.
 */
export function useUsbDevices(userId: string | null, refreshKey: unknown = null) {
  const [devices, setDevices] = useState<UsbDeviceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!userId) {
      setDevices([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchUsbDevices()
      .then((rows) => { if (!cancelled) setDevices(rows); })
      .catch((cause: unknown) => {
        logger.error('usb.devices.load_failed', { message: cause instanceof Error ? cause.message : String(cause) });
        if (!cancelled) setError(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, refreshKey]);

  return { devices, loading, error };
}
