import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { useUsbConnection } from './UsbConnectionContext';
import { resolveUsbPath } from '../lib/rekordbox/usbPathResolver';
import type { RekordboxTrack } from '../types';
import type { UsbFileResolutionError } from '../lib/usb/resolveUsbFile';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlayerStatus =
  | 'idle'
  | 'resolving'  // path resolution + USB file fetch in progress
  | 'loading'    // HTMLAudioElement loading the object URL
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

interface PlayerState {
  activeTrack: RekordboxTrack | null;
  status: PlayerStatus;
  volume: number;
  muted: boolean;
  error: string | null;
  objectUrl: string | null;
}

type PlayerAction =
  | { type: 'RESOLVING'; track: RekordboxTrack }
  | { type: 'LOADED'; track: RekordboxTrack; objectUrl: string }
  | { type: 'PLAYING' }
  | { type: 'PAUSED' }
  | { type: 'ENDED' }
  | { type: 'STOP' }
  | { type: 'ERROR'; error: string }
  | { type: 'SET_VOLUME'; volume: number }
  | { type: 'SET_MUTED'; muted: boolean }
  | { type: 'CLEAR_ERROR' };

export interface AudioPlayerContextValue extends PlayerState {
  playTrack(track: RekordboxTrack): Promise<void>;
  toggleTrack(track: RekordboxTrack): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  seek(seconds: number): void;
  setVolume(value: number): void;
  toggleMute(): void;
  stop(): void;
  clearError(): void;
  getAudioElement(): HTMLAudioElement | null;
}

// ── Reducer ───────────────────────────────────────────────────────────────────

const initial: PlayerState = {
  activeTrack: null,
  status: 'idle',
  volume: 1,
  muted: false,
  error: null,
  objectUrl: null,
};

function reducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'RESOLVING':
      return { ...state, activeTrack: action.track, status: 'resolving', error: null };
    case 'LOADED':
      return { ...state, activeTrack: action.track, objectUrl: action.objectUrl, status: 'loading', error: null };
    case 'PLAYING':
      return { ...state, status: 'playing' };
    case 'PAUSED':
      return { ...state, status: 'paused' };
    case 'ENDED':
      return { ...state, status: 'ended' };
    case 'STOP':
      return { ...initial, volume: state.volume, muted: state.muted };
    case 'ERROR':
      return { ...state, status: 'error', error: action.error };
    case 'SET_VOLUME':
      return { ...state, volume: action.volume };
    case 'SET_MUTED':
      return { ...state, muted: action.muted };
    case 'CLEAR_ERROR':
      // Full reset — do not leave stale activeTrack/objectUrl with status: idle.
      return { ...initial, volume: state.volume, muted: state.muted };
    default:
      return state;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function safeRevokeUrl(url: string | null | undefined) {
  if (url) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
}

function resetAudioElement(audio: HTMLAudioElement, oldUrl: string | null) {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  safeRevokeUrl(oldUrl);
}

function safeResetAudio(audio: HTMLAudioElement | null, oldUrl: string | null) {
  if (audio) {
    resetAudioElement(audio, oldUrl);
  } else {
    safeRevokeUrl(oldUrl);
  }
}

export function usbFileErrorMessage(error: UsbFileResolutionError): string {
  switch (error.kind) {
    case 'not_found':
      return `File not found on USB: ${error.path}`;
    case 'permission_denied':
      return 'USB access permission denied. Click "Re-authorize USB" in the sidebar.';
    case 'security':
      return 'Browser security policy blocked file access.';
    case 'type_mismatch':
      return `Expected a file at "${error.segment}" but found a directory.`;
    case 'abort':
      return 'File access was cancelled.';
    default:
      return `Could not open audio file: ${'message' in error ? error.message : String(error)}`;
  }
}

// MediaError codes per HTML spec (stable numeric constants — MediaError global absent in Node)
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

