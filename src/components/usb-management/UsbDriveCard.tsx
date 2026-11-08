import type { ReactNode } from 'react';
import { HardDrive } from 'iconoir-react/regular';
import { cn } from '../../lib/utils';
import { formatBytes, makeAndModel, percentUsed } from '../../lib/usb/usbFormat';
import type { DesktopTransferScan, DesktopUsbDetails } from '../../types/dropdex-desktop';

export function UsbStickArt({ lit = true, size = 112, className }: { lit?: boolean; size?: number; className?: string }) {
  return (
    <HardDrive
      width={size * (96 / 140)}
      height={size}
      className={cn(lit ? 'text-foreground' : 'text-muted-foreground', className)}
      aria-hidden="true"
    />
  );
}

const SEGMENTS: { id: 'tracks' | 'rekordbox' | 'other'; label: string; color: string }[] = [
  { id: 'tracks', label: 'Tracks', color: '#0a91ff' },
  { id: 'rekordbox', label: 'Rekordbox library', color: '#a855f7' },
  { id: 'other', label: 'Other files', color: '#f59e0b' },
];

/** How full the drive is, split into tracks, Rekordbox data and other files when a scan is available. */
export function StorageBar({ details, scan }: { details: DesktopUsbDetails; scan?: DesktopTransferScan | null }) {
  const total = details.totalBytes;
  if (!total || total <= 0) return <p className="text-xs text-muted-foreground">The size of this drive could not be read.</p>;
  const used = details.usedBytes ?? 0;
  const known = scan ? SEGMENTS.map((segment) => ({ ...segment, bytes: scan[segment.id].totalBytes })) : [];
  const knownTotal = known.reduce((sum, segment) => sum + segment.bytes, 0);
  const otherUsed = Math.max(0, used - knownTotal);
  const pct = percentUsed(details);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-black tabular-nums">{formatBytes(details.freeBytes)} <span className="text-xs font-semibold text-muted-foreground">free of {formatBytes(total)}</span></p>
        {pct != null && <span className="font-mono text-[11px] font-bold text-muted-foreground">{pct}% full</span>}
      </div>
      <div className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]" role="img" aria-label={`${pct ?? 0} percent full`}>
        {known.length > 0 ? (
          <>
            {known.map((segment) => <div key={segment.id} title={`${segment.label}: ${formatBytes(segment.bytes)}`} style={{ width: `${(segment.bytes / total) * 100}%`, background: segment.color }} />)}
            {otherUsed > 0 && <div title={`System and unknown: ${formatBytes(otherUsed)}`} style={{ width: `${(otherUsed / total) * 100}%`, background: '#64748b' }} />}
          </>
        ) : (
          <div style={{ width: `${pct ?? 0}%`, background: '#0a91ff' }} />
        )}
      </div>
      {known.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          {known.map((segment) => (
            <span key={segment.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: segment.color }} />{segment.label} <b className="font-mono text-foreground">{formatBytes(segment.bytes)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold" title={value ?? undefined}>{value || 'Unknown'}</p>
    </div>
  );
}

function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

interface UsbDriveCardProps {
  details: DesktopUsbDetails;
  /** "Primary USB", "Copying from", "Copying to". */
  eyebrow: string;
  scan?: DesktopTransferScan | null;
  compact?: boolean;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** The stylised summary of one USB: name, make and model, size, free space, format, and how it is connected. */
export function UsbDriveCard({ details, eyebrow, scan, compact = false, actions, footer, className }: UsbDriveCardProps) {
  const model = makeAndModel(details);
  const driveType = details.removable == null ? null : details.removable ? 'Removable drive' : 'Built-in drive';
  const heading = (
    <>
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{eyebrow}</p>
      <h2 className={cn('mt-1 truncate font-black tracking-tight', compact ? 'text-2xl' : 'text-3xl')} title={details.volumeName}>{details.volumeName}</h2>
      {model && <p className="mt-0.5 truncate text-sm text-muted-foreground">{model}</p>}
    </>
  );
  const connection = [details.protocol, details.solidState == null ? null : details.solidState ? 'Solid state' : 'Spinning disk'].filter(Boolean).join(' · ');
  return (
    <section
      data-testid="usb-drive-card"
      className={cn('glass relative overflow-hidden rounded-3xl border border-[var(--color-border-subtle)] px-5 py-4', className)}
    >
      <div className="pointer-events-none absolute -left-10 -top-16 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
      <div className={cn('relative flex gap-4', compact ? 'flex-col sm:flex-row' : 'flex-col md:flex-row')}>
        <div className={cn(
          'flex shrink-0 items-center rounded-2xl border border-white/10 bg-black/25 px-5 py-3',
          compact ? 'justify-center' : 'flex-col gap-2 text-center md:w-48',
        )}>
          {!compact && (
            <div className="w-full">
              {heading}
              <p className="mt-1 text-xs text-muted-foreground">{driveType || 'Unknown drive type'}</p>
            </div>
          )}
          <UsbStickArt size={compact ? 104 : 96} />
        </div>
        <div className="min-w-0 flex-1">
          {compact && heading}
          <div className={cn('grid gap-x-6 gap-y-2', compact ? 'mt-3 grid-cols-2' : 'grid-cols-2 lg:grid-cols-4')}>
            <Fact label="Size" value={formatBytes(details.totalBytes)} />
            <Fact label="Free" value={formatBytes(details.freeBytes)} />
            <Fact label="Format" value={details.filesystem} />
            <Fact label="Brand" value={details.brand} />
            {!compact && <Fact label="Model" value={details.model} />}
            {!compact && <Fact label="Connection" value={connection || null} />}
            {!compact && <Fact label="Connected" value={formatDate(details.connectedAt)} />}
          </div>
          <div className="mt-3"><StorageBar details={details} scan={scan} /></div>
          {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
      {footer && <div className="relative mt-3 border-t border-white/10 pt-3">{footer}</div>}
    </section>
  );
}
