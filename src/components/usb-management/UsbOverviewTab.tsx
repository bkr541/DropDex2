import { CheckCircle, Eject, Refresh, Usb, WarningTriangle } from 'iconoir-react/regular';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { usePrimaryUsbDetails, useTransferScan } from '../../hooks/useDesktopUsb';
import { StatusBadge } from '../ui/feedback';
import { ControlButton } from '../ui/controls';
import { UsbDriveCard, UsbStickArt } from './UsbDriveCard';

/** The primary USB: what it is, how much room is left, and whether it looks like a Rekordbox drive. */
export function UsbOverviewTab({ desktopAvailable }: { desktopAvailable: boolean }) {
  const usb = useUsbConnection();
  const { details, loading, error, refresh } = usePrimaryUsbDetails();
  const { scan } = useTransferScan();

  if (usb.status !== 'connected') {
    return (
      <div className="glass flex flex-col items-center gap-4 rounded-3xl border border-dashed border-[var(--color-border-subtle)] px-8 py-16 text-center" data-testid="usb-not-connected">
        <UsbStickArt lit={false} size={120} />
        <div>
          <h2 className="text-xl font-black">{usb.status === 'released' ? 'Your USB is handed back to Rekordbox' : 'No USB connected'}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {usb.status === 'released'
              ? 'DropDex stopped using the drive so Rekordbox can have it. Reconnect it to see its details.'
              : 'Connect the USB you play from to see how much room it has, what format it is in, and what is on it.'}
          </p>
          {usb.error && <p className="mx-auto mt-2 max-w-md text-xs text-red-400">{usb.error}</p>}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {usb.status === 'released' && <ControlButton variant="primary" onClick={() => void usb.reconnect()}><Refresh width={14} height={14} aria-hidden="true" /> Reconnect</ControlButton>}
          <ControlButton variant={usb.status === 'released' ? 'secondary' : 'primary'} onClick={() => void usb.selectNewUsb()}><Usb width={14} height={14} aria-hidden="true" /> Choose your USB</ControlButton>
        </div>
      </div>
    );
  }

  if (loading && !details) {
    return <div className="flex items-center justify-center py-24"><Refresh className="animate-spin text-primary" width={28} height={28} aria-hidden="true" /></div>;
  }

  if (!details) {
    return (
      <div className="glass space-y-3 rounded-3xl border border-[var(--color-border-subtle)] p-8">
        <h2 className="text-xl font-black">{usb.volumeName ?? 'USB connected'}</h2>
        <p className="text-sm text-muted-foreground">
          {desktopAvailable
            ? (error ?? 'DropDex could not read this drive\'s details.')
            : 'Size, free space and format are only available in the DropDex desktop app. This drive is connected and ready to use.'}
        </p>
        {desktopAvailable && <ControlButton variant="neutral" onClick={refresh}><Refresh width={14} height={14} aria-hidden="true" /> Try again</ControlButton>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <UsbDriveCard
        details={details}
        eyebrow="Primary USB"
        scan={scan}
        actions={(
          <>
            <StatusBadge tone="online" icon={<CheckCircle width={12} height={12} aria-hidden="true" />}>Connected</StatusBadge>
            {usb.structureWarning
              ? <StatusBadge tone="warning" icon={<WarningTriangle width={12} height={12} aria-hidden="true" />}>{usb.structureWarning}</StatusBadge>
              : <StatusBadge tone="success" icon={<CheckCircle width={12} height={12} aria-hidden="true" />}>Rekordbox library found</StatusBadge>}
            <span className="flex-1" />
            <ControlButton variant="neutral" onClick={refresh}><Refresh width={14} height={14} aria-hidden="true" /> Refresh</ControlButton>
            <ControlButton variant="neutral" onClick={() => void usb.selectNewUsb()}><Usb width={14} height={14} aria-hidden="true" /> Use a different USB</ControlButton>
            <ControlButton variant="neutral" onClick={() => void usb.release()}><Eject width={14} height={14} aria-hidden="true" /> Hand back to Rekordbox</ControlButton>
          </>
        )}
      />
    </div>
  );
}
