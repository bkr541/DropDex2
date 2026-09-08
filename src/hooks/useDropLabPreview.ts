import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioPlayer } from '../contexts/AudioPlayerContext';
import { useUsbConnection } from '../contexts/UsbConnectionContext';
import { resolveUsbPath } from '../lib/rekordbox/usbPathResolver';
import type { DropLabTimeSegment } from '../lib/music/dropLabSegments';
import type { RekordboxTrack } from '../types';
import { registerUsbPlaybackStopHandler } from '../lib/usb/usbPlaybackCoordinator';
import { getDropLabPreviewPrerequisiteReason } from '../lib/music/dropLabPreviewPrerequisites';
import { DecodedAudioCache } from '../lib/audio/decodedAudioCache';
import { createBrowserAudioContext, closeAudioContext, scheduleAudioBufferClips, stopAndDisconnectAudioNodes } from '../lib/audio/webAudioScheduling';
import { loadDropLabDecodedPair } from '../lib/music/dropLabPreviewAudio';

type PreviewStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'error';
export type DropLabPreviewPhase = 'idle' | 'build' | 'drop';

interface DecodedPair {
  source: AudioBuffer;
  candidate: AudioBuffer;
}

export interface UseDropLabPreviewResult {
  status: PreviewStatus;
  ready: boolean;
  playing: boolean;
  actionDisabled: boolean;
  disabledReason: string | null;
  buttonLabel: string;
  error: string | null;
  progress: number;
  phase: DropLabPreviewPhase;
  playOrStop: () => void;
  stop: () => void;
}

const decodedCache = new DecodedAudioCache<AudioBuffer>(8);
const PREVIEW_LOAD_TIMEOUT_MS = 30_000;

function loadWithTimeout<T>(promise: Promise<T>, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      onTimeout();
      reject(new Error('Audio preview timed out. Reconnect the USB and retry.'));
    }, PREVIEW_LOAD_TIMEOUT_MS);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        window.clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

