import { DecodedAudioCache } from '../../lib/audio/decodedAudioCache';
import { closeAudioContext, createBrowserAudioContext } from '../../lib/audio/webAudioScheduling';
import { setLabPcmBytes, type PreparedSetLabClip } from './prepareSetLabAudio';
import { SET_LAB_AUDIO_LIMITS } from './setLabSources';
import { scheduleSetLabAudio } from './scheduleSetLabAudio';

export interface SetLabPreviewSnapshot {
  status: 'idle' | 'preparing' | 'playing' | 'paused' | 'ended' | 'error';
  positionSeconds: number;
  error: string | null;
}

export type SetLabPrepare = (
  context: AudioContext, signal: AbortSignal, cache: DecodedAudioCache<PreparedSetLabClip>,
) => Promise<PreparedSetLabClip[]>;

const initial: SetLabPreviewSnapshot = { status: 'idle', positionSeconds: 0, error: null };
const PREPARE_TIMEOUT_MS = 60_000;

export function createSetLabPreviewController({
  stopGlobal,
  createContext = () => createBrowserAudioContext({ sampleRate: SET_LAB_AUDIO_LIMITS.sampleRate }),
  frame = (callback: FrameRequestCallback) => requestAnimationFrame(callback),
  cancelFrame = (id: number) => cancelAnimationFrame(id),
}: {
  stopGlobal: () => void;
  createContext?: () => AudioContext;
  frame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
}) {
  const cache = new DecodedAudioCache<PreparedSetLabClip>(5, {
    maxBytes: SET_LAB_AUDIO_LIMITS.setPcmBytes,
    sizeOf: ({ buffer }) => setLabPcmBytes(buffer),
  });
  const listeners = new Set<() => void>();
  let snapshot = initial;
  let context: AudioContext | null = null;
  let prepared: PreparedSetLabClip[] | null = null;
  let request: AbortController | null = null;
  let requestId = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frameId: number | null = null;
  let playing: (ReturnType<typeof scheduleSetLabAudio> & { from: number; total: number }) | null = null;

  function publish(status: SetLabPreviewSnapshot['status'], positionSeconds = 0, error: string | null = null) {
    if (snapshot.status === status && snapshot.positionSeconds === positionSeconds && snapshot.error === error) return;
    snapshot = { status, positionSeconds, error };
    for (const listener of listeners) listener();
  }

  function stopSources() {
    if (frameId != null) cancelFrame(frameId);
    frameId = null;
    const run = playing;
    playing = null;
    run?.stop();
  }

  function abortRequest() {
    requestId += 1;
    clearTimeout(timer);
    request?.abort();
    request = null;
  }

  function releaseAudio() {
    abortRequest();
    stopSources();
    prepared = null;
    cache.clear();
    const old = context;
    context = null;
    void closeAudioContext(old);
  }

  function fail(message: string) {
    releaseAudio();
    publish('error', 0, message);
  }

  function position() {
    if (!playing || !context) return snapshot.positionSeconds;
    return Math.min(playing.total, playing.from + Math.max(0, context.currentTime - playing.startAt));
  }

  function finish() {
    if (!playing) return;
    const total = playing.total;
    stopSources();
    publish('ended', total);
  }

  function tick() {
    frameId = null;
    if (!playing || !context) return;
    if (context.currentTime >= playing.endAt) {
      finish();
    } else {
      publish('playing', position());
      if (playing) frameId = frame(tick);
    }
  }

  function pause() {
    if (!playing) return;
    const elapsed = position();
    if (elapsed >= playing.total) {
      finish();
      return;
    }
    stopSources();
    publish('paused', elapsed);
  }

  function stopAndReset() {
    if (request) releaseAudio();
    else stopSources();
    publish('idle');
  }

  async function play(prepare: SetLabPrepare) {
    if (request || playing) return;
    const from = snapshot.status === 'paused' ? snapshot.positionSeconds : 0;
    const controller = new AbortController();
    const id = ++requestId;
    request = controller;
    publish('preparing', from);
    timer = setTimeout(() => {
      if (id === requestId) fail('Set Lab audio preparation timed out. Check the audio sources and try again.');
    }, PREPARE_TIMEOUT_MS);

    try {
      const audio = context ??= createContext();
      // Start resume during the user gesture, before any media or query awaits.
      const ready = audio.resume();
      const [, clips] = await Promise.all([ready, prepared ?? prepare(audio, controller.signal, cache)]);
      if (id !== requestId || controller.signal.aborted) return;
      clearTimeout(timer);
      request = null;
      const total = clips.reduce((sum, clip) => sum + clip.durationMs, 0) / 1000;
      stopGlobal();
      const run = { ...scheduleSetLabAudio(audio, clips, from), from, total };
      prepared = clips;
      playing = run;
      run.lastNode.onended = () => { if (playing === run) finish(); };
      publish('playing', from);
      if (playing === run) frameId = frame(tick);
    } catch (error) {
      if (id === requestId) fail(error instanceof Error ? error.message : 'Set Lab audio could not be prepared.');
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    getStatus: () => snapshot.status,
    play,
    pause,
    stopAndReset,
    invalidate() {
      releaseAudio();
      publish('idle');
    },
    sourceChanged() {
      const interrupted = snapshot.status === 'playing' || snapshot.status === 'preparing' || snapshot.status === 'paused';
      releaseAudio();
      if (interrupted) publish('error', 0, 'The authorized audio source changed. Press Play to check the sources again.');
      else if (snapshot.status !== 'error') publish('idle');
    },
    dispose() {
      releaseAudio();
      snapshot = initial;
    },
  };
}
