import { useState } from 'react';
import { ArrowRight, CheckCircle, FolderPlus, Refresh, Square, Trash, Usb, WarningTriangle } from 'iconoir-react/regular';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { useTransferDestination, usePrimaryUsbDetails, useTransferScan, useUsbTransfer } from '../../hooks/useDesktopUsb';
import { describeCategories, formatBytes, TRANSFER_CATEGORY_LABELS } from '../../lib/usb/usbFormat';
import { cn } from '../../lib/utils';
import type { DesktopTransferCategory, DesktopTransferResult, DesktopUsbDetails } from '../../types/dropdex-desktop';
import { ControlButton } from '../ui/controls';
import { UsbDriveCard, UsbStickArt } from './UsbDriveCard';

const ALL_CATEGORIES: DesktopTransferCategory[] = ['tracks', 'rekordbox', 'other'];

interface UsbTransferTabProps {
  /** Called with the finished transfer so it can be saved to the history. Resolves false if saving failed. */
  onFinished: (result: DesktopTransferResult, source: DesktopUsbDetails | null, destination: DesktopUsbDetails | null) => Promise<boolean>;
  onShowHistory: () => void;
}

/** The empty right-hand side: click anywhere in it to pick the drive (or folder) to copy to. */
function EmptyDestination({ onChoose, choosing, error }: { onChoose: () => void; choosing: boolean; error: string | null }) {
  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={choosing}
      data-testid="usb-destination-empty"
      className="group flex min-h-[320px] w-full flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)]/40 px-8 py-10 text-center transition-all hover:border-primary/50 hover:bg-primary/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-60"
    >
      <div className="relative">
        <UsbStickArt lit={false} size={112} className="opacity-60 transition-opacity group-hover:opacity-100" />
        <span className="absolute -bottom-1 -right-3 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-[var(--color-background)] shadow-lg">
          {choosing ? <Refresh className="animate-spin" width={18} height={18} aria-hidden="true" /> : <FolderPlus width={18} height={18} aria-hidden="true" />}
        </span>
      </div>
      <div>
        <p className="text-lg font-black">Choose the USB to copy to</p>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">Click here and pick the second USB (or any folder). Your tracks and Rekordbox library will be copied onto it.</p>
      </div>
      {error && <p className="max-w-xs text-xs font-semibold text-red-400" role="alert">{error}</p>}
    </button>
  );
}

