import { useState } from 'react';
import { Checkmark, CircleDash, Edit, Renew, TrashCan, Usb } from '@carbon/icons-react';
import { formatBytes } from '../../lib/usb/usbFormat';
import type { UsbDeviceRecord } from '../../lib/queries/usbDevices';
import { StatusBadge } from '../ui/feedback';
import { ControlButton } from '../ui/controls';
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
    <li className={`glass flex gap-4 rounded-2xl border border-[var(--color-border-subtle)] p-4 ${retired ? 'opacity-60' : ''}`} data-testid="usb-device-card">
      <div className="flex w-16 shrink-0 items-center justify-center rounded-xl bg-black/25"><UsbStickArt lit={connected} size={64} /></div>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder={device.label} aria-label="USB nickname" className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-bold focus:border-primary focus:outline-none" />
            <ControlButton variant="primary" type="submit" disabled={saving}>{saving ? <CircleDash className="animate-spin" size={14} /> : <Checkmark size={14} />} Save</ControlButton>
            <ControlButton variant="ghost" type="button" onClick={() => { setEditing(false); setName(device.nickname ?? ''); }}>Cancel</ControlButton>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-black">{device.nickname || device.label}</h3>
            {device.nickname && <span className="truncate text-xs text-muted-foreground">({device.label})</span>}
            {connected && <StatusBadge tone="online">Connected now</StatusBadge>}
            {retired && <StatusBadge tone="disabled">Retired</StatusBadge>}
          </div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {[model || null, formatBytes(device.totalBytes) !== '—' ? formatBytes(device.totalBytes) : null, device.filesystem].filter(Boolean).join(' · ') || 'No details recorded'}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Last used {formatSeen(device.lastSeenAt)} · first seen {formatSeen(device.firstSeenAt)}</p>
        {!editing && <UsbDeviceLibrary summary={library} onMakeActive={onMakeLibraryActive} />}
        {!editing && (
          <div className="mt-3 flex flex-wrap gap-2">
            <ControlButton variant="neutral" onClick={() => setEditing(true)}><Edit size={14} /> Rename</ControlButton>
            {retired
              ? <ControlButton variant="neutral" onClick={() => void onSetRetired(device.id, false)}><Renew size={14} /> Use again</ControlButton>
              : <ControlButton variant="ghost" onClick={() => void onSetRetired(device.id, true)}><TrashCan size={14} /> I don&apos;t use this one anymore</ControlButton>}
          </div>
        )}
      </div>
    </li>
  );
}

/** Every USB the user plays from. A drive is added here automatically the first time it is connected or transferred to. */
export function UsbDevicesTab({ devices, loading, error, connectedLabels, onRetry, onRename, onSetRetired, libraries, onMakeLibraryActive }: DevicesTabProps) {
  if (loading) return <div className="flex items-center justify-center py-24"><CircleDash className="animate-spin text-primary" size={28} /></div>;
  if (error) {
    return (
      <div className="space-y-3 py-16 text-center">
        <p className="text-sm font-bold text-red-400">{error}</p>
        <ControlButton variant="neutral" onClick={onRetry}><Renew size={14} /> Try again</ControlButton>
      </div>
    );
  }
  if (devices.length === 0) {
    return (
      <div className="glass flex flex-col items-center gap-3 rounded-3xl border border-dashed border-[var(--color-border-subtle)] px-8 py-16 text-center" data-testid="usb-devices-empty">
        <Usb size={32} className="text-muted-foreground" />
        <h2 className="text-lg font-black">No USBs yet</h2>
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
        <ul className="grid gap-3 xl:grid-cols-2">{current.map((device) => <DeviceCard key={device.id} device={device} connected={isConnected(device)} onRename={onRename} onSetRetired={onSetRetired} library={libraries.get(device.id)} onMakeLibraryActive={onMakeLibraryActive} />)}</ul>
      </section>
      {retired.length > 0 && (
        <section>
          <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">No longer used · {retired.length}</h2>
          <ul className="grid gap-3 xl:grid-cols-2">{retired.map((device) => <DeviceCard key={device.id} device={device} connected={false} onRename={onRename} onSetRetired={onSetRetired} library={libraries.get(device.id)} onMakeLibraryActive={onMakeLibraryActive} />)}</ul>
        </section>
      )}
    </div>
  );
}