export function useDropLabPreview(input: {
  sourceTrack: RekordboxTrack | null;
  candidateTrack: RekordboxTrack | null;
  sourceSegment: DropLabTimeSegment | null;
  candidateSegment: DropLabTimeSegment | null;
}) : UseDropLabPreviewResult {
  const usb = useUsbConnection();
  const globalPlayer = useAudioPlayer();
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<DecodedPair | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<DropLabPreviewPhase>('idle');
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<AudioBufferSourceNode[]>([]);
  const progressFrameRef = useRef<number>(0);
  const requestIdRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const prerequisiteReason = useMemo(
    () => getDropLabPreviewPrerequisiteReason({
      ...input,
      usbStatus: usb.status,
    }),
    [input.sourceTrack, input.candidateTrack, input.sourceSegment, input.candidateSegment, usb.status],
  );

  const disabledReason = status === 'loading'
    ? 'Preparing source and candidate audio…'
    : status === 'error'
      ? error
      : prerequisiteReason;

  const cancelProgress = useCallback(() => {
    cancelAnimationFrame(progressFrameRef.current);
    progressFrameRef.current = 0;
  }, []);

  const stop = useCallback(() => {
    cancelProgress();
    stopAndDisconnectAudioNodes(nodesRef.current);
    nodesRef.current = [];
    setProgress(0);
    setPhase('idle');
    setStatus((prev) => (prev === 'playing' ? 'ready' : prev));
  }, [cancelProgress]);

  useEffect(() => stop, [stop]);

  useEffect(() => () => {
    const context = audioCtxRef.current;
    audioCtxRef.current = null;
    decodedCache.clear();
    void closeAudioContext(context);
  }, []);

  useEffect(() => registerUsbPlaybackStopHandler(() => {
    requestIdRef.current += 1;
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;
    stop();
    decodedCache.clear();
    setDecoded(null);
    setError(null);
    setStatus('idle');
  }), [stop]);

  useEffect(() => {
    stop();
    setDecoded(null);
    setError(null);

    const requestId = ++requestIdRef.current;
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;

    if (
      !input.sourceTrack ||
      !input.candidateTrack ||
      !input.sourceSegment ||
      !input.candidateSegment ||
      prerequisiteReason
    ) {
      setStatus('idle');
      return;
    }

    const sourcePath = resolveUsbPath(input.sourceTrack.file_path);
    const candidatePath = resolveUsbPath(input.candidateTrack.file_path);
    if (sourcePath.status !== 'ok' || candidatePath.status !== 'ok') {
      setStatus('idle');
      return;
    }

    const fetchController = new AbortController();
    fetchAbortRef.current = fetchController;
    setStatus('loading');

    const getContext = () => {
      const context = audioCtxRef.current ?? createBrowserAudioContext();
      audioCtxRef.current = context;
      return context;
    };
    const isCancelled = () => fetchController.signal.aborted || requestId !== requestIdRef.current;
    const loadPair = loadDropLabDecodedPair(
      {
        source: { cacheKey: input.sourceTrack.id, pathSegments: sourcePath.segments },
        candidate: { cacheKey: input.candidateTrack.id, pathSegments: candidatePath.segments },
      },
      {
        cache: decodedCache,
        resolveSource: usb.resolveTrackSource,
        getAudioContext: getContext,
        isCancelled,
        fetchImpl: (url, init) => fetch(url, { ...init, signal: fetchController.signal }),
      },
    );

    loadWithTimeout(loadPair, () => fetchController.abort())
      .then(({ source, candidate }) => {
        if (requestId !== requestIdRef.current) return;
        if (fetchAbortRef.current === fetchController) fetchAbortRef.current = null;
        setDecoded({ source, candidate });
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (requestId !== requestIdRef.current) return;
        if (fetchAbortRef.current === fetchController) fetchAbortRef.current = null;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setDecoded(null);
        setError(err instanceof Error ? err.message : 'Could not prepare transition preview.');
        setStatus('error');
      });

    return () => {
      if (requestId === requestIdRef.current) requestIdRef.current += 1;
      if (fetchAbortRef.current === fetchController) fetchAbortRef.current = null;
      fetchController.abort();
    };
  }, [
    input.sourceTrack,
    input.candidateTrack,
    input.sourceSegment,
    input.candidateSegment,
    prerequisiteReason,
    retryTrigger,
    stop,
    usb.resolveTrackSource,
  ]);

  const playOrStop = useCallback(() => {
    if (status === 'playing') {
      stop();
      return;
    }
    if (status === 'error') {
      setRetryTrigger((value) => value + 1);
      return;
    }
    if (!decoded || !input.sourceSegment || !input.candidateSegment || prerequisiteReason) return;

    globalPlayer.stop();
    const ctx = audioCtxRef.current ?? createBrowserAudioContext();
    audioCtxRef.current = ctx;
    void ctx.resume();

    const sourceOffset = input.sourceSegment.startMs / 1000;
    const candidateOffset = input.candidateSegment.startMs / 1000;
    const sourceDuration = Math.min(
      input.sourceSegment.durationMs / 1000,
      Math.max(0, decoded.source.duration - sourceOffset),
    );
    const candidateDuration = Math.min(
      input.candidateSegment.durationMs / 1000,
      Math.max(0, decoded.candidate.duration - candidateOffset),
    );
    if (sourceDuration <= 0 || candidateDuration <= 0) {
      setError('The selected cue window falls outside the decoded audio. Choose another cue point.');
      setStatus('error');
      return;
    }

    let sourceNode: AudioBufferSourceNode;
    let candidateNode: AudioBufferSourceNode;
    let startAt: number;

    try {
      const scheduled = scheduleAudioBufferClips(
        ctx,
        [
          {
            buffer: decoded.source,
            offsetSeconds: sourceOffset,
            durationSeconds: sourceDuration,
          },
          {
            buffer: decoded.candidate,
            offsetSeconds: candidateOffset,
            durationSeconds: candidateDuration,
            startOffsetSeconds: sourceDuration,
          },
        ],
        { leadInSeconds: 0.05 },
      );
      [sourceNode, candidateNode] = scheduled.nodes;
      startAt = scheduled.startAt;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the transition preview.');
      setStatus('error');
      return;
    }

    nodesRef.current = [sourceNode, candidateNode];
    setProgress(0);
    setPhase('build');
    setStatus('playing');

    let lastUiUpdate = 0;
    const updateProgress = (timestamp: number) => {
      const elapsed = Math.max(0, ctx.currentTime - startAt);
      if (timestamp - lastUiUpdate >= 50) {
        lastUiUpdate = timestamp;
        if (elapsed < sourceDuration) {
          setPhase('build');
          setProgress(Math.min(0.5, (elapsed / sourceDuration) * 0.5));
        } else {
          const dropElapsed = elapsed - sourceDuration;
          setPhase('drop');
          setProgress(Math.min(1, 0.5 + (dropElapsed / candidateDuration) * 0.5));
        }
      }
      if (elapsed < sourceDuration + candidateDuration) {
        progressFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };
    progressFrameRef.current = requestAnimationFrame(updateProgress);

    candidateNode.onended = () => {
      if (!nodesRef.current.includes(candidateNode)) return;
      cancelProgress();
      nodesRef.current = [];
      stopAndDisconnectAudioNodes([sourceNode, candidateNode]);
      setProgress(0);
      setPhase('idle');
      setStatus('ready');
    };
  }, [cancelProgress, decoded, globalPlayer, input.candidateSegment, input.sourceSegment, prerequisiteReason, status, stop]);

  const ready = status === 'ready' || status === 'playing';
  const actionDisabled = status === 'loading' || Boolean(prerequisiteReason) || status === 'idle';
  const buttonLabel = status === 'playing'
    ? 'Stop Transition'
    : status === 'loading'
      ? 'Preparing Audio…'
      : status === 'error'
        ? 'Retry Audio'
        : 'Play Build → Drop';

  return {
    status,
    ready,
    playing: status === 'playing',
    actionDisabled,
    disabledReason,
    buttonLabel,
    error,
    progress,
    phase,
    playOrStop,
    stop,
  };
}
