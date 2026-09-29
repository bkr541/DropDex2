import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { useUsbConnection, type UsbStatus } from '../../contexts/UsbConnectionContext';
import { CircleDash, CloseFilled, FolderOff, Renew, Unplug, Usb, WarningAlt, WifiOff } from '@carbon/icons-react';
import { ControlButton } from '../ui/controls';

interface UsbConnectionButtonProps {
  collapsed?: boolean;
}

function StatusDot({ status }: { status: UsbStatus }) {
  if (status === 'connected') {
    return <span className="w-2 h-2 shrink-0 rounded-full bg-green-400 shadow-[0_0_7px_rgb(74_222_128_/_0.55)]" aria-hidden="true" />;
  }
  if (status === 'released') {
    return <span className="w-2 h-2 shrink-0 rounded-full bg-cyan-400" aria-hidden="true" />;
  }
  if (status === 'permission-required' || status === 'wrong_root') {
    return <span className="w-2 h-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />;
  }
  if (status === 'unavailable') {
    return <span className="w-2 h-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />;
  }
  if (status === 'error') {
    return <span className="w-2 h-2 shrink-0 rounded-full bg-red-500" aria-hidden="true" />;
  }
  return null;
}

function StatusIcon({ status, size = 18 }: { status: UsbStatus; size?: number }) {
  if (status === 'connecting') return <CircleDash size={size} className="animate-spin" />;
  if (status === 'error') return <CloseFilled size={size} />;
  if (status === 'unavailable') return <WifiOff size={size} />;
  if (status === 'wrong_root') return <FolderOff size={size} />;
  if (status === 'connected') return <Usb size={size} className="text-green-400" />;
  return <Usb size={size} />;
}

function statusLabel(status: UsbStatus, volumeName: string | null): string {
  switch (status) {
    case 'unsupported':       return 'USB unavailable';
    case 'connecting':        return 'Connecting…';
    case 'connected':         return volumeName ?? 'USB Connected';
    case 'released':          return 'USB Released';
    case 'permission-required': return 'Re-authorize USB';
    case 'wrong_root':        return 'Wrong folder selected';
    case 'unavailable':       return 'USB not found';
    case 'error':             return 'USB error';
    default:                  return 'Connect USB';
  }
}

function statusTitle(status: UsbStatus, volumeName: string | null): string {
  switch (status) {
    case 'connected':           return `Connected: ${volumeName ?? 'USB'}`;
    case 'released':            return 'USB access is released and all tracked streams are closed. Click to reconnect.';
    case 'permission-required': return 'USB permission expired — click to re-authorize';
    case 'wrong_root':          return 'Wrong folder — select the USB root, not PIONEER or a subfolder';
    case 'unavailable':         return 'USB drive not found — reinsert or select a different drive';
    case 'error':               return 'USB error — click to retry';
    case 'unsupported':         return 'Folder access unavailable. Install the DropDex desktop app, or use Chrome/Edge over HTTPS or localhost.';
    default:                    return 'Connect a Rekordbox USB drive';
  }
}

function statusTooltip(
  status: UsbStatus,
  volumeName: string | null,
  error: string | null,
): { heading: string; detail: string; tone: 'ok' | 'info' | 'warn' | 'bad' | 'muted' } {
  switch (status) {
    case 'connected':
      return { heading: 'USB connected', detail: volumeName ? `"${volumeName}" is ready to use.` : 'Your USB is ready to use.', tone: 'ok' };
    case 'connecting':
      return { heading: 'Connecting…', detail: 'Checking your USB drive.', tone: 'muted' };
    case 'released':
      return { heading: 'USB handed back', detail: 'DropDex let go of the drive so Rekordbox can use it. Click to take it back.', tone: 'info' };
    case 'permission-required':
      return { heading: 'Permission needed', detail: 'Your computer needs you to allow access to the USB again. Click to allow it.', tone: 'warn' };
    case 'wrong_root':
      return { heading: 'Wrong folder', detail: 'Pick the main folder of the USB, not PIONEER or a folder inside it. Click to choose again.', tone: 'warn' };
    case 'unavailable':
      return { heading: 'USB not found', detail: 'Plug the drive back in, or click to try again.', tone: 'warn' };
    case 'error':
      return { heading: 'USB problem', detail: error ? `${error} Click to try again.` : 'Something went wrong with the USB. Click to try again.', tone: 'bad' };
    case 'unsupported':
      return { heading: 'USB not available', detail: 'Reading a USB needs the DropDex desktop app.', tone: 'muted' };
    default:
      return { heading: 'No USB connected', detail: 'Click to connect your Rekordbox USB.', tone: 'muted' };
  }
}

const TOOLTIP_TONE: Record<'ok' | 'info' | 'warn' | 'bad' | 'muted', string> = {
  ok: 'bg-green-400',
  info: 'bg-cyan-400',
  warn: 'bg-amber-400',
  bad: 'bg-red-500',
  muted: 'bg-slate-500',
};

