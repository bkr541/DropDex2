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
  type ResolveUsbFileOptions,
  type UsbFileResolutionError,
} from '../lib/usb/resolveUsbFile';
import type { DesktopUsbState } from '../types/dropdex-desktop';

export type UsbStatus =
  | 'unsupported'
  | 'disconnected'
  | 'permission-required'
  | 'connecting'
  | 'connected'
  | 'wrong_root'
  | 'unavailable'
  | 'error';

export type UsbRuntime = 'electron' | 'browser';

export type UsbTrackSource =
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string; size?: number };

export type UsbTrackSourceResult =
  | { ok: true; source: UsbTrackSource }
  | { ok: false; error: UsbFileResolutionError };

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
  | { type: 'SET_DESKTOP_STATE'; state: DesktopUsbState }
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

function desktopStateToUsbState(state: DesktopUsbState): UsbState {
  switch (state.status) {
    case 'connected':
      return {
        ...initial,
        status: 'connected',
        volumeName: state.volumeName,
        connectedAt: state.connectedAt,
        structureWarning: state.structureWarning,
      };
    case 'wrong_root':
      return {
        ...initial,
        status: 'wrong_root',
        volumeName: state.volumeName,
        connectedAt: state.connectedAt,
        structureWarning: state.structureWarning,
      };
    case 'unavailable':
      return {
        ...initial,
        status: 'unavailable',
        volumeName: state.volumeName,
        connectedAt: state.connectedAt,
        error: state.error,
      };
    case 'error':
      return { ...initial, status: 'error', error: state.error ?? 'Desktop USB access failed.' };
    case 'disconnected':
      return initial;
  }
}

function reducer(state: UsbState, action: UsbAction): UsbState {
  switch (action.type) {
    case 'SET_UNSUPPORTED':
      return { ...initial, status: 'unsupported' };
    case 'SET_DISCONNECTED':
      return initial;
    case 'SET_CONNECTING':
      return { ...state, status: 'connecting', error: null };
    case 'SET_DESKTOP_STATE':
      return desktopStateToUsbState(action.state);
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

export interface UsbConnectionContextValue extends UsbState {
  runtime: UsbRuntime;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  reconnect(): Promise<void>;
  selectNewUsb(): Promise<void>;
  ensurePermission(): Promise<UsbStatus>;
  resolveTrackSource(segments: string[], options?: ResolveUsbFileOptions): Promise<UsbTrackSourceResult>;
}

const UsbConnectionContext = createContext<UsbConnectionContextValue | null>(null);

function getBrowserDirectoryPicker(): typeof window.showDirectoryPicker | null {
  if (typeof window === 'undefined') return null;
  const picker = window.showDirectoryPicker;
  return typeof picker === 'function' ? picker.bind(window) : null;
}

async function restoreFromStore(dispatch: React.Dispatch<UsbAction>): Promise<void> {
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
          const structureWarning = rootCheck.missingFolders.length > 0
            ? 'Could not find a media folder (Contents or Music). Track playback may be unavailable.'
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
    } else {
      dispatch({ type: 'SET_PERMISSION_REQUIRED', handle, metadata });
    }
  } catch {
    dispatch({ type: 'SET_UNAVAILABLE', handle, metadata });
  }
}