function Progress({ copied, skipped, failed, bytes, needed }: { copied: number; skipped: number; failed: number; bytes: number; needed: number }) {
  const pct = needed > 0 ? Math.min(100, Math.round((bytes / needed) * 100)) : 0;
  return (
    <div data-testid="usb-transfer-progress">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-bold">{copied.toLocaleString()} copied{skipped > 0 ? ` · ${skipped.toLocaleString()} already there` : ''}{failed > 0 ? ` · ${failed.toLocaleString()} failed` : ''}</span>
        <span className="font-mono text-muted-foreground">{formatBytes(bytes)} of {formatBytes(needed)}</span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** Left: the USB you play from. Right: an empty slot for the second USB. Below: what to copy, and the button. */
export function UsbTransferTab({ onFinished, onShowHistory }: UsbTransferTabProps) {
  const usb = useUsbConnection();
  const { details } = usePrimaryUsbDetails();
  const { scan, loading: scanning } = useTransferScan();
  const { destination, choosing, error: destinationError, choose, clear } = useTransferDestination();
  const [selected, setSelected] = useState<Set<DesktopTransferCategory>>(new Set(['tracks', 'rekordbox']));
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const transfer = useUsbTransfer((result) => {
    void onFinished(result, details, destination).then((saved) => {
      setSaveNote(saved ? null : 'The transfer finished, but it could not be added to your history.');
    });
  });

  const running = transfer.state.phase === 'running';
  const chosen = ALL_CATEGORIES.filter((id) => selected.has(id));
  const neededBytes = scan ? chosen.reduce((sum, id) => sum + scan[id].totalBytes, 0) : 0;
  const enoughSpace = destination?.freeBytes == null || neededBytes <= destination.freeBytes;
  const ready = usb.status === 'connected' && Boolean(destination) && chosen.length > 0 && enoughSpace && !running;

  const toggle = (id: DesktopTransferCategory) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-5">
      <div className="grid items-stretch gap-5 xl:grid-cols-[1fr_auto_1fr]">
        {usb.status === 'connected' && details ? (
          <UsbDriveCard details={details} eyebrow="Copying from" scan={scan} compact className="h-full" />
        ) : (
          <div className="glass flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-[var(--color-border-subtle)] p-8 text-center">
            <UsbStickArt lit={false} size={104} />
            <p className="text-lg font-black">Connect the USB to copy from</p>
            <ControlButton variant="primary" onClick={() => void usb.selectNewUsb()}><Usb width={14} height={14} aria-hidden="true" /> Choose your USB</ControlButton>
          </div>
        )}
        <div className="hidden h-full items-center justify-center xl:flex"><ArrowRight width={28} height={28} className="text-muted-foreground" aria-hidden="true" /></div>
        {destination ? (
          <UsbDriveCard
            details={destination}
            eyebrow="Copying to"
            compact
            className="h-full"
            actions={!running && (
              <>
                <ControlButton variant="neutral" onClick={() => void choose()} disabled={choosing}><FolderPlus width={14} height={14} aria-hidden="true" /> Choose another</ControlButton>
                <ControlButton variant="ghost" onClick={() => void clear()}><Trash width={14} height={14} aria-hidden="true" /> Remove</ControlButton>
              </>
            )}
            footer={destinationError ? <p className="text-xs font-semibold text-red-400" role="alert">{destinationError}</p> : undefined}
          />
        ) : (
          <EmptyDestination onChoose={() => void choose()} choosing={choosing} error={destinationError} />
        )}
      </div>

      <section className="glass rounded-3xl border border-[var(--color-border-subtle)] p-6" data-testid="usb-transfer-options">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">What to copy</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {ALL_CATEGORIES.map((id) => {
            const info = TRANSFER_CATEGORY_LABELS[id];
            const on = selected.has(id);
            return (
              <label key={id} className={cn('flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors', on ? 'border-primary/50 bg-primary/[0.07]' : 'border-[var(--color-border-subtle)] hover:border-primary/30', running && 'pointer-events-none opacity-60')}>
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--color-primary)]" checked={on} onChange={() => toggle(id)} disabled={running} />
                <span className="min-w-0">
                  <span className="block text-sm font-black">{info.title}</span>
                  <span className="block text-xs text-muted-foreground">{info.description}</span>
                  <span className="mt-1.5 block font-mono text-[11px] font-bold">{scan ? `${scan[id].fileCount.toLocaleString()} files · ${formatBytes(scan[id].totalBytes)}` : scanning ? 'Counting…' : '—'}</span>
                </span>
              </label>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
          <div className="text-sm">
            <p className="font-bold">{describeCategories(chosen)}: <span className="font-mono">{formatBytes(neededBytes)}</span></p>
            <p className={cn('text-xs', enoughSpace ? 'text-muted-foreground' : 'font-semibold text-red-400')}>
              {destination
                ? enoughSpace ? `${formatBytes(destination.freeBytes)} free on ${destination.volumeName}` : `Not enough room: ${destination.volumeName} has ${formatBytes(destination.freeBytes)} free.`
                : 'Choose a destination to see if it fits.'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Files are only added. Nothing is deleted or replaced on either drive.</p>
          </div>
          {running ? (
            <ControlButton variant="danger-outline" onClick={transfer.cancel}><Square width={14} height={14} aria-hidden="true" /> Stop transfer</ControlButton>
          ) : (
            <ControlButton variant="primary" disabled={!ready} onClick={() => { setSaveNote(null); void transfer.start(chosen); }}><ArrowRight width={14} height={14} aria-hidden="true" /> Start transfer</ControlButton>
          )}
        </div>

        {transfer.state.phase === 'running' && (
          <div className="mt-5">
            {transfer.state.progress
              ? <Progress copied={transfer.state.progress.copied} skipped={transfer.state.progress.skipped} failed={transfer.state.progress.failed} bytes={transfer.state.progress.bytes} needed={transfer.state.progress.neededBytes || neededBytes} />
              : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Refresh className="animate-spin text-primary" width={16} height={16} aria-hidden="true" /> Getting ready…</p>}
          </div>
        )}

        {transfer.state.phase === 'error' && (
          <p className="mt-5 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300" role="alert"><WarningTriangle width={16} height={16} aria-hidden="true" className="mt-0.5 shrink-0" /> {transfer.state.message}</p>
        )}

        {transfer.state.phase === 'done' && (
          <div className="mt-5 rounded-xl border border-[var(--color-border-subtle)] bg-white/[0.03] p-4" data-testid="usb-transfer-result">
            <p className="flex items-center gap-2 text-sm font-black">
              {transfer.state.outcome.status === 'completed' ? <CheckCircle width={16} height={16} aria-hidden="true" className="text-emerald-500" /> : <WarningTriangle width={16} height={16} aria-hidden="true" className="text-amber-400" />}
              {transfer.state.outcome.status === 'completed' ? 'Transfer complete' : transfer.state.outcome.status === 'cancelled' ? 'Transfer stopped' : transfer.state.outcome.status === 'partial' ? 'Transfer finished with some problems' : 'Transfer failed'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {transfer.state.outcome.copied.toLocaleString()} files copied ({formatBytes(transfer.state.outcome.bytes)})
              {transfer.state.outcome.skipped > 0 ? ` · ${transfer.state.outcome.skipped.toLocaleString()} were already on the destination` : ''}
              {transfer.state.outcome.failed > 0 ? ` · ${transfer.state.outcome.failed.toLocaleString()} could not be copied` : ''}
            </p>
            {transfer.state.outcome.error && <p className="mt-1 text-xs text-amber-400">{transfer.state.outcome.error}</p>}
            {saveNote && <p className="mt-1 text-xs text-amber-400">{saveNote}</p>}
            <div className="mt-3 flex gap-2">
              <ControlButton variant="neutral" onClick={onShowHistory}>See in history</ControlButton>
              <ControlButton variant="primary" onClick={transfer.reset}>Done</ControlButton>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
