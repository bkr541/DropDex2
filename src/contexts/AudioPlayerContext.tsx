import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { useUsbConnection, type UsbStatus } from './UsbConnectionContext';
import { resolveUsbPath } from '../lib/rekordbox/usbPathResolver';
import type { RekordboxImport, RekordboxTrack } from '../types';
import type { UsbFileResolutionError } from '../lib/usb/resolveUsbFile';
import { registerUsbPlaybackStopHandler } from '../lib/usb/usbPlaybackCoordinator';
import { logger } from '../lib/logger';
import { trackIdentityKey } from '../lib/preview/trackIdentity';
import { fetchPreviewPlayback } from '../lib/queries/trackPreviews';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlayerStatus =
  | 'idle'
  | 'resolving'  // path resolution + USB file fetch in progress
  | 'loading'    // media source attached; metadata/canplay pending
  | 'ready'      // metadata decoded and transport ready
  | 'playing'
  | 'buffering'
  | 'seeking'
  | 'paused'
  | 'ended'
  | 'error';

/** Where the playing audio comes from: the user's USB, or their DropDex Cloud preview. */
export type PlaybackSource = 'usb' | 'cloud';

interface PlayerState {
  activeTrack: RekordboxTrack | null;
  /** Set once audio is attached; null while resolving, stopped or in error. */
  source: PlaybackSource | null;
  status: PlayerStatus;
  /** User intent, kept separate from transient buffering/seeking states. */
  playIntent: boolean;
  volume: number;
  muted: boolean;
  repeat: boolean;
  error: string | null;
  objectUrl: string | null;
}

type PlayerAction =
  | { type: 'RESOLVING'; track: RekordboxTrack }
  | { type: 'LOADED'; track: RekordboxTrack; objectUrl: string; source: PlaybackSource }
  | { type: 'READY' }
  | { type: 'PLAY_REQUESTED' }
  | { type: 'PLAYING' }
  | { type: 'BUFFERING' }
  | { type: 'SEEKING' }
  | { type: 'PAUSED' }
  | { type: 'ENDED' }
  | { type: 'STOP' }
  | { type: 'ERROR'; error: string; track?: RekordboxTrack | null }
  | { type: 'SET_VOLUME'; volume: number }
  | { type: 'SET_MUTED'; muted: boolean }
  | { type: 'SET_REPEAT'; repeat: boolean }
  | { type: 'CLEAR_ERROR' };

export interface AudioPlayerContextValue extends PlayerState {
  playTrack(track: RekordboxTrack): Promise<void>;
  toggleTrack(track: RekordboxTrack): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  seek(seconds: number): void;
  setVolume(value: number): void;
  toggleMute(): void;
  toggleRepeat(): void;
  stop(): void;
  clearError(): void;
  getAudioElement(): HTMLAudioElement | null;
}

interface AudioPlayerProviderProps {
  children: ReactNode;
  /** Import snapshots provide the expected Rekordbox volume for path validation. */
  imports?: RekordboxImport[];
}

// ── Reducer ───────────────────────────────────────────────────────────────────

const initial: PlayerState = {
  activeTrack: null,
  source: null,
  status: 'idle',
  playIntent: false,
  volume: 1,
  muted: false,
  repeat: false,
  error: null,
  objectUrl: null,
};

function reducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'RESOLVING':
      return {
        ...state,
        activeTrack: action.track,
        source: null,
        status: 'resolving',
        playIntent: true,
        error: null,
        objectUrl: null,
      };
    case 'LOADED':
      return {
        ...state,
        activeTrack: action.track,
        objectUrl: action.objectUrl,
        source: action.source,
        status: 'loading',
        playIntent: true,
        error: null,
      };
    case 'READY':
      return { ...state, status: 'ready' };
    case 'PLAY_REQUESTED':
      return { ...state, playIntent: true };
    case 'PLAYING':
      return { ...state, status: 'playing', playIntent: true };
    case 'BUFFERING':
      return { ...state, status: 'buffering', playIntent: true };
    case 'SEEKING':
      return { ...state, status: 'seeking' };
    case 'PAUSED':
      return { ...state, status: 'paused', playIntent: false };
    case 'ENDED':
      return { ...state, status: 'ended', playIntent: false };
    case 'STOP':
      return { ...initial, volume: state.volume, muted: state.muted };
    case 'ERROR':
      return {
        ...state,
        activeTrack: action.track === undefined ? state.activeTrack : action.track,
        source: null,
        status: 'error',
        playIntent: false,
        error: action.error,
        objectUrl: null,
      };
    case 'SET_VOLUME':
      return { ...state, volume: action.volume };
    case 'SET_MUTED':
      return { ...state, muted: action.muted };
    case 'SET_REPEAT':
      return { ...state, repeat: action.repeat };
    case 'CLEAR_ERROR':
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

