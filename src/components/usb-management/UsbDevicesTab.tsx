import { useState } from 'react';
import { Check, EditPencil, Refresh, Trash, Usb, Xmark } from 'iconoir-react/regular';
import { formatBytes } from '../../lib/usb/usbFormat';
import type { UsbDeviceRecord } from '../../lib/queries/usbDevices';
import { NoticeCard, StatusBadge } from '../ui/feedback';
import { ControlButton, TextControl, ToolbarIconButton, ToolbarIconGroup } from '../ui/controls';
import { UsbStickArt } from './UsbDriveCard';
import { UsbDeviceLibrary } from './UsbDeviceLibrary';
import type { UsbLibrarySummary } from '../../lib/queries/usbLibraries';

function formatSeen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

interface DevicesTabProps {
  devices: UsbDeviceRecord[];
  loading: boolean;
  error: string | null;
  /** Names of the drives plugged in right now, so they can be marked. */
  connectedLabels: string[];
  onRetry: () => void;
  onRename: (deviceId: string, nickname: string | null) => Promise<boolean>;
  onSetRetired: (deviceId: string, retired: boolean) => Promise<boolean>;
  /** What each USB holds, by USB id. */
  libraries: ReadonlyMap<string, UsbLibrarySummary>;
  onMakeLibraryActive: (importId: string) => Promise<boolean>;
}

function DeviceCard({ device, connected, onRename, onSetRetired, library, onMakeLibraryActive }: { device: UsbDeviceRecord; connected: boolean; onRename: DevicesTabProps['onRename']; onSetRetired: DevicesTabProps['onSetRetired']; library: UsbLibrarySummary | undefined; onMakeLibraryActive: DevicesTabProps['onMakeLibraryActive'] }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.nickname ?? '');
  const [saving, setSaving] = useState(false);
  const retired = device.retiredAt != null;
  const model = [device.brand, device.model].filter(Boolean).join(' ');

  const save = async () => {
    setSaving(true);
    const ok = await onRename(device.id, name);
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <li className={`usb-panel usb-device-record flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--color-border-subtle)] p-4 ${retired ? 'opacity-60' : ''}`} data-testid="usb-device-card">
      <div className="usb-device-header">
        <div className="usb-device-art"><UsbStickArt lit={connected} size={40} /></div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form className="flex min-w-0 items-center gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <TextControl icon={<Usb width={14} height={14} />} containerClassName="min-w-0 flex-1" autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder={device.label} aria-label="USB nickname" />
              <ToolbarIconGroup aria-label="Save USB name">
                <ToolbarIconButton label="Save USB name" type="submit" disabled={saving}>
                  {saving ? <Refresh className="animate-spin" width={18} height={18} aria-hidden="true" /> : <Check width={18} height={18} aria-hidden="true" />}
                </ToolbarIconButton>
                <ToolbarIconButton label="Cancel rename" disabled={saving} onClick={() => { setEditing(false); setName(device.nickname ?? ''); }}><Xmark width={18} height={18} aria-hidden="true" /></ToolbarIconButton>
              </ToolbarIconGroup>
            </form>
          ) : (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="break-words text-sm font-medium">{device.nickname || device.label}</h3>
              {device.nickname && <span className="break-words text-xs text-muted-foreground">({device.label})</span>}
              {connected && <StatusBadge tone="online">Connected now</StatusBadge>}
              {retired && <StatusBadge tone="disabled">Retired</StatusBadge>}
            </div>
          )}
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {[model || null, formatBytes(device.totalBytes) !== '—' ? formatBytes(device.totalBytes) : null, device.filesystem].filter(Boolean).join(' · ') || 'No details recorded'}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Last used {formatSeen(device.lastSeenAt)} · first seen {formatSeen(device.firstSeenAt)}</p>
        </div>
        {!editing && <ToolbarIconGroup aria-label={`Actions for ${device.nickname || device.label}`}>
          <ToolbarIconButton label="Rename USB" onClick={() => setEditing(true)}><EditPencil width={18} height={18} aria-hidden="true" /></ToolbarIconButton>
          {retired
            ? <ToolbarIconButton label="Use again" onClick={() => void onSetRetired(device.id, false)}><Refresh width={18} height={18} aria-hidden="true" /></ToolbarIconButton>
            : <ToolbarIconButton label="Retire USB" onClick={() => void onSetRetired(device.id, true)}><Trash width={18} height={18} aria-hidden="true" /></ToolbarIconButton>}
        </ToolbarIconGroup>}
      </div>
      {!editing && <UsbDeviceLibrary summary={library} onMakeActive={onMakeLibraryActive} />}
    </li>
  );
}

/** Every USB the user plays from. A drive is added here automatically the first time it is connected or transferred to. */
export function UsbDevicesTab({ devices, loading, error, connectedLabels, onRetry, onRename, onSetRetired, libraries, onMakeLibraryActive }: DevicesTabProps) {
  if (loading) return <div className="flex items-center justify-center py-24"><Refresh className="animate-spin text-control-primary" width={28} height={28} aria-hidden="true" /></div>;
  if (error) {
    return (
      <NoticeCard tone="error" title="Could not load USBs"
        action={<ControlButton variant="secondary" onClick={onRetry}><Refresh width={14} height={14} aria-hidden="true" /> Try again</ControlButton>}>
        {error}
      </NoticeCard>
    );
  }
  if (devices.length === 0) {
    return (
      <div className="usb-panel flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--color-border-subtle)] px-8 py-16 text-center" data-testid="usb-devices-empty">
        <Usb width={32} height={32} aria-hidden="true" className="text-muted-foreground" />
        <h2 className="text-lg font-medium">No USBs yet</h2>
        <p className="max-w-sm text-sm text-muted-foreground">Connect a USB on the My USB tab, or choose one to copy to, and it is added here so you can keep track of every drive you DJ with.</p>
      </div>
    );
  }
  const current = devices.filter((device) => !device.retiredAt);
  const retired = devices.filter((device) => device.retiredAt);
  const isConnected = (device: UsbDeviceRecord) => connectedLabels.some((label) => label.toLowerCase() === device.label.toLowerCase());
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Your USBs · {current.length}</h2>
        <ul className="usb-device-list grid min-w-0 grid-cols-1 gap-3">{current.map((device) => <DeviceCard key={device.id} device={device} connected={isConnected(device)} onRename={onRename} onSetRetired={onSetRetired} library={libraries.get(device.id)} onMakeLibraryActive={onMakeLibraryActive} />)}</ul>
      </section>
      {retired.length > 0 && (
        <section>
          <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">No longer used · {retired.length}</h2>
          <ul className="usb-device-list grid min-w-0 grid-cols-1 gap-3">{retired.map((device) => <DeviceCard key={device.id} device={device} connected={false} onRename={onRename} onSetRetired={onSetRetired} library={libraries.get(device.id)} onMakeLibraryActive={onMakeLibraryActive} />)}</ul>
        </section>
      )}
    </div>
  );
}
