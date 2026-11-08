import { useState } from 'react';
import { ArrowRight, Clock, NavArrowDown, NavArrowUp, Refresh } from 'iconoir-react/regular';
import { describeCategories, formatBytes } from '../../lib/usb/usbFormat';
import type { UsbTransferRecord } from '../../lib/queries/usbDevices';
import { NoticeCard, StatusBadge } from '../ui/feedback';
import { ControlButton } from '../ui/controls';

const STATUS: Record<UsbTransferRecord['status'], { label: string; tone: 'success' | 'warning' | 'error' | 'neutral' }> = {
  completed: { label: 'Complete', tone: 'success' },
  partial: { label: 'Some problems', tone: 'warning' },
  failed: { label: 'Failed', tone: 'error' },
  cancelled: { label: 'Stopped', tone: 'neutral' },
};

const FILE_PAGE = 100;

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function TransferRow({ transfer }: { transfer: UsbTransferRecord }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(FILE_PAGE);
  const status = STATUS[transfer.status];
  return (
    <li className="usb-panel overflow-hidden rounded-xl border border-[var(--color-border-subtle)]" data-testid="usb-history-row">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-left hover:bg-white/[0.03]">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="truncate">{transfer.sourceLabel}</span><ArrowRight width={14} height={14} className="shrink-0 text-muted-foreground" aria-label="to" /><span className="truncate">{transfer.destinationLabel}</span>
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        <span className="text-xs text-muted-foreground">{describeCategories(transfer.categories)}</span>
        <span className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
          <span className="font-mono font-bold text-foreground">{transfer.copiedCount.toLocaleString()} files · {formatBytes(transfer.totalBytes)}</span>
          <span>{formatWhen(transfer.finishedAt)}</span>
          {open ? <NavArrowUp width={16} height={16} aria-hidden="true" /> : <NavArrowDown width={16} height={16} aria-hidden="true" />}
        </span>
      </button>
      {open && (
        <div className="border-t border-white/10 px-5 py-4">
          <p className="text-xs text-muted-foreground">
            {transfer.copiedCount.toLocaleString()} copied
            {transfer.skippedCount > 0 ? ` · ${transfer.skippedCount.toLocaleString()} already on the destination` : ''}
            {transfer.failedCount > 0 ? ` · ${transfer.failedCount.toLocaleString()} could not be copied` : ''}
          </p>
          {transfer.error && <p className="mt-1 text-xs text-amber-400">{transfer.error}</p>}
          {transfer.files.length === 0 ? (
            <p className="mt-3 text-xs italic text-muted-foreground">No file list was kept for this transfer.</p>
          ) : (
            <>
              <ul className="mt-3 max-h-72 divide-y divide-white/[0.06] overflow-y-auto rounded-xl border border-white/10 usb-file-list font-mono text-[11px]">
                {transfer.files.slice(0, shown).map((file) => (
                  <li key={file.path} className="flex items-center gap-3 px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate" title={file.path}>{file.path}</span>
                    <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
                    <span className={file.status === 'copied' ? 'w-14 shrink-0 text-right text-emerald-400' : file.status === 'skipped' ? 'w-14 shrink-0 text-right text-muted-foreground' : 'w-14 shrink-0 text-right text-red-400'}>{file.status}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span>Showing {Math.min(shown, transfer.files.length).toLocaleString()} of {transfer.files.length.toLocaleString()}{transfer.filesTruncated ? ' (the list was limited to the first 2,000 files)' : ''}</span>
                {shown < transfer.files.length && <ControlButton variant="secondary" onClick={() => setShown((n) => n + FILE_PAGE)}>Show more</ControlButton>}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** Every transfer made between USBs, newest first, with the files that moved. */
export function UsbHistoryTab({ transfers, loading, error, onRetry }: { transfers: UsbTransferRecord[]; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <div className="flex items-center justify-center py-24"><Refresh className="animate-spin text-control-primary" width={28} height={28} aria-hidden="true" /></div>;
  if (error) {
    return (
      <NoticeCard tone="error" title="Could not load transfer history"
        action={<ControlButton variant="secondary" onClick={onRetry}><Refresh width={14} height={14} aria-hidden="true" /> Try again</ControlButton>}>
        {error}
      </NoticeCard>
    );
  }
  if (transfers.length === 0) {
    return (
      <div className="usb-panel flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--color-border-subtle)] px-8 py-16 text-center" data-testid="usb-history-empty">
        <Clock width={32} height={32} aria-hidden="true" className="text-muted-foreground" />
        <h2 className="text-lg font-medium">No transfers yet</h2>
        <p className="max-w-sm text-sm text-muted-foreground">When you copy tracks and your Rekordbox library from one USB to another, each transfer is listed here with the files that moved.</p>
      </div>
    );
  }
  return <ul className="space-y-3">{transfers.map((transfer) => <TransferRow key={transfer.id} transfer={transfer} />)}</ul>;
}