export function audioMediaErrorMessage(err: MediaError | null): string {
  if (!err) return 'Playback error.';
  switch (err.code) {
    case MEDIA_ERR_SRC_NOT_SUPPORTED:
      return `Unsupported audio format. Convert to MP3 or AAC in Rekordbox.`;
    case MEDIA_ERR_NETWORK:
      return 'Network error during playback.';
    case MEDIA_ERR_DECODE:
      return 'Audio decode error. The file may be corrupted or DRM-protected.';
    default:
      return `Playback error (code ${err.code}).`;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const usbCtx = useUsbConnection();

  // Stable refs so callbacks are not recreated on every render
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const usbRef = useRef(usbCtx);
  useEffect(() => { usbRef.current = usbCtx; }, [usbCtx]);

  // Single shared HTMLAudioElement, created once
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Monotonically increasing generation counter for race-safe async playback.
  // Each new playTrack() call increments this. Any earlier in-flight call
  // checks the counter after every await and aborts if it no longer matches.
  const playRequestIdRef = useRef(0);

  useEffect(() => {
    if (typeof Audio === 'undefined') return;
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;

    const onPlay = () => dispatch({ type: 'PLAYING' });
    const onPause = () => { if (!audio.ended) dispatch({ type: 'PAUSED' }); };
    const onEnded = () => dispatch({ type: 'ENDED' });
    const onError = () => {
      const prevUrl = stateRef.current.objectUrl;
      safeRevokeUrl(prevUrl);
      dispatch({ type: 'ERROR', error: audioMediaErrorMessage(audio.error) });
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      safeRevokeUrl(stateRef.current.objectUrl);
      audioRef.current = null;
      // Invalidate any pending playTrack calls so they bail after unmount.
      playRequestIdRef.current = Number.MAX_SAFE_INTEGER;
    };
  }, []);

  // Track pending when user clicked play while USB was disconnected
  const pendingPlayRef = useRef<RekordboxTrack | null>(null);

  // React to USB status changes: auto-play on connect, stop + cleanup on disconnect
  useEffect(() => {
    const { status: usbStatus } = usbCtx;

    if (usbStatus === 'connected') {
      const pending = pendingPlayRef.current;
      if (pending) {
        pendingPlayRef.current = null;
        void playTrack(pending);
      }
      return;
    }

    // Still transitioning — don't act yet
    if (usbStatus === 'connecting') return;

    // Picker was cancelled or failed — clear any pending play
    const hasPending = !!pendingPlayRef.current;
    pendingPlayRef.current = null;
    if (hasPending && stateRef.current.status === 'resolving') {
      if (usbStatus === 'unsupported') {
        dispatch({ type: 'ERROR', error: 'File System Access API is not available. Open the app over HTTPS or localhost in Chrome/Edge.' });
      } else {
        dispatch({ type: 'STOP' });
      }
      return;
    }

    if (usbStatus !== 'disconnected' && usbStatus !== 'unavailable') return;
    const s = stateRef.current;
    if (s.status === 'idle' || s.status === 'error') return;
    // Invalidate any in-flight playTrack so it doesn't proceed after disconnect.
    playRequestIdRef.current++;
    safeResetAudio(audioRef.current, s.objectUrl);
    dispatch({ type: 'STOP' });
  }, [usbCtx.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ──────────────────────────────────────────────────────────────────

  const playTrack = useCallback(async (track: RekordboxTrack): Promise<void> => {
    const audio = audioRef.current;
    const usb = usbRef.current;

    if (!track.file_path) {
      dispatch({ type: 'ERROR', error: 'This track has no file path. Re-import with a USB connected.' });
      return;
    }

    if (usb.status === 'unsupported') {
      dispatch({ type: 'ERROR', error: 'File System Access API is not supported in this browser.' });
      return;
    }
    if (usb.status === 'disconnected') {
      // Save the track and open the picker — auto-plays once USB connects
      pendingPlayRef.current = track;
      dispatch({ type: 'RESOLVING', track });
      void usb.connect();
      return;
    }
    if (usb.status === 'unavailable' || usb.status === 'error') {
      dispatch({ type: 'ERROR', error: 'USB is unavailable. Reconnect the drive and try again.' });
      return;
    }

    // Assign this request a unique generation ID. Every await below checks
    // whether we're still the current request before proceeding.
    const requestId = ++playRequestIdRef.current;

    dispatch({ type: 'RESOLVING', track });

    // Re-authorize if the browser lost permission (must be called inside a user gesture)
    if (usb.status === 'permission-required') {
      const perm = await usb.ensurePermission();
      if (requestId !== playRequestIdRef.current) return; // superseded
      if (perm !== 'granted') {
        dispatch({ type: 'ERROR', error: 'USB access permission denied. Re-authorize the USB drive.' });
        return;
      }
    }

    // Normalize the Rekordbox file path (synchronous)
    const resolution = resolveUsbPath(track.file_path);
    if (resolution.status !== 'ok') {
      if (requestId !== playRequestIdRef.current) return;
      dispatch({
        type: 'ERROR',
        error: `Cannot resolve track path (${resolution.status}): "${track.file_path}"`,
      });
      return;
    }

    // Fetch the File from the USB handle (async)
    const fileResult = await usb.resolveTrackFile(resolution.segments);
    if (requestId !== playRequestIdRef.current) return; // superseded

    if (!fileResult.ok) {
      const { error } = fileResult as { ok: false; error: UsbFileResolutionError };
      dispatch({ type: 'ERROR', error: usbFileErrorMessage(error) });
      return;
    }

    if (!audio) {
      dispatch({ type: 'ERROR', error: 'Audio engine not ready.' });
      return;
    }

    // Create object URL — temporary in-memory only, never stored.
    const newUrl = URL.createObjectURL(fileResult.file);

    // Check generation one more time before mutating shared audio element state.
    if (requestId !== playRequestIdRef.current) {
      safeRevokeUrl(newUrl); // revoke the URL we just created — no longer needed
      return;
    }

    // Reset element and revoke previous object URL.
    resetAudioElement(audio, stateRef.current.objectUrl);
    dispatch({ type: 'LOADED', track, objectUrl: newUrl });

    audio.src = newUrl;
    audio.volume = stateRef.current.volume;
    audio.muted = stateRef.current.muted;

    try {
      await audio.play();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // AbortError means another play() was initiated — not a fatal error.
        // The new request has already taken ownership; do not dispatch ERROR.
        // The URL we set is already owned by state (LOADED dispatched above) and
        // will be revoked by the new request's resetAudioElement call.
        return;
      }
      // Unexpected playback failure — revoke this URL and surface the error.
      if (requestId === playRequestIdRef.current) {
        safeRevokeUrl(newUrl);
        dispatch({
          type: 'ERROR',
          error: `Playback failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }, []);

  const toggleTrack = useCallback(async (track: RekordboxTrack): Promise<void> => {
    const s = stateRef.current;
    if (s.activeTrack?.id === track.id) {
      if (s.status === 'playing') {
        audioRef.current?.pause();
        return;
      }
      if (s.status === 'paused' || s.status === 'ended') {
        try { await audioRef.current?.play(); } catch { /* handled by error listener */ }
        return;
      }
    }
    await playTrack(track);
  }, [playTrack]);

  const pause = useCallback(() => { audioRef.current?.pause(); }, []);

  const resume = useCallback(async () => {
    try { await audioRef.current?.play(); } catch { /* handled by error listener */ }
  }, []);

  const seek = useCallback((seconds: number) => {
    if (audioRef.current) audioRef.current.currentTime = Math.max(0, seconds);
  }, []);

  const setVolume = useCallback((value: number) => {
    const v = Math.max(0, Math.min(1, value));
    if (audioRef.current) audioRef.current.volume = v;
    dispatch({ type: 'SET_VOLUME', volume: v });
  }, []);

  const toggleMute = useCallback(() => {
    const next = !stateRef.current.muted;
    if (audioRef.current) audioRef.current.muted = next;
    dispatch({ type: 'SET_MUTED', muted: next });
  }, []);

  const stop = useCallback(() => {
    // Invalidate any in-flight playTrack call.
    playRequestIdRef.current++;
    safeResetAudio(audioRef.current, stateRef.current.objectUrl);
    dispatch({ type: 'STOP' });
  }, []);

  const clearError = useCallback(() => { dispatch({ type: 'CLEAR_ERROR' }); }, []);

  const getAudioElement = useCallback(() => audioRef.current, []);

  const value: AudioPlayerContextValue = {
    ...state,
    playTrack,
    toggleTrack,
    pause,
    resume,
    seek,
    setVolume,
    toggleMute,
    stop,
    clearError,
    getAudioElement,
  };

  return (
    <AudioPlayerContext.Provider value={value}>
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer(): AudioPlayerContextValue {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error('useAudioPlayer must be used within AudioPlayerProvider');
  return ctx;
}
