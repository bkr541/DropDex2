import type { UsbFileResolutionError } from '../lib/usb/resolveUsbFile';

export type DesktopUsbStatus =
  | 'disconnected'
  | 'connected'
  | 'wrong_root'
  | 'unavailable'
  | 'error';

export interface DesktopUsbState {
  status: DesktopUsbStatus;
  volumeName: string | null;
  connectedAt: string | null;
  structureWarning: string | null;
  error: string | null;
}

export type DesktopTrackSourceResult =
  | {
      ok: true;
      source: {
        kind: 'url';
        url: string;
        size: number;
      };
    }
  | {
      ok: false;
      error: UsbFileResolutionError;
    };

export interface DropDexDesktopBridge {
  readonly isElectron: true;
  getRuntimeInfo(): Promise<{ platform: string; version: string }>;
  getUsbState(): Promise<DesktopUsbState>;
  selectUsbRoot(): Promise<{ cancelled: boolean; state: DesktopUsbState }>;
  disconnectUsb(): Promise<DesktopUsbState>;
  resolveTrackSource(segments: string[]): Promise<DesktopTrackSourceResult>;
  openExternal(url: string): Promise<boolean>;
}

declare global {
  interface Window {
    dropdexDesktop?: DropDexDesktopBridge;
  }
}

export {};
