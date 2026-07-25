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


export interface DesktopUsbActivityState {
  connected: boolean;
  activeStreamCount: number;
  pendingRequestCount: number;
  activePlaybackCount: number;
  releasing: boolean;
  released: boolean;
  lastError: string | null;
}

export interface DesktopUsbReleaseResult {
  allStreamsClosed: boolean;
  timedOut: boolean;
  destroyedStreamCount: number;
  remainingStreamCount: number;
  pendingRequestCount: number;
  disconnected: boolean;
  state: DesktopUsbState;
  activity: DesktopUsbActivityState;
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
  getUsbActivityState(): Promise<DesktopUsbActivityState>;
  selectUsbRoot(): Promise<{ cancelled: boolean; state: DesktopUsbState; error?: string }>;
  releaseUsb(): Promise<DesktopUsbReleaseResult>;
  disconnectUsb(): Promise<DesktopUsbReleaseResult>;
  resolveTrackSource(segments: string[]): Promise<DesktopTrackSourceResult>;
  openExternal(url: string): Promise<boolean>;
}

declare global {
  interface Window {
    dropdexDesktop?: DropDexDesktopBridge;
  }
}

export {};
