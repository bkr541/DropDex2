import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import {
  getStoredUsbHandle,
  saveUsbHandle,
  removeUsbHandle,
  type UsbConnectionMetadata,
} from '../lib/usb/usbHandleStore';
import {
  isFileSystemAccessSupported,
  ensureReadPermission,
  queryPermission,
} from '../lib/usb/usbPermissions';
import {
  resolveUsbFile,
  checkRekordboxStructure,
  type UsbFileResult,
} from '../lib/usb/resolveUsbFile';

// ── Status ────────────────────────────────────────────────────────────────────

export type UsbStatus =
  | 'unsupported'        // File System Access API not available in this browser
  | 'disconnected'       // No remembered handle, or user has disconnected
  | 'permission-required' // Handle stored but permission needs to be re-granted
  | 'connecting'         // Picker open or verifying stored handle
  | 'connected'          // Handle verified readable this session
  | 'unavailable'        // Handle stored but USB drive is physically absent
  | 'error';             // Unexpected error

// ── State + reducer ───────────────────────────────────────────────────────────

interface UsbState {
  status: UsbStatus;
  handle: FileSystemDirectoryHandle | null;
  volumeName: string | null;
  connectedAt: string | null;
  error: string | null;
  structureWarning: string | null;
}

type UsbAction =
  | { type: 'SET_UNSUPPORTED' }
  | { type: 'SET_DISCONNECTED' }
  | { type: 'SET_CONNECTING' }
  | {
      type: 'SET_PERMISSION_REQUIRED';
      handle: FileSystemDirectoryHandle;
      metadata: UsbConnectionMetadata;
    }
  | {
      type: 'SET_CONNECTED';
      handle: FileSystemDirectoryHandle;
      metadata: UsbConnectionMetadata;
      structureWarning: string | null;
    }
  | {
      type: 'SET_UNAVAILABLE';
      handle: FileSystemDirectoryHandle;
      metadata: UsbConnectionMetadata;
    }
  | { type: 'SET_ERROR'; error: string };

const initial: UsbState = {
  status: 'disconnected',
  handle: null,
  volumeName: null,
  connectedAt: null,
  error: null,
  structureWarning: null,
};

function reducer(state: UsbState, action: UsbAction): UsbState {
  switch (action.type) {
    case 'SET_UNSUPPORTED':
      return { ...initial, status: 'unsupported' };
    case 'SET_DISCONNECTED':
      return { ...initial, status: 'disconnected' };
    case 'SET_CONNECTING':
      return { ...state, status: 'connecting', error: null };
    case 'SET_PERMISSION_REQUIRED':
      return {
        ...state,
        status: 'permission-required',
        handle: action.handle,
        volumeName: action.metadata.volumeName,
        connectedAt: action.metadata.connectedAt,
        error: null,
        structureWarning: null,
      };
    case 'SET_CONNECTED':
      return {
        ...state,
        status: 'connected',
        handle: action.handle,
        volumeName: action.metadata.volumeName,
        connectedAt: action.metadata.connectedAt,
        error: null,
        structureWarning: action.structureWarning,
      };
    case 'SET_UNAVAILABLE':
      return {
        ...state,
        status: 'unavailable',
        handle: action.handle,
        volumeName: action.metadata.volumeName,
        connectedAt: action.metadata.connectedAt,
        error: null,
        structureWarning: null,
      };
    case 'SET_ERROR':
      return { ...state, status: 'error', error: action.error };
    default:
      return state;
  }
}

// ── Context value ─────────────────────────────────────────────────────────────

export interface UsbConnectionContextValue extends UsbState {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  reconnect(): Promise<void>;
  ensurePermission(): Promise<PermissionState>;
  resolveTrackFile(segments: string[]): Promise<UsbFileResult>;
}

const UsbConnectionContext = createContext<UsbConnectionContextValue | null>(null);

// ── Stable restore helper (uses dispatch, no component state) ─────────────────

async function restoreFromStore(
  dispatch: React.Dispatch<UsbAction>,
): Promise<void> {
  try {
    const stored = await getStoredUsbHandle();
    if (!stored) {
      dispatch({ type: 'SET_DISCONNECTED' });
      return;
    }
    await applyPermissionCheck(stored.handle, stored.metadata, dispatch);
  } catch {
    dispatch({ type: 'SET_DISCONNECTED' });
  }
}