function resetAudioElement(
  audio: HTMLAudioElement,
  oldUrl: string | null,
  revokeUrl: boolean,
) {
  audio.pause();
  audio.loop = false;
  audio.removeAttribute('src');
  audio.load();
  if (revokeUrl) safeRevokeUrl(oldUrl);
}

function safeResetAudio(
  audio: HTMLAudioElement | null,
  oldUrl: string | null,
  revokeUrl: boolean,
) {
  if (audio) resetAudioElement(audio, oldUrl, revokeUrl);
  else if (revokeUrl) safeRevokeUrl(oldUrl);
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
    case 'ambiguous_case_match':
      return `Multiple USB entries match "${error.segment}" by case. Rename the duplicate and try again.`;
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
      return 'Unsupported audio format. Convert to MP3 or AAC in Rekordbox.';
    case MEDIA_ERR_NETWORK:
      return 'Network error during playback.';
    case MEDIA_ERR_DECODE:
      return 'Audio decode error. The file may be corrupted or DRM-protected.';
    default:
      return `Playback error (code ${err.code}).`;
  }
}

/**
 * Whether a track may be played from its DropDex Cloud preview. The USB always wins: while DropDex is reading the drive
 * ('connected') or still checking it ('connecting') the track plays from the USB, and the preview is not used.
 */
export function shouldTryCloudPreview(status: UsbStatus): boolean {
  return status !== 'connected' && status !== 'connecting';
}

