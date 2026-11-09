import { useEffect, useRef, useState } from 'react';
import { Database, Folder, Refresh, Usb } from 'iconoir-react/regular';
import type { UsbDeviceRecord, UsbTransferRecord } from '../../lib/queries/usbDevices';
import type { UsbSnapshot } from '../../lib/queries/usbLibraries';
import { ImportTrackBrowser } from '../library/ImportTrackBrowser';
import { ControlButton, FormField, SelectControl, ToolbarIconButton, ToolbarIconGroup } from '../ui/controls';
import { NoticeCard, StatusBadge, StatusLoader } from '../ui/feedback';
import { useAudioTrackCopy, type AudioCopyFinished } from '../../hooks/useAudioTrackCopy';
import { copiedAudioForDevice } from '../../lib/usb/audioTrackCopy';
import { formatBytes } from '../../lib/usb/usbFormat';
import { UsbAudioCopyStatus } from './UsbAudioCopyStatus';
import { resolveUsbBrowseSelection, usbBrowseSnapshots, type UsbBrowseSelection } from './usbBrowseSelection';
import '../library/import-library.css';

interface UsbBrowseProps {
  devices: readonly UsbDeviceRecord[];
  snapshots: readonly UsbSnapshot[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  transfers?: readonly UsbTransferRecord[];
  onCopyFinished?: AudioCopyFinished;
}

const deviceName = (device: UsbDeviceRecord) => device.nickname ? `${device.nickname} · ${device.label}` : device.label;
const importedDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function UsbBrowsePanel({ side, deviceId, peerId, devices, snapshots, onChange, copy, transfers }: {
  side: 'A' | 'B'; deviceId: string; peerId: string;
  devices: readonly UsbDeviceRecord[]; snapshots: readonly UsbSnapshot[]; onChange: (deviceId: string) => void;
  copy: ReturnType<typeof useAudioTrackCopy>; transfers: readonly UsbTransferRecord[];
}) {
  const device = devices.find((item) => item.id === deviceId);
  const available = usbBrowseSnapshots(snapshots, deviceId);
  const [requestedSnapshot, setRequestedSnapshot] = useState('');
  const snapshot = available.find((item) => item.importId === requestedSnapshot) ?? available[0];
  const peer = devices.find((item) => item.id === peerId);
  const binding = copy.bindings[deviceId];
  const copied = copiedAudioForDevice(deviceId, transfers, copy.session);
  const ready = copy.available && Boolean(binding && copy.bindings[peerId]) && !copy.locked;


  return <section className="usb-browse-panel cue-studio" aria-label={`USB ${side} library`}>
    <div className="usb-browse-panel__header">
      <h3 className="flex items-center gap-2 text-sm"><Usb width={18} height={18} aria-hidden="true" /> USB {side}</h3>
      <FormField label={`USB ${side}`}>
        {({ id }) => <SelectControl id={id} value={deviceId} disabled={copy.locked} onChange={(event) => onChange(event.target.value)}>
          {!deviceId && <option value="">{devices.length ? 'Choose another USB' : 'No saved USBs'}</option>}
          {devices.map((item) => <option key={item.id} value={item.id} disabled={item.id === peerId}>{deviceName(item)}{item.id === peerId ? ' · selected in other panel' : ''}</option>)}
        </SelectControl>}
      </FormField>
      {device && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{binding ? `Located: ${binding.details.volumeName}` : 'Locate this mounted USB to enable audio copying.'}</span>
        <ToolbarIconGroup><ToolbarIconButton label={`Locate mounted USB ${device.nickname || device.label}`} onClick={() => void copy.locate(device)} disabled={!copy.available || copy.locked}>
          <Folder width={16} height={16} aria-hidden="true" />
        </ToolbarIconButton></ToolbarIconGroup>
      </div>}
      {snapshot && <>
        <FormField label={`USB ${side} database snapshot`}>
          {({ id }) => <SelectControl id={id} value={snapshot.importId} disabled={copy.locked} onChange={(event) => setRequestedSnapshot(event.target.value)}>
            {available.map((item) => <option key={item.importId} value={item.importId}>{item.sourceFilename} · {importedDate(item.importedAt)} · {item.trackCount.toLocaleString()} tracks</option>)}
          </SelectControl>}
        </FormField>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Database width={14} height={14} aria-hidden="true" />
          <span className="break-words">Saved snapshot · {snapshot.trackCount.toLocaleString()} tracks · Imported {importedDate(snapshot.importedAt)}</span>
          {snapshot.isActive && <StatusBadge tone="active">Active library</StatusBadge>}
        </div>
      </>}
    </div>
    {device ? snapshot
      ? <ImportTrackBrowser key={snapshot.importId} importId={snapshot.importId} compact label={`USB ${side} tracks`}
          onCopyTrack={peer ? (track) => { void copy.prepare(track, device.id, peer.id); } : undefined}
          copyTrackLabel={peer ? `Copy audio to ${peer.nickname || peer.label}` : undefined} copyTrackDisabled={!ready} />
      : <p className="usb-browse-panel__empty">{deviceName(device)} has no saved database snapshot. Import its exportLibrary.db to browse its tracks.</p>
      : <p className="usb-browse-panel__empty">{devices.length < 2 ? 'A second saved USB is needed to browse two libraries.' : 'Choose a USB to browse its saved library.'}</p>}
    {device && copied.length > 0 && <section className="usb-copied-audio" aria-label={`Copied audio history for ${device.nickname || device.label}`}>
      <h4 className="text-xs font-medium">Copied audio</h4>
      <p className="mt-1 text-xs text-muted-foreground">Files copied by DropDex. These copies do not add tracks to the Rekordbox database.</p>
      <ul className="mt-2 divide-y divide-[var(--color-border-faint)]">{copied.map((file) => <li key={file.path} className="py-2">
        <p className="break-words text-xs [overflow-wrap:anywhere]">{file.path}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">{formatBytes(file.size)} · {importedDate(file.finishedAt)}{file.sha256 ? ' · Verified' : ''}</p>
      </li>)}</ul>
    </section>}
  </section>;
}

/** Snapshot browsing remains read-only; explicit, reviewed native commands copy individual audio files. */
export function UsbBrowseTab({ devices, snapshots, loading, error, onRetry, transfers = [], onCopyFinished }: UsbBrowseProps) {
  const copy = useAudioTrackCopy(onCopyFinished);
  const copyStatus = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (copy.phase === 'review' || copy.phase === 'error') copyStatus.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [copy.phase]);
  const [requested, setRequested] = useState<UsbBrowseSelection>(() => resolveUsbBrowseSelection(devices));
  const selected = resolveUsbBrowseSelection(devices, requested);
  useEffect(() => {
    setRequested((current) => {
      const next = resolveUsbBrowseSelection(devices, current);
      return next.left === current.left && next.right === current.right ? current : next;
    });
  }, [devices]);

