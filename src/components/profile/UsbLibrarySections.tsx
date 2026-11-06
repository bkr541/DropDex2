import { Usb } from '@carbon/icons-react';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { UNASSIGNED_KEY, type UsbImportGroup } from '../../lib/usb/groupImportsByUsb';
import type { RekordboxImport } from '../../types';
import { StatusBadge } from '../ui/feedback';
import { ImportSnapshotRow } from './ImportSnapshotRow';

const formatDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** One card per USB: its name, how many libraries came from it, and the size of the library that stands for it. */
export function UsbCardsSection({ groups }: { groups: UsbImportGroup[] }) {
  const { volumeName } = useUsbConnection();
  if (groups.length === 0) {
    return (
      <div className="glass rounded-2xl p-4 text-center" data-testid="usb-cards-empty">
        <p className="text-sm text-muted-foreground italic">No USBs yet. Import a library from a USB and it appears here.</p>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="usb-cards">
      {groups.map((group) => {
        const connected = Boolean(volumeName && group.device && group.device.label.trim().toLowerCase() === volumeName.trim().toLowerCase());
        return (
          <li key={group.key} className="glass flex flex-col gap-2 rounded-2xl p-4" data-testid="usb-card">
            <div className="flex items-start gap-3">
              <Usb size={28} className={group.retired ? 'shrink-0 text-muted-foreground' : 'shrink-0 text-primary'} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-black" title={group.name}>{group.name}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {group.hasActive && <StatusBadge tone="online">Active library</StatusBadge>}
                  {connected && <StatusBadge tone="online">Connected now</StatusBadge>}
                  {group.retired && <StatusBadge tone="disabled">No longer used</StatusBadge>}
                </div>
              </div>
            </div>
            {group.library ? (
              <div>
                <p className="text-sm font-bold tabular-nums">{plural(group.library.track_count, 'track', 'tracks')} · {plural(group.library.playlist_count, 'playlist', 'playlists')}</p>
                <p className="text-[11px] text-muted-foreground">
                  Imported {formatDate(group.library.imported_at)} · {plural(group.imports.length, 'import', 'imports')}
                </p>
              </div>
            ) : group.imports.length > 0 ? (
              <p className="text-xs text-muted-foreground">{plural(group.imports.length, 'import', 'imports')}, none ready to use yet.</p>
            ) : (
              <p className="text-xs text-muted-foreground">No library imported from this USB yet.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface SnapshotGroupsProps {
  groups: UsbImportGroup[];
  activeImportId: string | null;
  onOpen: (snapshot: RekordboxImport) => void;
  onMakeActive: (snapshot: RekordboxImport) => void;
  onResumeOrRetry: (snapshot: RekordboxImport) => void;
  onDelete: (snapshot: RekordboxImport) => void;
}

/** The library snapshots (exportLibrary.db imports), grouped under the USB each one came from. USBs with no snapshots are left out. */
export function UsbSnapshotGroups({ groups, activeImportId, onOpen, onMakeActive, onResumeOrRetry, onDelete }: SnapshotGroupsProps) {
  const withImports = groups.filter((group) => group.imports.length > 0);
  return (
    <div className="space-y-5" data-testid="usb-snapshot-groups">
      {withImports.map((group) => (
        <section key={group.key} aria-label={`${group.name} library snapshots`} data-testid="usb-snapshot-group" data-usb={group.key === UNASSIGNED_KEY ? 'unassigned' : group.key}>
          <h3 className="mb-2 flex items-center gap-2 px-1 text-[11px] font-bold">
            <Usb size={13} className="shrink-0 text-muted-foreground" />
            <span className="truncate">{group.name}</span>
            <span className="font-normal text-muted-foreground">· {plural(group.imports.length, 'import', 'imports')}</span>
            {group.retired && <StatusBadge tone="disabled">No longer used</StatusBadge>}
          </h3>
          <div className="glass divide-y divide-[var(--color-border-faint)] rounded-2xl">
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
        </section>
      ))}
    </div>
  );
}
