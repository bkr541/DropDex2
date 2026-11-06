import { logger } from '../logger';
import { rememberUsbDevice, rememberUsbDeviceByName } from '../queries/usbDevices';
import type { DropDexDesktopBridge } from '../../types/dropdex-desktop';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The id of the USB a library is being imported from, saving the USB to the user's list if it is new. This never stops an
 * import: if the USB cannot be identified the import goes ahead without an id and the reason is logged.
 *
 * The desktop app reads the drive's own volume id, so two USBs with the same name stay separate. The browser build cannot,
 * so it uses the user's USB with that name.
 */
export async function resolveImportUsbDeviceId(
  userId: string,
  folderName: string | null | undefined,
  bridge: Pick<DropDexDesktopBridge, 'getUsbDetails'> | null = typeof window !== 'undefined' ? window.dropdexDesktop ?? null : null,
): Promise<string | null> {
  const name = folderName?.trim();
  if (!name) return null;
  try {
    if (bridge) {
      try {
        const details = await bridge.getUsbDetails();
        // Only trust the connected drive's details when it is the drive being imported.
        if (details && same(details.volumeName, name)) {
          const record = await rememberUsbDevice(userId, details);
          logger.info('usb.import.device_resolved', { usbDeviceId: record.id, volumeName: name, by: details.volumeUuid ? 'volume_uuid' : 'name_and_size' });
          return record.id;
        }
      } catch (error) {
        logger.warn('usb.import.details_unavailable', { volumeName: name, message: error instanceof Error ? error.message : String(error) });
      }
    }
    const record = await rememberUsbDeviceByName(userId, name);
    logger.info('usb.import.device_resolved', { usbDeviceId: record.id, volumeName: name, by: 'name' });
    return record.id;
  } catch (error) {
    logger.error('usb.import.device_failed', { volumeName: name, message: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