async function applyPermissionCheck(
  handle: FileSystemDirectoryHandle,
  metadata: UsbConnectionMetadata,
  dispatch: React.Dispatch<UsbAction>,
): Promise<void> {
  try {
    const perm = await queryPermission(handle);
    if (perm === 'granted') {
      const { found, missing } = await checkRekordboxStructure(handle);
      let structureWarning: string | null = null;
      if (found.length === 0) {
        structureWarning = 'No Rekordbox folders found. Verify this is the USB root.';
      } else if (missing.length > 0) {
        structureWarning = `Could not find: ${missing.join(', ')}. Verify this is the USB root.`;
      }
      dispatch({ type: 'SET_CONNECTED', handle, metadata, structureWarning });
    } else if (perm === 'denied') {
      dispatch({ type: 'SET_UNAVAILABLE', handle, metadata });
    } else {
      // 'prompt' — permission needs to be re-granted by the user
      dispatch({ type: 'SET_PERMISSION_REQUIRED', handle, metadata });
    }
  } catch {
    // Handle.queryPermission threw — USB physically absent or I/O error
    dispatch({ type: 'SET_UNAVAILABLE', handle, metadata });
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function UsbConnectionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);

  // Stable ref so callbacks never go stale
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const stateRef = useRef<UsbState>(state);
  useEffect(() => {
    handleRef.current = state.handle;
    stateRef.current = state;
  }, [state]);

  // Feature detect + restore on mount
  useEffect(() => {
    if (!isFileSystemAccessSupported()) {
      dispatch({ type: 'SET_UNSUPPORTED' });
      return;
    }
    dispatch({ type: 'SET_CONNECTING' });
    void restoreFromStore(dispatch);
  }, []);

  // Silently recheck permission when window regains focus
  useEffect(() => {
    const onFocus = () => {
      const h = handleRef.current;
      const s = stateRef.current;
      if (!h || s.status === 'connecting' || s.status === 'unsupported') return;
      const meta: UsbConnectionMetadata = {
        volumeName: s.volumeName ?? h.name,
        connectedAt: s.connectedAt ?? new Date().toISOString(),
      };
      void applyPermissionCheck(h, meta, dispatch);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const connect = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      dispatch({ type: 'SET_UNSUPPORTED' });
      return;
    }
    dispatch({ type: 'SET_CONNECTING' });
    try {
      const handle = await showDirectoryPicker({ id: 'dropdex-rekordbox-usb', mode: 'read' });
      const metadata: UsbConnectionMetadata = {
        volumeName: handle.name,
        connectedAt: new Date().toISOString(),
      };
      await saveUsbHandle(handle, metadata);
      await applyPermissionCheck(handle, metadata, dispatch);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled picker — restore previous state from IDB
        void restoreFromStore(dispatch);
      } else {
        dispatch({ type: 'SET_ERROR', error: String(err) });
      }
    }
  }, []);

  const disconnect = useCallback(async () => {
    await removeUsbHandle();
    dispatch({ type: 'SET_DISCONNECTED' });
  }, []);

  const reconnect = useCallback(async () => {
    dispatch({ type: 'SET_CONNECTING' });
    await restoreFromStore(dispatch);
  }, []);

  const ensurePermission = useCallback(async (): Promise<PermissionState> => {
    const handle = handleRef.current;
    const s = stateRef.current;
    if (!handle) return 'denied';
    try {
      const perm = await ensureReadPermission(handle);
      const meta: UsbConnectionMetadata = {
        volumeName: s.volumeName ?? handle.name,
        connectedAt: s.connectedAt ?? new Date().toISOString(),
      };
      if (perm === 'granted') {
        const { found, missing } = await checkRekordboxStructure(handle);
        let structureWarning: string | null = null;
        if (found.length === 0) {
          structureWarning = 'No Rekordbox folders found. Verify this is the USB root.';
        } else if (missing.length > 0) {
          structureWarning = `Could not find: ${missing.join(', ')}. Verify this is the USB root.`;
        }
        dispatch({ type: 'SET_CONNECTED', handle, metadata: meta, structureWarning });
      } else {
        dispatch({ type: 'SET_UNAVAILABLE', handle, metadata: meta });
      }
      return perm;
    } catch {
      return 'denied';
    }
  }, []);

  const resolveTrackFile = useCallback(async (segments: string[]): Promise<UsbFileResult> => {
    const handle = handleRef.current;
    if (!handle) {
      return {
        ok: false,
        error: { kind: 'permission_denied', message: 'No USB drive is connected.' },
      };
    }
    return resolveUsbFile(handle, segments);
  }, []);

  const value: UsbConnectionContextValue = {
    ...state,
    connect,
    disconnect,
    reconnect,
    ensurePermission,
    resolveTrackFile,
  };

  return (
    <UsbConnectionContext.Provider value={value}>
      {children}
    </UsbConnectionContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useUsbConnection(): UsbConnectionContextValue {
  const ctx = useContext(UsbConnectionContext);
  if (!ctx) throw new Error('useUsbConnection must be used within UsbConnectionProvider');
  return ctx;
}
