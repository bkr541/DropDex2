import { useCallback, useEffect, useState } from 'react';
import { useAuthSession } from './useAuthSession';
import { logger } from '../lib/logger';
import {
  fetchUsbDevices, fetchUsbTransfers, recordUsbTransfer, rememberUsbDevice, renameUsbDevice, setUsbDeviceRetired,
  type UsbDeviceRecord, type UsbTransferRecord,
} from '../lib/queries/usbDevices';
import { fetchUsbSnapshots, summarizeUsbLibraries, type UsbLibrarySummary } from '../lib/queries/usbLibraries';
import { setActiveImport } from '../lib/queries/rekordbox';
import type { DesktopTransferResult, DesktopUsbDetails } from '../types/dropdex-desktop';

/** The signed-in user's USBs and their transfer history. */
export function useUsbLibrary() {
  const { session } = useAuthSession();
  const userId = session?.user.id ?? null;
  const [devices, setDevices] = useState<UsbDeviceRecord[]>([]);
  const [transfers, setTransfers] = useState<UsbTransferRecord[]>([]);
  const [libraries, setLibraries] = useState<ReadonlyMap<string, UsbLibrarySummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchUsbDevices(), fetchUsbTransfers(), fetchUsbSnapshots(userId)])
      .then(([deviceRows, transferRows, snapshots]) => {
        if (cancelled) return;
        setDevices(deviceRows);
        setTransfers(transferRows);
        setLibraries(summarizeUsbLibraries(snapshots));
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('usb.library.load_failed', { message });
        if (!cancelled) setError('Could not load your USBs and transfer history.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, attempt]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  /** Makes this USB's library the one the rest of the app shows. */
  const makeLibraryActive = useCallback(async (importId: string): Promise<boolean> => {
    try {
      await setActiveImport(importId);
      setAttempt((n) => n + 1);
      return true;
    } catch (err: unknown) {
      logger.error('usb.library.make_active_failed', { importId, message: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }, []);

  /** Saves a drive to the user's list (or refreshes it), and returns its record. */
  const remember = useCallback(async (details: DesktopUsbDetails): Promise<UsbDeviceRecord | null> => {
    if (!userId) return null;
    try {
      const record = await rememberUsbDevice(userId, details);
      setDevices((current) => [record, ...current.filter((device) => device.id !== record.id)]);
      return record;
    } catch (err: unknown) {
      logger.error('usb.library.remember_failed', { volumeName: details.volumeName, message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }, [userId]);

  /** Saves a finished transfer to the history. Resolves false if it could not be saved. */
  const saveTransfer = useCallback(async (result: DesktopTransferResult, source: DesktopUsbDetails | null, destination: DesktopUsbDetails | null): Promise<boolean> => {
    if (!userId) return false;
    try {
      const [sourceRecord, destinationRecord] = await Promise.all([source ? remember(source) : null, destination ? remember(destination) : null]);
      await recordUsbTransfer(userId, result, sourceRecord?.id ?? null, destinationRecord?.id ?? null);
      setTransfers(await fetchUsbTransfers());
      return true;
    } catch (err: unknown) {
      logger.error('usb.library.save_transfer_failed', { message: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }, [userId, remember]);

  const rename = useCallback(async (deviceId: string, nickname: string | null) => {
    try {
      await renameUsbDevice(deviceId, nickname);
      setDevices((current) => current.map((device) => (device.id === deviceId ? { ...device, nickname: nickname?.trim() || null } : device)));
      return true;
    } catch (err: unknown) {
      logger.error('usb.library.rename_failed', { deviceId, message: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }, []);

  const setRetired = useCallback(async (deviceId: string, retired: boolean) => {
    try {
      await setUsbDeviceRetired(deviceId, retired);
      setDevices((current) => current.map((device) => (device.id === deviceId ? { ...device, retiredAt: retired ? new Date().toISOString() : null } : device)));
      return true;
    } catch (err: unknown) {
      logger.error('usb.library.retire_failed', { deviceId, message: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }, []);

  return { devices, transfers, libraries, loading, error, refresh, remember, saveTransfer, rename, setRetired, makeLibraryActive };
}
