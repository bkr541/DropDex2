import { CheckmarkFilled, CircleDash, Renew, Unplug, Usb, WarningAlt } from '@carbon/icons-react';
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
          {usb.status === 'released' && <ControlButton variant="primary" onClick={() => void usb.reconnect()}><Renew size={14} /> Reconnect</ControlButton>}
          <ControlButton variant={usb.status === 'released' ? 'neutral' : 'primary'} onClick={() => void usb.selectNewUsb()}><Usb size={14} /> Choose your USB</ControlButton>
        </div>
      </div>
    );
  }

  if (loading && !details) {
    return <div className="flex items-center justify-center py-24"><CircleDash className="animate-spin text-primary" size={28} /></div>;
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
        {desktopAvailable && <ControlButton variant="neutral" onClick={refresh}><Renew size={14} /> Try again</ControlButton>}
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
            <StatusBadge tone="online" icon={<CheckmarkFilled size={12} />}>Connected</StatusBadge>
            {usb.structureWarning
              ? <StatusBadge tone="warning" icon={<WarningAlt size={12} />}>{usb.structureWarning}</StatusBadge>
              : <StatusBadge tone="success" icon={<CheckmarkFilled size={12} />}>Rekordbox library found</StatusBadge>}
            <span className="flex-1" />
            <ControlButton variant="neutral" onClick={refresh}><Renew size={14} /> Refresh</ControlButton>
            <ControlButton variant="neutral" onClick={() => void usb.selectNewUsb()}><Usb size={14} /> Use a different USB</ControlButton>
            <ControlButton variant="neutral" onClick={() => void usb.release()}><Unplug size={14} /> Hand back to Rekordbox</ControlButton>
          </>
        )}
      />
    </div>
  );
}