export function usbStatusPlaybackMessage(status: UsbStatus): string {
  switch (status) {
    case 'wrong_root':
      return 'The selected folder is not the Rekordbox USB root. Select the drive root and try again.';
    case 'permission-required':
      return 'USB access needs to be re-authorized before playback.';
    case 'unavailable':
      return 'USB is unavailable. Reconnect the drive and try again.';
    case 'unsupported':
      return 'Folder access is unavailable in this browser. Use the DropDex desktop app, or open the browser build in Chrome or Edge over HTTPS or localhost.';
    case 'error':
      return 'USB access failed. Reconnect the drive and try again.';
    case 'connecting':
      return 'USB connection is still being verified.';
    case 'disconnected':
      return 'USB is disconnected.';
    case 'connected':
      return '';
    case 'released':
      return 'USB media access was released. Reconnect the drive before playback.';
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AudioPlayerProvider({ children, imports = [] }: AudioPlayerProviderProps) {
  const [state, dispatch] = useReducer(reducer, initial);
  const usbCtx = useUsbConnection();

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const usbRef = useRef(usbCtx);
  useEffect(() => { usbRef.current = usbCtx; }, [usbCtx]);
  const importsRef = useRef(imports);
  useEffect(() => { importsRef.current = imports; }, [imports]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ownedUrlRef = useRef<string | null>(null);
  const ownedUrlIsRevocableRef = useRef(false);
  const ownedSourceIsUsbRef = useRef(false);
  const ignoreMediaEventsRef = useRef(false);
  const playRequestIdRef = useRef(0);
  const pendingPlayRef = useRef<RekordboxTrack | null>(null);

  const releaseCurrentSource = useCallback(() => {
    const oldUrl = ownedUrlRef.current;
    const revokeUrl = ownedUrlIsRevocableRef.current;
    ownedUrlRef.current = null;
    ownedUrlIsRevocableRef.current = false;
    ownedSourceIsUsbRef.current = false;
    ignoreMediaEventsRef.current = true;
    safeResetAudio(audioRef.current, oldUrl, revokeUrl);
    ignoreMediaEventsRef.current = false;
  }, []);

  const failPlayback = useCallback((error: string, track?: RekordboxTrack | null) => {
    playRequestIdRef.current += 1;
    pendingPlayRef.current = null;
    releaseCurrentSource();
    dispatch({ type: 'ERROR', error, track });
  }, [releaseCurrentSource]);

  useEffect(() => {
    if (typeof Audio === 'undefined') return;
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;

    const ownsSource = () => Boolean(ownedUrlRef.current && audio.src);
    const onLoadedMetadata = () => {
      if (ignoreMediaEventsRef.current || !ownsSource()) return;
      const currentStatus = stateRef.current.status;
      if (currentStatus === 'loading' || currentStatus === 'ready') {
        dispatch({ type: 'READY' });
      }
    };
    const onCanPlay = () => {
      if (ignoreMediaEventsRef.current || !ownsSource()) return;
      dispatch({ type: audio.paused ? 'READY' : 'PLAYING' });
    };
    const onPlay = () => {
      if (!ignoreMediaEventsRef.current && ownsSource()) dispatch({ type: 'PLAYING' });
    };
    const onPause = () => {
      if (!ignoreMediaEventsRef.current && ownsSource() && !audio.ended) dispatch({ type: 'PAUSED' });
    };
    const onWaiting = () => {
      if (!ignoreMediaEventsRef.current && ownsSource() && !audio.paused) dispatch({ type: 'BUFFERING' });
    };
    const onSeeking = () => {
      if (!ignoreMediaEventsRef.current && ownsSource()) dispatch({ type: 'SEEKING' });
    };
    const onSeeked = () => {
      if (ignoreMediaEventsRef.current || !ownsSource()) return;
      dispatch({ type: audio.paused ? 'PAUSED' : 'PLAYING' });
    };
    const onEnded = () => {
      if (!ignoreMediaEventsRef.current && ownsSource()) dispatch({ type: 'ENDED' });
    };
    const onError = () => {
      if (ignoreMediaEventsRef.current || !ownedUrlRef.current) return;
      const message = audioMediaErrorMessage(audio.error);
      if (stateRef.current.source === 'cloud') {
        logger.error('preview.playback.failed', { trackId: stateRef.current.activeTrack?.id, mediaErrorCode: audio.error?.code ?? null, message });
      }
      playRequestIdRef.current += 1;
      pendingPlayRef.current = null;
      releaseCurrentSource();
      dispatch({ type: 'ERROR', error: message });
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('durationchange', onLoadedMetadata);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('stalled', onWaiting);
    audio.addEventListener('seeking', onSeeking);
    audio.addEventListener('seeked', onSeeked);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('durationchange', onLoadedMetadata);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('stalled', onWaiting);
      audio.removeEventListener('seeking', onSeeking);
      audio.removeEventListener('seeked', onSeeked);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      ignoreMediaEventsRef.current = true;
      safeResetAudio(audio, ownedUrlRef.current, ownedUrlIsRevocableRef.current);
      ownedUrlRef.current = null;
      ownedUrlIsRevocableRef.current = false;
      ownedSourceIsUsbRef.current = false;
      audioRef.current = null;
      playRequestIdRef.current = Number.MAX_SAFE_INTEGER;
    };
  }, [releaseCurrentSource]);

  /** Attach a source to the audio element and start it. `source` says whether it is the USB file or the cloud preview. */
  const startAudio = useCallback(async (
    track: RekordboxTrack,
    requestId: number,
    url: string,
    revocable: boolean,
    source: PlaybackSource,
  ): Promise<void> => {
    const audio = audioRef.current;
    if (!audio || requestId !== playRequestIdRef.current) {
      if (revocable) safeRevokeUrl(url);
      if (!audio && requestId === playRequestIdRef.current) {
        pendingPlayRef.current = null;
        releaseCurrentSource();
        dispatch({ type: 'ERROR', error: 'Audio engine not ready.', track });
      }
      return;
    }

    ownedUrlRef.current = url;
    ownedUrlIsRevocableRef.current = revocable;
    ownedSourceIsUsbRef.current = source === 'usb';
    audio.src = url;
    audio.volume = stateRef.current.volume;
    audio.muted = stateRef.current.muted;
    audio.loop = stateRef.current.repeat;
    dispatch({ type: 'LOADED', track, objectUrl: url, source });
    audio.load();

    try {
      await audio.play();
    } catch (err) {
      if (requestId !== playRequestIdRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = `Playback failed: ${err instanceof Error ? err.message : String(err)}`;
      if (source === 'cloud') logger.error('preview.playback.failed', { trackId: track.id, message });
      pendingPlayRef.current = null;
      releaseCurrentSource();
      dispatch({ type: 'ERROR', error: message, track });
    }
  }, [releaseCurrentSource]);

  /**
   * Play the track from its DropDex Cloud preview. Only used when DropDex is not reading the USB. Returns false when
   * there is nothing to play it from (no synced preview, or the lookup failed), so the normal USB handling can go on.
   */
  const playCloudPreview = useCallback(async (track: RekordboxTrack, requestId: number): Promise<boolean> => {
    let preview: Awaited<ReturnType<typeof fetchPreviewPlayback>>;
    try {
      preview = await fetchPreviewPlayback(trackIdentityKey(track));
    } catch (error) {
      logger.warn('preview.playback.lookup_failed', { trackId: track.id, title: track.title, message: error instanceof Error ? error.message : String(error) });
      return false;
    }
    if (requestId !== playRequestIdRef.current) return true;
    if (!preview) return false;
    // The drive may have come back while the preview was being looked up. The USB always wins.
    if (!shouldTryCloudPreview(usbRef.current.status)) return false;
    logger.info('preview.playback.start', { trackId: track.id, title: track.title });
    await startAudio(track, requestId, preview.url, false, 'cloud');
    return true;
  }, [startAudio]);

  const playTrack = useCallback(async (track: RekordboxTrack): Promise<void> => {
    const requestId = ++playRequestIdRef.current;
    pendingPlayRef.current = null;

    // Stop-first transport policy: no previous source may remain audible while
    // the requested track is resolving or while an error is being displayed.
    releaseCurrentSource();
    dispatch({ type: 'RESOLVING', track });

    const failCurrent = (message: string) => {
      if (requestId !== playRequestIdRef.current) return;
      pendingPlayRef.current = null;
      releaseCurrentSource();
      dispatch({ type: 'ERROR', error: message, track });
    };

    // Always play from the USB while DropDex is reading it. Only when it is not, use the track's cloud preview.
    if (shouldTryCloudPreview(usbRef.current.status)) {
      if (await playCloudPreview(track, requestId)) return;
      if (requestId !== playRequestIdRef.current) return;
    }

    if (!track.file_path) {
      failCurrent('This track has no file path. Re-import with a USB connected.');
      return;
    }

    let usb = usbRef.current;
    if (usb.status === 'connecting') {
      pendingPlayRef.current = track;
      return;
    }
    if (usb.status === 'disconnected') {
      pendingPlayRef.current = track;
      void usb.connect();
      return;
    }
    if (usb.status === 'released') {
      // The drive is still physically connected — the release was a soft handoff
      // (e.g. post-import). Queue the track and let reconnect finish first.
      pendingPlayRef.current = track;
      void usb.reconnect();
      return;
    }
    if (usb.status === 'permission-required') {
      const readyStatus = await usb.ensurePermission();
      if (requestId !== playRequestIdRef.current) return;
      if (readyStatus !== 'connected') {
        failCurrent(usbStatusPlaybackMessage(readyStatus));
        return;
      }
      usb = usbRef.current;
    } else if (usb.status !== 'connected') {
      failCurrent(usbStatusPlaybackMessage(usb.status));
      return;
    }

    const expectedVolume = importsRef.current.find((item) => item.id === track.import_id)?.device_name ?? undefined;
    const resolution = resolveUsbPath(track.file_path, { expectedVolume });
    if (resolution.status === 'volume_mismatch') {
      failCurrent(
        `This track belongs to USB volume "${expectedVolume}" but its Rekordbox path references "${resolution.strippedVolume}". Connect the matching drive.`,
      );
      return;
    }
    if (resolution.status !== 'ok') {
      failCurrent(`Cannot resolve track path (${resolution.status}): "${track.file_path}"`);
      return;
    }

    const sourceResult = await usb.resolveTrackSource(resolution.segments, {
      isCancelled: () => requestId !== playRequestIdRef.current,
    });
    if (requestId !== playRequestIdRef.current) return;

    if (!sourceResult.ok) {
      const failure = sourceResult as { ok: false; error: UsbFileResolutionError };
      if (failure.error.kind === 'abort') return;
      failCurrent(usbFileErrorMessage(failure.error));
      return;
    }

    const newUrl = sourceResult.source.kind === 'file'
      ? URL.createObjectURL(sourceResult.source.file)
      : sourceResult.source.url;
    await startAudio(track, requestId, newUrl, sourceResult.source.kind === 'file', 'usb');
  }, [releaseCurrentSource, playCloudPreview, startAudio]);

  // Auto-play a request queued while the USB picker or restore check was active,
  // and tear down playback whenever a connected drive becomes unusable.
  useEffect(() => {
    const usbStatus = usbCtx.status;
    if (usbStatus === 'connected') {
      const pending = pendingPlayRef.current;
      if (pending) {
        pendingPlayRef.current = null;
        void playTrack(pending);
        return;
      }
      // Drive reconnected with no queued track. If the player is stuck in an
      // error state (e.g. from the pre-reconnect USB-released error), clear it
      // so the transport is unblocked and the user can retry without a restart.
      if (stateRef.current.status === 'error') {
        dispatch({ type: 'CLEAR_ERROR' });
      }
      return;
    }
    if (usbStatus === 'connecting') return;

    const pending = pendingPlayRef.current;
    if (pending) {
      // The drive did not come up. Play the track from its cloud preview if it has one.
      pendingPlayRef.current = null;
      const requestId = playRequestIdRef.current;
      void playCloudPreview(pending, requestId).then((played) => {
        if (!played && requestId === playRequestIdRef.current) failPlayback(usbStatusPlaybackMessage(usbStatus), pending);
      });
      return;
    }

    if (!ownedSourceIsUsbRef.current) return;
    const current = stateRef.current;
    if (current.status === 'idle' || current.status === 'error') return;
    failPlayback(usbStatusPlaybackMessage(usbStatus), current.activeTrack);
  }, [usbCtx.status, failPlayback, playTrack, playCloudPreview]);


  useEffect(() => registerUsbPlaybackStopHandler(() => {
    if (!ownedSourceIsUsbRef.current) return;
    playRequestIdRef.current += 1;
    pendingPlayRef.current = null;
    releaseCurrentSource();
    dispatch({ type: 'STOP' });
  }), [releaseCurrentSource]);

  const toggleTrack = useCallback(async (track: RekordboxTrack): Promise<void> => {
    const s = stateRef.current;
    if (s.activeTrack?.id === track.id) {
      if (s.playIntent && (s.status === 'playing' || s.status === 'buffering' || s.status === 'seeking')) {
        audioRef.current?.pause();
        return;
      }
      if (s.status === 'paused' || s.status === 'ended' || s.status === 'ready') {
        await (async () => {
          dispatch({ type: 'PLAY_REQUESTED' });
          try {
            await audioRef.current?.play();
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            failPlayback(`Playback failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        })();
        return;
      }
    }
    await playTrack(track);
  }, [failPlayback, playTrack]);

  const pause = useCallback(() => { audioRef.current?.pause(); }, []);

  const resume = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !ownedUrlRef.current) return;
    dispatch({ type: 'PLAY_REQUESTED' });
    try {
      await audio.play();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      failPlayback(`Playback failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [failPlayback]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !ownedUrlRef.current) return;
    const maximum = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number.MAX_SAFE_INTEGER;
    audio.currentTime = Math.max(0, Math.min(maximum, seconds));
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

  const toggleRepeat = useCallback(() => {
    const next = !stateRef.current.repeat;
    if (audioRef.current) audioRef.current.loop = next;
    dispatch({ type: 'SET_REPEAT', repeat: next });
  }, []);

  const stop = useCallback(() => {
    playRequestIdRef.current += 1;
    pendingPlayRef.current = null;
    releaseCurrentSource();
    dispatch({ type: 'STOP' });
  }, [releaseCurrentSource]);

  const clearError = useCallback(() => {
    playRequestIdRef.current += 1;
    pendingPlayRef.current = null;
    releaseCurrentSource();
    dispatch({ type: 'CLEAR_ERROR' });
  }, [releaseCurrentSource]);

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
    toggleRepeat,
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