export function UsbConnectionButton({ collapsed = false }: UsbConnectionButtonProps) {
  const {
    status,
    volumeName,
    error,
    structureWarning,
    connect,
    disconnect,
    reconnect,
    selectNewUsb,
    ensurePermission,
  } = useUsbConnection();

  const isConnecting = status === 'connecting';
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [tooltipAnchor, setTooltipAnchor] = useState<{ left: number; top: number } | null>(null);
  const tooltip = statusTooltip(status, volumeName, error);

  function showTooltip() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setTooltipAnchor({ left: rect.right + 10, top: rect.top + rect.height / 2 });
  }
  const hideTooltip = () => setTooltipAnchor(null);

  function handlePrimaryClick() {
    if (isConnecting) return;
    if (status === 'connected') return;
    if (status === 'permission-required') {
      void ensurePermission();
    } else if (status === 'unsupported') {
      // Retry — detection may have been wrong (e.g. Brave fingerprinting shields)
      void connect();
    } else if (status === 'unavailable') {
      // Try re-verifying the stored handle first (drive may have been reinserted).
      void reconnect();
    } else if (status === 'wrong_root') {
      // User selected the wrong folder — always open picker.
      void selectNewUsb();
    } else if (status === 'released' || status === 'error') {
      void reconnect();
    } else {
      void connect();
    }
  }

  const primaryButtonStyle = cn(
    'relative flex items-center rounded-lg font-bold text-sm transition-all border border-[#27313d] bg-gradient-to-b from-[#121923] to-[#090d12] shadow-[0_5px_10px_rgb(10_15_22_/_0.25),inset_0_1px_0_rgb(255_255_255_/_0.05)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8f42e8] focus-visible:ring-offset-2',
    collapsed ? 'justify-center py-2.5 px-0 w-full' : 'gap-3 px-4 py-3 flex-1 min-w-0',
    status === 'connected'
      ? 'text-slate-100 hover:border-green-500/50 hover:from-[#15221f]'
      : status === 'released'
      ? 'text-cyan-300 hover:border-cyan-500/50 cursor-pointer'
      : status === 'permission-required' || status === 'wrong_root' || status === 'unavailable'
      ? 'text-amber-300 hover:border-amber-500/50 cursor-pointer'
      : status === 'error'
      ? 'text-red-300 hover:border-red-500/50 cursor-pointer'
      : isConnecting
      ? 'text-slate-400 cursor-wait'
      : 'text-slate-100 hover:text-white hover:border-[#3c4857] hover:from-[#18222e] cursor-pointer',
  );

  return (
    <div className="flex flex-col gap-1">
      {/* Structure warning badge (partial Rekordbox folders found) */}
      {!collapsed && structureWarning && status === 'connected' && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[10px] text-amber-400 leading-tight">
          <WarningAlt size={10} className="mt-0.5 shrink-0" />
          <span>{structureWarning}</span>
        </div>
      )}

      {/* Wrong-root warning with explicit Select Again action */}
      {!collapsed && status === 'wrong_root' && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[10px] text-amber-400 leading-tight">
          <FolderOff size={10} className="mt-0.5 shrink-0" />
          <span>Select the USB root folder, not PIONEER or a subfolder.</span>
        </div>
      )}

      {/* Error badge */}
      {!collapsed && error && status === 'error' && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-[10px] text-red-400 leading-tight break-all">
          <CloseFilled size={10} className="mt-0.5 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      <div className={cn('flex items-center gap-1', collapsed && 'justify-center')}>
        {/* Main action button */}
        <button
          ref={buttonRef}
          onClick={() => { hideTooltip(); handlePrimaryClick(); }}
          onMouseEnter={showTooltip}
          onMouseLeave={hideTooltip}
          onFocus={showTooltip}
          onBlur={hideTooltip}
          disabled={isConnecting}
          aria-label={statusTitle(status, volumeName)}
          className={primaryButtonStyle}
        >
          {status !== 'connected' && <StatusDot status={status} />}
          <StatusIcon status={status} size={18} />
          {!collapsed && (
            <span className="truncate">{statusLabel(status, volumeName)}</span>
          )}
        </button>

        {tooltipAnchor && createPortal(
          <div
            role="tooltip"
            data-testid="usb-status-tooltip"
            style={{ left: tooltipAnchor.left, top: tooltipAnchor.top }}
            className="pointer-events-none fixed z-[100] w-56 -translate-y-1/2 rounded-lg border border-[var(--color-border-subtle)] bg-[#0d131b] px-3 py-2 shadow-[0_8px_24px_rgb(0_0_0_/_0.5)]"
          >
            <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', TOOLTIP_TONE[tooltip.tone])} aria-hidden="true" />
              {tooltip.heading}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-slate-400">{tooltip.detail}</p>
          </div>,
          document.body,
        )}

        {/* "Select USB Again" secondary action — shown when unavailable (after reconnect attempt) */}
        {!collapsed && status === 'unavailable' && (
          <ControlButton
            variant="ghost"
            onClick={() => void selectNewUsb()}
            title="Select a different USB drive"
            aria-label="Select a different USB drive"
            className="shrink-0 text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20"
          >
            <Renew size={16} />
          </ControlButton>
        )}

        {/* Disconnect button — only shown when connected, expanded */}
        {!collapsed && status === 'connected' && (
          <ControlButton
            variant="ghost"
            onClick={() => void disconnect()}
            title="Disconnect USB"
            aria-label="Disconnect USB drive"
            className="shrink-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20"
          >
            <Unplug size={16} />
          </ControlButton>
        )}
      </div>
    </div>
  );
}
