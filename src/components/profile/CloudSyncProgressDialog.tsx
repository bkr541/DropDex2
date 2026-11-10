import { CloudUpload } from 'iconoir-react/regular';
import type { PreviewSyncState } from '../../lib/preview/previewSync';
import { QuietProgress, quietOverallPercent, type QuietPhase } from '../ui/feedback';
import { Dialog } from '../ui/feedback/Dialog';
import { NoticeCard } from '../ui/feedback/NoticeCard';

const SYNC_PHASES: readonly QuietPhase[] = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'upload', label: 'Upload' },
  { id: 'complete', label: 'Complete' },
];

export function CloudSyncProgressDialog({ open = true, inline = false, sync, onClose, onStop }: {
  open?: boolean;
  inline?: boolean;
  sync: PreviewSyncState;
  onClose: () => void;
  onStop: () => void;
}) {
  if (!open || sync.phase === 'idle') return null;

  const running = sync.phase === 'preparing' || sync.phase === 'running';
  const failed = sync.phase === 'error';
  const done = sync.phase === 'done' && !sync.cancelled;
  const activeIndex = done ? 2 : sync.phase === 'preparing' || !sync.total ? 0 : 1;
  const stagePercent = activeIndex === 0 || !sync.total ? 0 : Math.round((sync.processed / sync.total) * 100);
  const headline = sync.stopping ? 'Stopping sync…'
    : sync.phase === 'preparing' ? 'Getting ready…'
    : sync.phase === 'running' ? `${sync.current ?? 'Uploading previews…'} · ${sync.processed.toLocaleString()} of ${sync.total.toLocaleString()}`
    : sync.cancelled ? 'Sync stopped'
    : done ? (sync.failed === 0 ? 'Sync complete' : 'Sync finished with some problems')
    : null;

  return (
    <Dialog
      inline={inline}
      title="Cloud sync"
      icon={<CloudUpload width={24} height={24} aria-hidden="true" />}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={running ? [
        { label: sync.stopping ? 'Stopping…' : 'Stop', variant: 'danger', onClick: onStop, disabled: sync.stopping },
        { label: 'Run in Background', variant: 'secondary', onClick: onClose },
      ] : [
        { label: failed ? 'Close' : 'Done', variant: failed ? 'secondary' : 'primary', onClick: onClose },
      ]}
    >
      <QuietProgress
        title="Cloud sync"
        phases={SYNC_PHASES}
        activeIndex={activeIndex}
        percent={quietOverallPercent(activeIndex, SYNC_PHASES.length, stagePercent, done)}
        stagePercent={stagePercent}
        status={done ? 'done' : failed || sync.cancelled ? 'failed' : 'running'}
        caption={failed ? 'Failed' : sync.cancelled ? 'Stopped' : undefined}
        headline={headline}
        figures={failed ? undefined : [
          { label: 'Synced', value: sync.synced.toLocaleString() },
          { label: 'Up to date', value: sync.skipped.toLocaleString() },
          { label: 'Could not sync', value: sync.failed.toLocaleString() },
        ]}
      >
        {failed && <NoticeCard tone="error">{sync.message}</NoticeCard>}
        {sync.phase === 'done' && sync.failures.length > 0 && (
          <ul className="max-h-40 divide-y divide-[var(--color-control-border-soft)] overflow-y-auto rounded-[var(--radius-control)] border border-[var(--color-control-border)] bg-transparent px-3 text-xs">
            {sync.failures.slice(0, 50).map((failure) => (
              <li key={failure.trackId} className="py-2"><span className="font-semibold">{failure.title}</span> <span className="text-muted-foreground">— {failure.message}</span></li>
            ))}
            {sync.failures.length > 50 && <li className="py-2 text-muted-foreground">…and {(sync.failures.length - 50).toLocaleString()} more (see the Developer tab's log).</li>}
          </ul>
        )}
      </QuietProgress>
    </Dialog>
  );
}