  if (loading && devices.length === 0) return <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><StatusLoader label="Loading USB libraries" /> Loading USB libraries…</div>;
  return <div className="usb-browse-tab import-library-studio cue-studio space-y-4" data-testid="usb-browse-tab">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-lg">Browse USB libraries</h2>
        <p className="mt-1 text-xs text-muted-foreground">Browse saved database snapshots side by side. Viewing a USB or snapshot does not change your active library.</p>
      </div>
      <ToolbarIconGroup><ToolbarIconButton label="Refresh USB libraries" onClick={onRetry} disabled={loading || copy.locked}>
        <Refresh width={16} height={16} aria-hidden="true" />
      </ToolbarIconButton></ToolbarIconGroup>
    </div>
    {!copy.available && <p className="text-xs text-muted-foreground">{copy.desktop ? 'Restart the DropDex desktop app to enable individual audio copying.' : 'Individual audio copying is available in the DropDex desktop app.'}</p>}
    {copy.phase !== 'idle' && <div ref={copyStatus}><UsbAudioCopyStatus copy={copy} /></div>}
    {error && <NoticeCard tone="error" action={<ControlButton variant="secondary" onClick={onRetry}>Retry USB libraries</ControlButton>}>{error}</NoticeCard>}
    {!error && devices.length === 0 && <p className="py-6 text-sm text-muted-foreground">No saved USBs yet. Import a USB library to make its database snapshot available here.</p>}
    {devices.length > 0 && <div className="usb-browse-grid">
      <UsbBrowsePanel key={`A:${selected.left}`} side="A" deviceId={selected.left} peerId={selected.right} devices={devices} snapshots={snapshots} copy={copy} transfers={transfers}
        onChange={(left) => setRequested({ left, right: selected.right })} />
      <UsbBrowsePanel key={`B:${selected.right}`} side="B" deviceId={selected.right} peerId={selected.left} devices={devices} snapshots={snapshots} copy={copy} transfers={transfers}
        onChange={(right) => setRequested({ left: selected.left, right })} />
    </div>}
  </div>;
}
