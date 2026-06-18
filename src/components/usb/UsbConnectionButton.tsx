import { Usb, Unplug, Loader2, AlertTriangle, XCircle, WifiOff, FolderX, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useUsbConnection, type UsbStatus } from '../../contexts/UsbConnectionContext';

interface UsbConnectionButtonProps {
  collapsed?: boolean;
}

function StatusDot({ status }: { status: UsbStatus }) {
  if (status === 'connected') {
    return <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-green-500" />;
  }
  if (status === 'permission-required' || status === 'wrong_root') {
    return <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400" />;
  }
  if (status === 'unavailable') {
    return <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400" />;
  }
  if (status === 'error') {
    return <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500" />;
  }
  return null;
}

function StatusIcon({ status, size = 18 }: { status: UsbStatus; size?: number }) {
  if (status === 'connecting') return <Loader2 size={size} className="animate-spin" />;
  if (status === 'error') return <XCircle size={size} />;
  if (status === 'unavailable') return <WifiOff size={size} />;
  if (status === 'wrong_root') return <FolderX size={size} />;
  return <Usb size={size} />;
}

function statusLabel(status: UsbStatus, volumeName: string | null): string {
  switch (status) {
    case 'unsupported':       return 'USB not supported';
    case 'connecting':        return 'Connecting…';
    case 'connected':         return volumeName ?? 'USB Connected';
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
    case 'permission-required': return 'USB permission expired — click to re-authorize';
    case 'wrong_root':          return 'Wrong folder — select the USB root, not PIONEER or a subfolder';
    case 'unavailable':         return 'USB drive not found — reinsert or select a different drive';
    case 'error':               return 'USB error — click to retry';
    case 'unsupported':         return 'File System Access API is not supported in this browser';
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

  const isUnsupported = status === 'unsupported';
  const isConnecting = status === 'connecting';

  function handlePrimaryClick() {
    if (isUnsupported || isConnecting) return;
    if (status === 'connected') return;
    if (status === 'permission-required') {
      void ensurePermission();
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
    'relative flex items-center rounded-xl font-bold text-sm transition-all border',
    collapsed ? 'justify-center py-2.5 px-0 w-full' : 'gap-3 px-4 py-2.5 flex-1 min-w-0',
    isUnsupported
      ? 'text-muted-foreground/40 border-transparent cursor-not-allowed'
      : status === 'connected'
      ? 'text-green-400 bg-green-500/10 border-green-500/20 hover:bg-green-500/15'
      : status === 'permission-required'
      ? 'text-amber-400 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/15 cursor-pointer'
      : status === 'wrong_root'
      ? 'text-amber-400 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/15 cursor-pointer'
      : status === 'unavailable'
      ? 'text-amber-400 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/15 cursor-pointer'
      : status === 'error'
      ? 'text-red-400 bg-red-500/10 border-red-500/20 hover:bg-red-500/15 cursor-pointer'
      : isConnecting
      ? 'text-muted-foreground border-transparent cursor-wait'
      : 'text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface)] border-transparent cursor-pointer',
  );

  return (
    <div className="flex flex-col gap-1">
      {/* Structure warning badge (partial Rekordbox folders found) */}
      {!collapsed && structureWarning && status === 'connected' && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[10px] text-amber-400 leading-tight">
          <AlertTriangle size={10} className="mt-0.5 shrink-0" />
          <span>{structureWarning}</span>
        </div>
      )}

      {/* Wrong-root warning with explicit Select Again action */}
      {!collapsed && status === 'wrong_root' && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[10px] text-amber-400 leading-tight">
          <FolderX size={10} className="mt-0.5 shrink-0" />
          <span>Select the USB root folder, not PIONEER or a subfolder.</span>
        </div>
      )}

      {/* Error badge */}
      {!collapsed && error && status === 'error' && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-[10px] text-red-400 leading-tight break-all">
          <XCircle size={10} className="mt-0.5 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      <div className={cn('flex items-center gap-1', collapsed && 'justify-center')}>
        {/* Main action button */}
        <button
          onClick={handlePrimaryClick}
          disabled={isUnsupported || isConnecting}
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
          <button
            onClick={() => void selectNewUsb()}
            title="Select a different USB drive"
            aria-label="Select a different USB drive"
            className="shrink-0 p-2.5 rounded-xl text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20 transition-all"
          >
            <RefreshCw size={16} />
          </button>
        )}

        {/* Disconnect button — only shown when connected, expanded */}
        {!collapsed && status === 'connected' && (
          <button
            onClick={() => void disconnect()}
            title="Disconnect USB"
            aria-label="Disconnect USB drive"
            className="shrink-0 p-2.5 rounded-xl text-muted-foreground hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all"
          >
            <Unplug size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
