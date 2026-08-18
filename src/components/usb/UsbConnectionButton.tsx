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
    } else if (status === 'error') {
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
          onClick={handlePrimaryClick}
          disabled={isConnecting}
          title={collapsed ? statusTitle(status, volumeName) : undefined}
          aria-label={statusTitle(status, volumeName)}
          className={primaryButtonStyle}
        >
          <StatusDot status={status} />
          <StatusIcon status={status} size={18} />
          {!collapsed && (
            <span className="truncate">{statusLabel(status, volumeName)}</span>
          )}
        </button>

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
