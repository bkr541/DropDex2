import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
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
  type UsbFileResult,
  type UsbFileResolutionError,
} from '../lib/usb/resolveUsbFile';
import type { DropDexDesktopBridge, DesktopUsbActivityState, DesktopUsbReleaseResult, DesktopUsbState } from '../types/dropdex-desktop';
import { stopUsbBackedPlayback } from '../lib/usb/usbPlaybackCoordinator';

export type UsbStatus =
  | 'unsupported'
  | 'disconnected'
  | 'permission-required'
  | 'connecting'
  | 'connected'
  | 'released'
  | 'wrong_root'
  | 'unavailable'
  | 'error';

export type UsbRuntime = 'electron' | 'browser';

export interface UsbRootSelectionResult {
  cancelled: boolean;
  volumeName: string | null;
  error?: string;
}

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
  | { type: 'SET_BROWSER_RELEASED'; volumeName: string | null; connectedAt: string | null }
  | { type: 'SET_CONNECTING' }
  | { type: 'SET_DESKTOP_STATE'; state: DesktopUsbState; activity?: DesktopUsbActivityState }
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

function desktopStateToUsbState(
  state: DesktopUsbState,
  activity?: DesktopUsbActivityState,
): UsbState {
  switch (state.status) {
    case 'released':
      return {
        ...initial,
        status: 'released',
        volumeName: state.volumeName,
        connectedAt: state.connectedAt,
        structureWarning: state.structureWarning,
        error: state.error,
      };
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
    case 'SET_BROWSER_RELEASED':
      return {
        ...initial,
        status: 'released',
        volumeName: action.volumeName,
        connectedAt: action.connectedAt,
      };
    case 'SET_CONNECTING':
      return { ...state, status: 'connecting', error: null };
    case 'SET_DESKTOP_STATE':
      return desktopStateToUsbState(action.state, action.activity);
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
  activity: DesktopUsbActivityState | null;
  connect(): Promise<void>;
  selectUsbRoot(): Promise<UsbRootSelectionResult>;
  release(): Promise<DesktopUsbReleaseResult | null>;
  disconnect(): Promise<void>;
  reconnect(): Promise<void>;
  selectNewUsb(): Promise<void>;
  ensurePermission(): Promise<UsbStatus>;
  resolveTrackSource(segments: string[], options?: ResolveUsbFileOptions): Promise<UsbTrackSourceResult>;
  resolveImportFile(segments: string[], options?: ResolveUsbFileOptions): Promise<UsbFileResult>;
}

const UsbConnectionContext = createContext<UsbConnectionContextValue | null>(null);

export async function resolveDesktopImportFile(
  desktop: Pick<DropDexDesktopBridge, 'resolveTrackSource'>,
  segments: string[],
  options: ResolveUsbFileOptions = {},
  fetchFile: typeof fetch = fetch,
): Promise<UsbFileResult> {
  if (options.isCancelled?.()) {
    return { ok: false, error: { kind: 'abort', message: 'USB file access was cancelled.' } };
  }

  const result = await desktop.resolveTrackSource(segments);
  if (!result.ok) return result;
  if (options.isCancelled?.()) {
    return { ok: false, error: { kind: 'abort', message: 'USB file access was cancelled.' } };
  }

  try {
    const response = await fetchFile(result.source.url, { cache: 'no-store' });
    if (!response.ok) {
      return {
        ok: false,
        error: {
          kind: 'unexpected',
          message: `USB file read failed with HTTP ${response.status}.`,
        },
      };
    }
    const blob = await response.blob();
    if (options.isCancelled?.()) {
      return { ok: false, error: { kind: 'abort', message: 'USB file access was cancelled.' } };
    }
    const fileName = segments.at(-1) || 'usb-file';
    return {
      ok: true,
      file: new File([blob], fileName, {
        type: blob.type || 'application/octet-stream',
        lastModified: Date.now(),
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'unexpected',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

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
  const [activity, setActivity] = useState<DesktopUsbActivityState | null>(null);

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
      const [next, nextActivity] = await Promise.all([
        desktop.getUsbState(),
        desktop.getUsbActivityState(),
      ]);
      setActivity(nextActivity);
      dispatchState({ type: 'SET_DESKTOP_STATE', state: next, activity: nextActivity });
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

  useEffect(() => {
    if (runtime !== 'electron') return;
    const id = setInterval(() => void refreshDesktopState(), 5000);
    return () => clearInterval(id);
  }, [refreshDesktopState, runtime]);

  const selectUsbRoot = useCallback(async (): Promise<UsbRootSelectionResult> => {
    dispatchState({ type: 'SET_CONNECTING' });
    try {
      if (runtime === 'electron' && desktop) {
        const result = await desktop.selectUsbRoot();
        if (result.cancelled) {
          const nextActivity = await desktop.getUsbActivityState();
          setActivity(nextActivity);
          dispatchState({ type: 'SET_DESKTOP_STATE', state: result.state, activity: nextActivity });
          return { cancelled: true, volumeName: result.state.volumeName };
        }
        if (result.error) {
          dispatchState({ type: 'SET_ERROR', error: result.error });
          return { cancelled: false, volumeName: result.state.volumeName, error: result.error };
        }
        const nextActivity = await desktop.getUsbActivityState();
        setActivity(nextActivity);
        dispatchState({ type: 'SET_DESKTOP_STATE', state: result.state, activity: nextActivity });
        return { cancelled: false, volumeName: result.state.volumeName };
      }
      const picker = getBrowserDirectoryPicker();
      if (!picker) {
        dispatchState({ type: 'SET_UNSUPPORTED' });
        return {
          cancelled: false,
          volumeName: null,
          error: 'USB folder access is not supported in this browser.',
        };
      }
      const handle = await picker({ id: 'dropdex-rekordbox-usb', mode: 'read' });
      const metadata: UsbConnectionMetadata = {
        volumeName: handle.name,
        connectedAt: new Date().toISOString(),
      };
      await saveUsbHandle(handle, metadata);
      await applyPermissionCheck(handle, metadata, dispatchState);
      return { cancelled: false, volumeName: handle.name };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        void restoreFromStore(dispatchState);
        return { cancelled: true, volumeName: stateRef.current.volumeName };
      } else {
        const message = error instanceof Error ? error.message : String(error);
        dispatchState({ type: 'SET_ERROR', error: message });
        return { cancelled: false, volumeName: stateRef.current.volumeName, error: message };
      }
    }
  }, [desktop, dispatchState, runtime]);

  const connect = useCallback(async () => {
    await selectUsbRoot();
  }, [selectUsbRoot]);

  const release = useCallback(async (): Promise<DesktopUsbReleaseResult | null> => {
    const playbackErrors = await stopUsbBackedPlayback();
    if (playbackErrors.length > 0) {
      console.warn('One or more USB playback cleanup handlers failed.', playbackErrors);
    }
    if (runtime !== 'electron' || !desktop) {
      const current = stateRef.current;
      await removeUsbHandle();
      setActivity(null);
      dispatchState({
        type: 'SET_BROWSER_RELEASED',
        volumeName: current.volumeName,
        connectedAt: current.connectedAt,
      });
      return null;
    }
    const result = await desktop.releaseUsb();
    setActivity(result.activity);
    dispatchState({ type: 'SET_DESKTOP_STATE', state: result.state, activity: result.activity });
    return result;
  }, [desktop, dispatchState, runtime]);

  const disconnect = useCallback(async () => {
    const playbackErrors = await stopUsbBackedPlayback();
    if (playbackErrors.length > 0) {
      console.warn('One or more USB playback cleanup handlers failed.', playbackErrors);
    }
    if (runtime === 'electron' && desktop) {
      const result = await desktop.disconnectUsb();
      setActivity(result.activity);
      dispatchState({ type: 'SET_DESKTOP_STATE', state: result.state, activity: result.activity });
      return;
    }
    await removeUsbHandle();
    setActivity(null);
    dispatchState({ type: 'SET_DISCONNECTED' });
  }, [desktop, dispatchState, runtime]);

  const reconnect = useCallback(async () => {
    dispatchState({ type: 'SET_CONNECTING' });
    if (runtime === 'electron') {
      const refreshedStatus = await refreshDesktopState();
      if (refreshedStatus !== 'connected') {
        await connect();
      }
      return;
    }
    await restoreFromStore(dispatchState);
  }, [connect, dispatchState, refreshDesktopState, runtime]);

  const selectNewUsb = useCallback(async () => {
    await selectUsbRoot();
  }, [selectUsbRoot]);

  const ensurePermission = useCallback(async (): Promise<UsbStatus> => {
    if (runtime === 'electron') return refreshDesktopState();
    if (stateRef.current.status === 'released') return 'released';

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

  const resolveImportFile = useCallback(async (
    segments: string[],
    options: ResolveUsbFileOptions = {},
  ): Promise<UsbFileResult> => {
    if (options.isCancelled?.()) {
      return { ok: false, error: { kind: 'abort', message: 'USB file access was cancelled.' } };
    }

    if (runtime === 'electron' && desktop) {
      return resolveDesktopImportFile(desktop, segments, options);
    }

    const handle = handleRef.current;
    if (!handle) {
      return { ok: false, error: { kind: 'permission_denied', message: 'No USB drive is connected.' } };
    }
    return resolveUsbFile(handle, segments, options);
  }, [desktop, runtime]);

  const value: UsbConnectionContextValue = {
    ...state,
    runtime,
    activity,
    connect,
    selectUsbRoot,
    release,
    disconnect,
    reconnect,
    selectNewUsb,
    ensurePermission,
    resolveTrackSource,
    resolveImportFile,
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
