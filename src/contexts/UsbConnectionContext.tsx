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
  ensureReadPermission,
  queryPermission,
} from '../lib/usb/usbPermissions';
import {
  resolveUsbFile,
  checkRekordboxStructure,
  type UsbFileResult,
  type ResolveUsbFileOptions,
} from '../lib/usb/resolveUsbFile';

// ── Status ────────────────────────────────────────────────────────────────────

export type UsbStatus =
  | 'unsupported'         // File System Access API not available in this browser
  | 'disconnected'        // No remembered handle, or user has disconnected
  | 'permission-required' // Handle stored but permission needs to be re-granted
  | 'connecting'          // Picker open or verifying stored handle
  | 'connected'           // Handle verified readable this session
  | 'wrong_root'          // Accessible but no Rekordbox folders — wrong directory selected
  | 'unavailable'         // Handle stored but USB drive is physically absent
  | 'error';              // Unexpected error

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
      type: 'SET_WRONG_ROOT';
      handle: FileSystemDirectoryHandle;
      metadata: UsbConnectionMetadata;
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
    case 'SET_WRONG_ROOT':
      return {
        ...state,
        status: 'wrong_root',
        handle: action.handle,
        volumeName: action.metadata.volumeName,
        connectedAt: action.metadata.connectedAt,
        error: null,
        structureWarning: 'No Rekordbox folders found. Select the USB root folder, not PIONEER or a subfolder.',
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
  /** Open the directory picker and remember the chosen handle. */
  connect(): Promise<void>;
  /** Close the connection and forget the stored handle. */
  disconnect(): Promise<void>;
  /** Re-verify the stored handle (no picker). Use when drive was reinserted. */
  reconnect(): Promise<void>;
  /**
   * Always open the directory picker, replacing the stored handle.
   * Use when the user selected the wrong directory or wants a different drive.
   */
  selectNewUsb(): Promise<void>;
  /** Re-authorize and verify the stored handle; only 'connected' is playable. */
  ensurePermission(): Promise<UsbStatus>;
  resolveTrackFile(segments: string[], options?: ResolveUsbFileOptions): Promise<UsbFileResult>;
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
      const rootCheck = await checkRekordboxStructure(handle);
      switch (rootCheck.status) {
        case 'available': {
          const structureWarning =
            rootCheck.missingFolders.length > 0
              ? `Could not find: ${rootCheck.missingFolders.join(', ')}. Verify this is the USB root.`
              : null;
          dispatch({ type: 'SET_CONNECTED', handle, metadata, structureWarning });
          break;
        }
        case 'wrong_root':
          dispatch({ type: 'SET_WRONG_ROOT', handle, metadata });
          break;
        case 'permission_required':
          dispatch({ type: 'SET_PERMISSION_REQUIRED', handle, metadata });
          break;
        case 'unavailable':
          dispatch({ type: 'SET_UNAVAILABLE', handle, metadata });
          break;
      }
    } else if (perm === 'denied') {
      // Browser-level denial — not easily recoverable without user re-granting.
      dispatch({ type: 'SET_PERMISSION_REQUIRED', handle, metadata });
    } else {
      // 'prompt' — permission needs to be re-granted by the user.
      dispatch({ type: 'SET_PERMISSION_REQUIRED', handle, metadata });
    }
  } catch {
    // queryPermission itself threw — USB physically absent or I/O error.
    dispatch({ type: 'SET_UNAVAILABLE', handle, metadata });
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function UsbConnectionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);

  // Stable ref so callbacks never go stale
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const playableRef = useRef(false);
  const stateRef = useRef<UsbState>(state);
  useEffect(() => {
    handleRef.current = state.handle;
    playableRef.current = state.status === 'connected';
    stateRef.current = state;
  }, [state]);

  // Keep imperative consumers in sync in the same tick as a transition. This
  // avoids a connected render racing the passive effect that updates refs.
  const dispatchState = useCallback((action: UsbAction) => {
    const next = reducer(stateRef.current, action);
    stateRef.current = next;
    handleRef.current = next.handle;
    playableRef.current = next.status === 'connected';
    dispatch(action);
  }, []);

  // Restore on mount — skip upfront feature-detect so browsers that mask
  // showDirectoryPicker (e.g. Brave with strict fingerprinting) still get a
  // chance to connect. Unsupported is only set if the actual API call fails.
  useEffect(() => {
    dispatchState({ type: 'SET_CONNECTING' });
    void restoreFromStore(dispatchState);
  }, [dispatchState]);

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
      void applyPermissionCheck(h, meta, dispatchState);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [dispatchState]);

  const connect = useCallback(async () => {
    dispatchState({ type: 'SET_CONNECTING' });
    try {
      const handle = await showDirectoryPicker({ id: 'dropdex-rekordbox-usb', mode: 'read' });
      const metadata: UsbConnectionMetadata = {
        volumeName: handle.name,
        connectedAt: new Date().toISOString(),
      };
      await saveUsbHandle(handle, metadata);
      await applyPermissionCheck(handle, metadata, dispatchState);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled picker — restore previous state from IDB
        void restoreFromStore(dispatchState);
      } else if (err instanceof ReferenceError || (err instanceof TypeError && !('showDirectoryPicker' in window))) {
        // API not defined at all (non-secure HTTP context, Firefox, Safari, strict shields)
        dispatchState({ type: 'SET_UNSUPPORTED' });
      } else {
        dispatchState({ type: 'SET_ERROR', error: String(err) });
      }
    }
  }, [dispatchState]);

  const disconnect = useCallback(async () => {
    await removeUsbHandle();
    dispatchState({ type: 'SET_DISCONNECTED' });
  }, [dispatchState]);

  const reconnect = useCallback(async () => {
    dispatchState({ type: 'SET_CONNECTING' });
    await restoreFromStore(dispatchState);
  }, [dispatchState]);

  const selectNewUsb = useCallback(async () => {
    // Identical to connect() — always opens picker, replaces stored handle.
    dispatchState({ type: 'SET_CONNECTING' });
    try {
      const handle = await showDirectoryPicker({ id: 'dropdex-rekordbox-usb', mode: 'read' });
      const metadata: UsbConnectionMetadata = {
        volumeName: handle.name,
        connectedAt: new Date().toISOString(),
      };
      await saveUsbHandle(handle, metadata);
      await applyPermissionCheck(handle, metadata, dispatchState);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        void restoreFromStore(dispatchState);
      } else if (err instanceof TypeError && !('showDirectoryPicker' in window)) {
        dispatchState({ type: 'SET_UNSUPPORTED' });
      } else {
        dispatchState({ type: 'SET_ERROR', error: String(err) });
      }
    }
  }, [dispatchState]);

  const ensurePermission = useCallback(async (): Promise<UsbStatus> => {
    const handle = handleRef.current;
    const s = stateRef.current;
    if (!handle) return 'disconnected';
    const meta: UsbConnectionMetadata = {
      volumeName: s.volumeName ?? handle.name,
      connectedAt: s.connectedAt ?? new Date().toISOString(),
    };

    try {
      const perm = await ensureReadPermission(handle);
      if (perm !== 'granted') {
        dispatchState({ type: 'SET_PERMISSION_REQUIRED', handle, metadata: meta });
        return 'permission-required';
      }

      const rootCheck = await checkRekordboxStructure(handle);
      switch (rootCheck.status) {
        case 'available': {
          const structureWarning =
            rootCheck.missingFolders.length > 0
              ? `Could not find: ${rootCheck.missingFolders.join(', ')}. Verify this is the USB root.`
              : null;
          dispatchState({ type: 'SET_CONNECTED', handle, metadata: meta, structureWarning });
          return 'connected';
        }
        case 'wrong_root':
          dispatchState({ type: 'SET_WRONG_ROOT', handle, metadata: meta });
          return 'wrong_root';
        case 'permission_required':
          dispatchState({ type: 'SET_PERMISSION_REQUIRED', handle, metadata: meta });
          return 'permission-required';
        case 'unavailable':
          dispatchState({ type: 'SET_UNAVAILABLE', handle, metadata: meta });
          return 'unavailable';
      }
    } catch {
      playableRef.current = false;
      dispatchState({ type: 'SET_UNAVAILABLE', handle, metadata: meta });
      return 'unavailable';
    }
  }, [dispatchState]);

  const resolveTrackFile = useCallback(async (
    segments: string[],
    options: ResolveUsbFileOptions = {},
  ): Promise<UsbFileResult> => {
    const handle = handleRef.current;
    if (!handle) {
      return {
        ok: false,
        error: { kind: 'permission_denied', message: 'No USB drive is connected.' },
      };
    }
    if (!playableRef.current) {
      return {
        ok: false,
        error: { kind: 'permission_denied', message: `USB is not ready (${stateRef.current.status}).` },
      };
    }
    return resolveUsbFile(handle, segments, options);
  }, []);

  const value: UsbConnectionContextValue = {
    ...state,
    connect,
    disconnect,
    reconnect,
    selectNewUsb,
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
