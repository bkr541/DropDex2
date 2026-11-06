import { Usb } from '@carbon/icons-react';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import type { UsbImportGroup } from '../../lib/usb/groupImportsByUsb';
import type { RekordboxImport } from '../../types';
import { StatusBadge } from '../ui/feedback';
import { ImportSnapshotRow } from './ImportSnapshotRow';

const formatDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

interface UsbCardsProps {
  groups: UsbImportGroup[];
  activeImportId: string | null;
  onOpen: (snapshot: RekordboxImport) => void;
  onMakeActive: (snapshot: RekordboxImport) => void;
  onResumeOrRetry: (snapshot: RekordboxImport) => void;
  onDelete: (snapshot: RekordboxImport) => void;
}

/**
 * One card per USB. The top of the card is the USB itself: its name, badges, and the size of the library that stands for it.
 * Under that are the library snapshots (exportLibrary.db imports) that came from this USB.
 */
export function UsbCardsSection({ groups, activeImportId, onOpen, onMakeActive, onResumeOrRetry, onDelete }: UsbCardsProps) {
  const { volumeName } = useUsbConnection();
  if (groups.length === 0) {
    return (
      <div className="glass rounded-2xl p-4 text-center" data-testid="usb-cards-empty">
        <p className="text-sm text-muted-foreground italic">No USBs yet. Import a library from a USB and it appears here.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2" data-testid="usb-cards">
      {groups.map((group) => {
        const connected = Boolean(volumeName && group.device && group.device.label.trim().toLowerCase() === volumeName.trim().toLowerCase());
        return (
          <li key={group.key} className="glass overflow-hidden rounded-2xl" data-testid="usb-card" data-usb={group.key}>
            {/* The USB on one line: its name and badges on the left, what its library holds on the right. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <Usb size={20} className={group.retired ? 'shrink-0 text-muted-foreground' : 'shrink-0 text-primary'} />
              <p className="min-w-0 max-w-full truncate text-sm font-black" title={group.name}>{group.name}</p>
              {group.hasActive && <StatusBadge tone="online">Active library</StatusBadge>}
              {connected && <StatusBadge tone="online">Connected now</StatusBadge>}
              {group.retired && <StatusBadge tone="disabled">No longer used</StatusBadge>}
              <p className="ml-auto text-[11px] tabular-nums text-muted-foreground" data-testid="usb-card-summary">
                {group.library
                  ? <><span className="font-bold text-foreground">{plural(group.library.track_count, 'track', 'tracks')} · {plural(group.library.playlist_count, 'playlist', 'playlists')}</span> · Imported {formatDate(group.library.imported_at)} · {plural(group.imports.length, 'import', 'imports')}</>
                  : group.imports.length > 0
                    ? `${plural(group.imports.length, 'import', 'imports')}, none ready to use yet`
                    : 'No library imported from this USB yet.'}
              </p>
            </div>

            {group.imports.length > 0 && (
              <div className="divide-y divide-[var(--color-border-faint)] border-t border-[var(--color-border-faint)]" data-testid="usb-card-snapshots">
                {group.imports.map((snapshot) => (
                  <ImportSnapshotRow
                    key={snapshot.id}
                    snapshot={snapshot}
                    isActive={snapshot.id === activeImportId}
                    onOpen={onOpen}
                    onMakeActive={onMakeActive}
                    onResumeOrRetry={onResumeOrRetry}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
