import { useCallback, useEffect, useRef, useState } from 'react';
import { useOptionalUsbConnection } from '../contexts/UsbConnectionContext';
import { usbFileErrorMessage } from '../contexts/AudioPlayerContext';
import { logger } from '../lib/logger';
import { readBoundedAudioBytes } from '../lib/audio/audioSourceLoader';
import { analyzeAudioFeatures, mixDownToMono, type AudioFeatureAnalysis, type BarWindow } from '../lib/audioIntelligence/audioFeatures';
import { resolveUsbPath } from '../lib/rekordbox/usbPathResolver';

const MAX_ENCODED_BYTES = 200 * 1024 * 1024;
const MAX_DURATION_SEC = 20 * 60;
/** Finished analyses are kept for the session so reopening a track does not repeat the work. */
const cache = new Map<string, AudioFeatureAnalysis>();
const CACHE_LIMIT = 6;

export type TrackAudioAnalysisState =
  | { status: 'idle' }
  | { status: 'running'; progress: number; step: string }
  | { status: 'ready'; analysis: AudioFeatureAnalysis }
  | { status: 'error'; message: string };

/**
 * Reads one track's audio from the connected USB, decodes it, and measures it (bands, energy, chroma, key and per-bar figures)
 * when asked. Every step and failure goes to the app's Logger as `library.audioanalysis.*`.
 */
export function useTrackAudioAnalysis(track: { id: string; title: string; file_path?: string | null }, bars: BarWindow[]) {
  const usb = useOptionalUsbConnection();
  const usbRef = useRef(usb);
  usbRef.current = usb;
  const cached = cache.get(track.id);
  const [state, setState] = useState<TrackAudioAnalysisState>(cached ? { status: 'ready', analysis: cached } : { status: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    const hit = cache.get(track.id);
    setState(hit ? { status: 'ready', analysis: hit } : { status: 'idle' });
    controllerRef.current?.abort();
  }, [track.id]);

  const run = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const fail = (message: string, detail?: unknown) => {
      logger.error('library.audioanalysis.failed', { trackId: track.id, title: track.title, filePath: track.file_path, message, detail: detail instanceof Error ? detail.message : detail });
      setState({ status: 'error', message });
    };
    logger.info('library.audioanalysis.start', { trackId: track.id, title: track.title, filePath: track.file_path });
    const connection = usbRef.current;
    if (!connection) return fail('Audio analysis needs the DropDex app and a connected USB drive.');
    if (connection.status !== 'connected') return fail('Connect the USB drive that holds this track, then try again.');
    if (!track.file_path) return fail('This track has no file path. Re-import it with the USB connected.');
    try {
      setState({ status: 'running', progress: 0, step: 'Finding the file on your USB' });
      const resolution = resolveUsbPath(track.file_path, {});
      if (resolution.status !== 'ok') return fail(`This track's file path could not be used (${resolution.status}).`);
      const source = await connection.resolveTrackSource(resolution.segments, { isCancelled: () => controller.signal.aborted });
      if (!source.ok) {
        const failure = source as { ok: false; error: Parameters<typeof usbFileErrorMessage>[0] };
        if (failure.error.kind === 'abort') return;
        return fail(usbFileErrorMessage(failure.error), failure.error);
      }
      setState({ status: 'running', progress: 0.05, step: 'Reading the audio' });
      const bytes = await readBoundedAudioBytes(source.source, { maxBytes: MAX_ENCODED_BYTES, signal: controller.signal });
      setState({ status: 'running', progress: 0.12, step: 'Decoding the audio' });
      const context = new OfflineAudioContext(2, 1, 44100);
      let decoded: AudioBuffer;
      try { decoded = await context.decodeAudioData(bytes); } catch (error) { return fail('This audio file could not be decoded.', error); }
      if (decoded.duration > MAX_DURATION_SEC) return fail('This track is longer than 20 minutes, which is more than the analysis supports.');
      const samples = await mixDownToMono(Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel)), controller.signal);
      const analysis = await analyzeAudioFeatures(samples, decoded.sampleRate, {
        bars,
        signal: controller.signal,
        onProgress: (fraction) => setState({ status: 'running', progress: 0.15 + fraction * 0.85, step: 'Measuring the track' }),
      });
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(track.id, analysis);
      logger.info('library.audioanalysis.done', { trackId: track.id, durationSec: Math.round(analysis.durationSec), bars: analysis.bars.length, key: analysis.key.tonic, mode: analysis.key.mode });
      setState({ status: 'ready', analysis });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
      fail('The audio could not be analysed.', error);
    }
  }, [bars, track.file_path, track.id, track.title]);

  return { state, run };
}
