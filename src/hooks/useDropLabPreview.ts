import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioPlayer } from '../contexts/AudioPlayerContext';
import { useUsbConnection } from '../contexts/UsbConnectionContext';
import { resolveUsbPath } from '../lib/rekordbox/usbPathResolver';
import type { DropLabTimeSegment } from '../lib/music/dropLabSegments';
import type { RekordboxTrack } from '../types';

type PreviewStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'error';

interface DecodedPair {
  source: AudioBuffer;
  candidate: AudioBuffer;
}

export interface UseDropLabPreviewResult {
  status: PreviewStatus;
  ready: boolean;
  playing: boolean;
  disabledReason: string | null;
  buttonLabel: string;
  error: string | null;
  playOrStop: () => void;
  stop: () => void;
}

const decodedCache = new Map<string, AudioBuffer>();

function fileStatus(track: RekordboxTrack): string | null {
  if (!track.file_path) return 'Missing audio file path';
  const resolved = resolveUsbPath(track.file_path);
  if (resolved.status !== 'ok') return 'Audio path unavailable';
  return null;
}

function getAudioContext(): AudioContext {
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('Web Audio is not supported in this browser.');
  return new AudioContextCtor();
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
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<AudioBufferSourceNode[]>([]);
  const requestIdRef = useRef(0);

  const disabledReason = useMemo(() => {
    if (!input.sourceTrack || !input.candidateTrack) return 'Choose a candidate';
    if (!input.sourceSegment || !input.candidateSegment) return 'Drop Point Unavailable';
    const sourceFileError = fileStatus(input.sourceTrack);
    if (sourceFileError) return sourceFileError;
    const candidateFileError = fileStatus(input.candidateTrack);
    if (candidateFileError) return candidateFileError;
    if (usb.status === 'disconnected' || usb.status === 'permission-required' || usb.status === 'unavailable' || usb.status === 'wrong_root') {
      return 'Connect USB to Preview';
    }
    if (usb.status === 'unsupported') return 'USB preview unsupported';
    if (usb.status === 'connecting') return 'Connecting USB';
    if (status === 'loading') return 'Loading Audio...';
    if (status === 'error') return error;
    return null;
  }, [input.sourceTrack, input.candidateTrack, input.sourceSegment, input.candidateSegment, usb.status, status, error]);

  const stop = useCallback(() => {
    for (const node of nodesRef.current) {
      try { node.stop(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    nodesRef.current = [];
    setStatus((prev) => (prev === 'playing' ? 'ready' : prev));
  }, []);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    stop();
    setDecoded(null);
    setError(null);

    if (
      !input.sourceTrack ||
      !input.candidateTrack ||
      !input.sourceSegment ||
      !input.candidateSegment ||
      disabledReason
    ) {
      if (disabledReason !== 'Loading Audio...') setStatus('idle');
      return;
    }

    const sourcePath = resolveUsbPath(input.sourceTrack.file_path);
    const candidatePath = resolveUsbPath(input.candidateTrack.file_path);
    if (sourcePath.status !== 'ok' || candidatePath.status !== 'ok') return;

    const requestId = ++requestIdRef.current;
    setStatus('loading');

    async function decodeTrack(track: RekordboxTrack, segments: string[]): Promise<AudioBuffer> {
      const cacheKey = track.id;
      const cached = decodedCache.get(cacheKey);
      if (cached) return cached;
      const result = await usb.resolveTrackFile(segments);
      if (!result.ok) throw new Error('Connect the Rekordbox USB drive to preview this transition.');
      const arrayBuffer = await result.file.arrayBuffer();
      const ctx = audioCtxRef.current ?? getAudioContext();
      audioCtxRef.current = ctx;
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      decodedCache.set(cacheKey, decodedBuffer);
      if (decodedCache.size > 8) {
        const firstKey = decodedCache.keys().next().value as string | undefined;
        if (firstKey) decodedCache.delete(firstKey);
      }
      return decodedBuffer;
    }

    Promise.all([
      decodeTrack(input.sourceTrack, sourcePath.segments),
      decodeTrack(input.candidateTrack, candidatePath.segments),
    ])
      .then(([source, candidate]) => {
        if (requestId !== requestIdRef.current) return;
        setDecoded({ source, candidate });
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (requestId !== requestIdRef.current) return;
        setDecoded(null);
        setError(err instanceof Error ? err.message : 'Could not prepare transition preview.');
        setStatus('error');
      });
  }, [
    input.sourceTrack,
    input.candidateTrack,
    input.sourceSegment,
    input.candidateSegment,
    disabledReason,
    stop,
    usb,
  ]);

  const playOrStop = useCallback(() => {
    if (status === 'playing') {
      stop();
      return;
    }
    if (!decoded || !input.sourceSegment || !input.candidateSegment || disabledReason) return;

    globalPlayer.stop();
    const ctx = audioCtxRef.current ?? getAudioContext();
    audioCtxRef.current = ctx;
    void ctx.resume();

    const sourceNode = ctx.createBufferSource();
    const candidateNode = ctx.createBufferSource();
    sourceNode.buffer = decoded.source;
    candidateNode.buffer = decoded.candidate;
    sourceNode.connect(ctx.destination);
    candidateNode.connect(ctx.destination);

    const leadInSeconds = 0.05;
    const startAt = ctx.currentTime + leadInSeconds;
    const sourceDuration = input.sourceSegment.durationMs / 1000;
    const candidateDuration = input.candidateSegment.durationMs / 1000;

    sourceNode.start(startAt, input.sourceSegment.startMs / 1000, sourceDuration);
    sourceNode.stop(startAt + sourceDuration);
    candidateNode.start(startAt + sourceDuration, input.candidateSegment.startMs / 1000, candidateDuration);
    candidateNode.stop(startAt + sourceDuration + candidateDuration);
    nodesRef.current = [sourceNode, candidateNode];
    setStatus('playing');

    candidateNode.onended = () => {
      nodesRef.current = [];
      setStatus('ready');
    };
  }, [decoded, disabledReason, globalPlayer, input.candidateSegment, input.sourceSegment, status, stop]);

  const ready = status === 'ready' || status === 'playing';
  const buttonLabel = status === 'playing'
    ? 'Stop Preview'
    : status === 'loading'
    ? 'Loading Audio...'
    : disabledReason ?? 'Preview Transition';

  return {
    status,
    ready,
    playing: status === 'playing',
    disabledReason,
    buttonLabel,
    error,
    playOrStop,
    stop,
  };
}
