import { useState } from 'react';
import { NavArrowDown } from 'iconoir-react/regular';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import type { UsbImportGroup } from '../../lib/usb/groupImportsByUsb';
import type { RekordboxImport } from '../../types';
import { EmptyState, StatusBadge } from '../ui/feedback';
import { ImportSnapshotRow } from './ImportSnapshotRow';
import { UsbDriveIcon } from './UsbDriveIcon';
import { UsbStat, UsbStats } from './UsbStat';

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
  /** Start every USB opened. USBs start closed unless told otherwise. */
  defaultOpen?: boolean;
}

/**
 * One card per USB. The top of the card is the USB itself: its name, badges, and the size of the library that stands for it.
 * Under that are the library snapshots (exportLibrary.db imports) that came from this USB.
 */
export function UsbCardsSection({ groups, activeImportId, onOpen, onMakeActive, onResumeOrRetry, onDelete, defaultOpen = false }: UsbCardsProps) {
  const { volumeName } = useUsbConnection();
  if (groups.length === 0) {
    return (
      <div data-testid="usb-cards-empty">
        <EmptyState title="No USBs yet" message="Import a library from a USB and it appears here." />
      </div>
    );
  }
  return (
    <ul className="profile-records profile-usb-records" data-testid="usb-cards">
      {groups.map((group) => {
        const connected = Boolean(volumeName && group.device && group.device.label.trim().toLowerCase() === volumeName.trim().toLowerCase());
        return (
          <UsbCard key={group.key} group={group} connected={connected} activeImportId={activeImportId} onOpen={onOpen} onMakeActive={onMakeActive} onResumeOrRetry={onResumeOrRetry} onDelete={onDelete} defaultOpen={defaultOpen} />
        );
      })}
    </ul>
  );
}

/** One USB. Its header is a button that opens and closes it; inside are its figures, then its library files in a group of their own that also opens and closes. */
function UsbCard({ group, connected, activeImportId, onOpen, onMakeActive, onResumeOrRetry, onDelete, defaultOpen = false }: Omit<UsbCardsProps, 'groups'> & { group: UsbImportGroup; connected: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [filesOpen, setFilesOpen] = useState(true);
  return (
    <li data-testid="usb-card" data-usb={group.key}>
      <div className="profile-usb-record">
        <button type="button" className="profile-collapse profile-record profile-usb-head flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <UsbDriveIcon width={18} height={18} className="shrink-0 text-muted-foreground" />
          <span className="profile-usb-name min-w-0 max-w-full truncate" title={group.name}>{group.name}</span>
          {group.hasActive && <StatusBadge tone="online">Active library</StatusBadge>}
          {connected && <StatusBadge tone="online">Connected now</StatusBadge>}
          {group.retired && <StatusBadge tone="disabled">No longer used</StatusBadge>}
          <NavArrowDown width={14} height={14} aria-hidden="true" className={`ml-auto shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>

        {open && (
          <div className="usb-card-body" data-testid="usb-card-body">
            <div data-testid="usb-card-summary" className={group.library ? 'profile-usb-nested' : ''}>
              {group.library ? (
                <UsbStats>
                  <UsbStat label="Tracks" value={group.library.track_count.toLocaleString()} />
                  <UsbStat label="Playlists" value={group.library.playlist_count.toLocaleString()} />
                  <UsbStat label="Imported" value={formatDate(group.library.imported_at)} />
                  <UsbStat label={group.imports.length === 1 ? 'Import' : 'Imports'} value={group.imports.length.toLocaleString()} />
                </UsbStats>
              ) : (
                <p className="px-5 py-3 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-[#5e6973]" data-testid="usb-empty">
                  {group.imports.length > 0 ? `${plural(group.imports.length, 'import', 'imports')}, none ready to use yet` : 'No library imported from this USB yet.'}
                </p>
              )}
            </div>

            {group.imports.length > 0 && (
              <div className="profile-usb-nested" data-testid="usb-card-snapshots">
                <button type="button" className="profile-collapse flex w-full items-center gap-2 text-left" aria-expanded={filesOpen} onClick={() => setFilesOpen((value) => !value)}>
                  <span className="profile-usb-label">Export library</span>
                  <NavArrowDown width={14} height={14} aria-hidden="true" className={`ml-auto shrink-0 text-muted-foreground transition-transform ${filesOpen ? '' : '-rotate-90'}`} />
                </button>
                {filesOpen && (
                  <div className="profile-usb-files">
                    {group.imports.map((snapshot) => (
                      <ImportSnapshotRow key={snapshot.id} snapshot={snapshot} isActive={snapshot.id === activeImportId} onOpen={onOpen} onMakeActive={onMakeActive} onResumeOrRetry={onResumeOrRetry} onDelete={onDelete} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
