import type { useAudioTrackCopy } from '../../hooks/useAudioTrackCopy';
import { formatBytes } from '../../lib/usb/usbFormat';
import { ControlButton } from '../ui/controls';
import { NoticeCard, ProgressBar, StatusLoader } from '../ui/feedback';

type Copy = ReturnType<typeof useAudioTrackCopy>;
export function UsbAudioCopyStatus({ copy }: { copy: Copy }) {
  if (copy.phase === 'idle') return null;
  if (copy.phase === 'locating' || copy.phase === 'preparing') return <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
    <StatusLoader label={copy.phase === 'locating' ? 'Locating USB' : 'Checking audio file'} />
    {copy.phase === 'locating' ? 'Choose the root of the matching mounted USB.' : 'Checking the audio file and destination…'}
  </div>;
  if (copy.phase === 'error') return <NoticeCard tone="error" title="Audio file could not be copied" action={<ControlButton variant="secondary" onClick={() => void copy.cancel()}>Dismiss</ControlButton>}>{copy.message}</NoticeCard>;
  const plan = copy.plan;
  if (!plan) return null;
  return <section className="usb-audio-copy-review space-y-3" aria-label="Audio file copy">
    <h3 className="text-sm font-medium">{copy.phase === 'review' ? 'Review audio file copy' : copy.phase === 'running' ? 'Copying audio file' : copy.outcome?.status === 'copied' ? 'Audio file copied and verified' : copy.outcome?.status === 'skipped' ? 'Existing file skipped' : copy.outcome?.status === 'cancelled' ? 'Audio copy stopped' : 'Audio copy failed'}</h3>
    <dl className="usb-audio-copy-paths">
      <div><dt>From {plan.source.details.volumeName}</dt><dd>{plan.sourcePath}</dd></div>
      <div><dt>To {plan.destination.details.volumeName}</dt><dd>{plan.destinationPath}</dd></div>
      <div><dt>Audio file</dt><dd>{formatBytes(plan.sizeBytes)}</dd></div>
    </dl>
    {copy.phase === 'review' && <>
      <p className="text-xs text-muted-foreground">Copies only this audio file. Existing files and Rekordbox databases are left unchanged.</p>
      {plan.exists && <p className="text-xs text-muted-foreground" role="status">A file already exists at the destination. It will be skipped.</p>}
      <div className="flex flex-wrap gap-2">
        <ControlButton variant="primary" disabled={plan.exists} onClick={() => void copy.start()}>Copy audio file</ControlButton>
        <ControlButton variant="secondary" onClick={() => void copy.cancel()}>{plan.exists ? 'Close' : 'Cancel'}</ControlButton>
      </div>
    </>}
    {copy.phase === 'running' && <>
      <ProgressBar value={copy.progress?.percent ?? 0} label={copy.progress?.phase === 'verifying' ? 'Verifying audio' : 'Copying audio'} showValue />
      <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground" role="status">{copy.message || (copy.progress?.phase === 'verifying' ? 'Verifying copied bytes…' : 'Copying audio…')}</p>
        <ControlButton variant="secondary" onClick={() => void copy.cancel()} disabled={Boolean(copy.message)}>Stop copy</ControlButton>
      </div>
    </>}
    {copy.phase === 'done' && <>
      {copy.outcome?.error && <p className="text-xs text-muted-foreground" role="status">{copy.outcome.error}</p>}
      {copy.outcome?.cleanupIncomplete && <NoticeCard tone="warning">A temporary or incomplete file could not be cleaned up. Check the displayed destination before retrying.</NoticeCard>}
      {copy.historyIssue && <NoticeCard tone="warning">The copy finished, but its result could not be saved to transfer history.</NoticeCard>}
      <ControlButton variant="secondary" onClick={() => void copy.cancel()}>Done</ControlButton>
    </>}
  </section>;
}
