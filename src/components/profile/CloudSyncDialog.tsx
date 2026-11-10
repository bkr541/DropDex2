import { CloudUpload } from 'iconoir-react/regular';
import { Dialog } from '../ui/feedback/Dialog';

export function CloudSyncDialog({ open = true, inline = false, trackCount, onClose, onSelectTracks, onSyncAll }: {
  open?: boolean;
  inline?: boolean;
  trackCount: number | null;
  onClose: () => void;
  onSelectTracks: () => void;
  onSyncAll: () => void;
}) {
  return (
    <Dialog
      open={open}
      inline={inline}
      title="Sync your tracks to the Cloud"
      icon={<CloudUpload width={24} height={24} aria-hidden="true" />}
      onClose={onClose}
      actions={[
        { label: 'Cancel', variant: 'secondary', onClick: onClose },
        { label: 'Select Tracks', variant: 'secondary', onClick: onSelectTracks },
        { label: 'Sync All', variant: 'primary', onClick: onSyncAll },
      ]}
    >
      <p>DropDex makes a smaller 160 kbps copy of each track and uploads it to your private Cloud folder. Your original files are never changed. Tracks that are already synced and haven't changed are skipped.</p>
      <p className="mt-2 text-muted-foreground">Sync all {trackCount != null ? trackCount.toLocaleString() : ''} tracks, or choose which ones to sync.</p>
    </Dialog>
  );
}