export function UsbConnectionProvider({ children }: { children: ReactNode }) {
  const runtime: UsbRuntime = window.dropdexDesktop?.isElectron ? 'electron' : 'browser';
  const desktop = window.dropdexDesktop;
  const [state, dispatch] = useReducer(reducer, initial);

  const handleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const playableRef = useRef(false);
  const stateRef = useRef<UsbState>(state);
  useEffect(() => {
    handleRef.current = state.handle;
    playableRef.current = state.status === 'connected';
    stateRef.current = state;
  }, [state]);

  const dispatchState = useCallback((action: UsbAction) => {
    const next = reducer(stateRef.current, action);
    stateRef.current = next;
    handleRef.current = next.handle;
    playableRef.current = next.status === 'connected';
    dispatch(action);
  }, []);

  const refreshDesktopState = useCallback(async (): Promise<UsbStatus> => {
    if (!desktop) return 'unsupported';
    try {
      const next = await desktop.getUsbState();
      dispatchState({ type: 'SET_DESKTOP_STATE', state: next });
      return next.status;
    } catch (error) {
      dispatchState({ type: 'SET_ERROR', error: error instanceof Error ? error.message : String(error) });
      return 'error';
    }
  }, [desktop, dispatchState]);

  useEffect(() => {
    dispatchState({ type: 'SET_CONNECTING' });
    if (runtime === 'electron') {
      void refreshDesktopState();
      return;
    }
    void restoreFromStore(dispatchState);
  }, [dispatchState, refreshDesktopState, runtime]);

  useEffect(() => {
    const onFocus = () => {
      if (runtime === 'electron') {
        void refreshDesktopState();
        return;
      }
      const handle = handleRef.current;
      const current = stateRef.current;
      if (!handle || current.status === 'connecting' || current.status === 'unsupported') return;
      const metadata: UsbConnectionMetadata = {
        volumeName: current.volumeName ?? handle.name,
        connectedAt: current.connectedAt ?? new Date().toISOString(),
      };
      void applyPermissionCheck(handle, metadata, dispatchState);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [dispatchState, refreshDesktopState, runtime]);

  const chooseBrowserUsb = useCallback(async () => {
    const picker = getBrowserDirectoryPicker();
    if (!picker) {
      dispatchState({ type: 'SET_UNSUPPORTED' });
      return;
    }
    const handle = await picker({ id: 'dropdex-rekordbox-usb', mode: 'read' });
    const metadata: UsbConnectionMetadata = {
      volumeName: handle.name,
      connectedAt: new Date().toISOString(),
    };
    await saveUsbHandle(handle, metadata);
    await applyPermissionCheck(handle, metadata, dispatchState);
  }, [dispatchState]);

  const connect = useCallback(async () => {
    dispatchState({ type: 'SET_CONNECTING' });
    try {
      if (runtime === 'electron' && desktop) {
        const result = await desktop.selectUsbRoot();
        dispatchState({ type: 'SET_DESKTOP_STATE', state: result.state });
        return;
      }
      await chooseBrowserUsb();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        void restoreFromStore(dispatchState);
      } else {
        dispatchState({ type: 'SET_ERROR', error: error instanceof Error ? error.message : String(error) });
      }
    }
  }, [chooseBrowserUsb, desktop, dispatchState, runtime]);

  const disconnect = useCallback(async () => {
    if (runtime === 'electron' && desktop) {
      const next = await desktop.disconnectUsb();
      dispatchState({ type: 'SET_DESKTOP_STATE', state: next });
      return;
    }
    await removeUsbHandle();
    dispatchState({ type: 'SET_DISCONNECTED' });
  }, [desktop, dispatchState, runtime]);

  const reconnect = useCallback(async () => {
    dispatchState({ type: 'SET_CONNECTING' });
    if (runtime === 'electron') {
      await refreshDesktopState();
      return;
    }
    await restoreFromStore(dispatchState);
  }, [dispatchState, refreshDesktopState, runtime]);

  const selectNewUsb = useCallback(async () => {
    await connect();
  }, [connect]);

  const ensurePermission = useCallback(async (): Promise<UsbStatus> => {
    if (runtime === 'electron') return refreshDesktopState();

    const handle = handleRef.current;
    const current = stateRef.current;
    if (!handle) return 'disconnected';
    const metadata: UsbConnectionMetadata = {
      volumeName: current.volumeName ?? handle.name,
      connectedAt: current.connectedAt ?? new Date().toISOString(),
    };

    try {
      const permission = await ensureReadPermission(handle);
      if (permission !== 'granted') {
        dispatchState({ type: 'SET_PERMISSION_REQUIRED', handle, metadata });
        return 'permission-required';
      }
      const rootCheck = await checkRekordboxStructure(handle);
      switch (rootCheck.status) {
        case 'available': {
          const structureWarning = rootCheck.missingFolders.length > 0
            ? 'Could not find a media folder (Contents or Music). Track playback may be unavailable.'
            : null;
          dispatchState({ type: 'SET_CONNECTED', handle, metadata, structureWarning });
          return 'connected';
        }
        case 'wrong_root':
          dispatchState({ type: 'SET_WRONG_ROOT', handle, metadata });
          return 'wrong_root';
        case 'permission_required':
          dispatchState({ type: 'SET_PERMISSION_REQUIRED', handle, metadata });
          return 'permission-required';
        case 'unavailable':
          dispatchState({ type: 'SET_UNAVAILABLE', handle, metadata });
          return 'unavailable';
      }
    } catch {
      dispatchState({ type: 'SET_UNAVAILABLE', handle, metadata });
      return 'unavailable';
    }
  }, [dispatchState, refreshDesktopState, runtime]);

  const resolveTrackSource = useCallback(async (
    segments: string[],
    options: ResolveUsbFileOptions = {},
  ): Promise<UsbTrackSourceResult> => {
    if (options.isCancelled?.()) {
      return { ok: false, error: { kind: 'abort', message: 'USB file access was superseded by another request.' } };
    }
    if (!playableRef.current) {
      return {
        ok: false,
        error: { kind: 'permission_denied', message: `USB is not ready (${stateRef.current.status}).` },
      };
    }

    if (runtime === 'electron' && desktop) {
      const result = await desktop.resolveTrackSource(segments);
      if (options.isCancelled?.()) {
        return { ok: false, error: { kind: 'abort', message: 'USB file access was superseded by another request.' } };
      }
      return result;
    }

    const handle = handleRef.current;
    if (!handle) {
      return { ok: false, error: { kind: 'permission_denied', message: 'No USB drive is connected.' } };
    }
    const result = await resolveUsbFile(handle, segments, options);
    if (!result.ok) {
      const failure = result as { ok: false; error: UsbFileResolutionError };
      return failure;
    }
    return { ok: true, source: { kind: 'file', file: result.file } };
  }, [desktop, runtime]);

  const value: UsbConnectionContextValue = {
    ...state,
    runtime,
    connect,
    disconnect,
    reconnect,
    selectNewUsb,
    ensurePermission,
    resolveTrackSource,
  };

  return (
    <UsbConnectionContext.Provider value={value}>
      {children}
    </UsbConnectionContext.Provider>
  );
}

export function useUsbConnection(): UsbConnectionContextValue {
  const context = useContext(UsbConnectionContext);
  if (!context) throw new Error('useUsbConnection must be used within UsbConnectionProvider');
  return context;
}
