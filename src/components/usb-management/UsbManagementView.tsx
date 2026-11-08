import { useEffect, useState } from 'react';
import { ArrowSeparate, Clock, Laptop, Usb } from 'iconoir-react/regular';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { getDesktopBridge, usePrimaryUsbDetails } from '../../hooks/useDesktopUsb';
import { useUsbLibrary } from '../../hooks/useUsbLibrary';
import { LibraryTabBar } from '../library/LibraryTabBar';
import { UsbDevicesTab } from './UsbDevicesTab';
import { UsbHistoryTab } from './UsbHistoryTab';
import { UsbOverviewTab } from './UsbOverviewTab';
import { UsbTransferTab } from './UsbTransferTab';
import '../ui/studio-surface.css';
import './usb-management.css';

type UsbTab = 'overview' | 'transfer' | 'history' | 'devices';

const USB_TABS = [
  { id: 'overview', label: 'My USB', icon: Usb },
  { id: 'transfer', label: 'Transfer', icon: ArrowSeparate },
  { id: 'history', label: 'History', icon: Clock },
  { id: 'devices', label: 'My USBs', icon: Laptop },
] as const;

/**
 * USB Management. My USB shows the drive you play from; Transfer copies it onto a second drive; History lists every
 * transfer; My USBs keeps track of all the drives you DJ with.
 */
export function UsbManagementView() {
  const [tab, setTab] = useState<UsbTab>('overview');
  const usb = useUsbConnection();
  const { details } = usePrimaryUsbDetails();
  const library = useUsbLibrary();
  const desktopAvailable = Boolean(getDesktopBridge());
  const { remember } = library;

  // Add the connected USB to the user's list the first time it is seen, and keep its size and last-used date fresh.
  useEffect(() => {
    if (details && usb.status === 'connected') void remember(details);
  }, [details, usb.status, remember]);

  return (
    <div data-testid="usb-management-view" className="usb-management-workspace w-full space-y-5">
      <LibraryTabBar<UsbTab> tabs={USB_TABS} activeTab={tab} onChange={setTab} ariaLabel="USB management sections" />
      <div className="studio-surface usb-management-studio">
        <div className="usb-management-content">
          {tab === 'overview' && <UsbOverviewTab desktopAvailable={desktopAvailable} />}
          {tab === 'transfer' && (
            desktopAvailable
              ? <UsbTransferTab onFinished={library.saveTransfer} onShowHistory={() => setTab('history')} />
              : <p className="usb-empty-state p-8 text-sm text-muted-foreground">Copying between USBs needs the DropDex desktop app, because it has to read and write the drives directly.</p>
          )}
          {tab === 'history' && <UsbHistoryTab transfers={library.transfers} loading={library.loading} error={library.error} onRetry={library.refresh} />}
          {tab === 'devices' && (
            <UsbDevicesTab
              devices={library.devices}
              loading={library.loading}
              error={library.error}
              connectedLabels={details ? [details.volumeName] : usb.volumeName ? [usb.volumeName] : []}
              onRetry={library.refresh}
              onRename={library.rename}
              onSetRetired={library.setRetired}
              libraries={library.libraries}
              onMakeLibraryActive={library.makeLibraryActive}
            />
          )}
        </div>
      </div>
    </div>
  );
}
