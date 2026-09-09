export interface RouletteTimeStretchRequest {
  context: AudioContext;
  buffer: AudioBuffer;
  offsetSeconds: number;
  sourceDurationSeconds: number;
  tempoRatio: number;
  signal?: AbortSignal;
}

export interface RouletteTimeStretchProcessor {
  prepare(request: RouletteTimeStretchRequest): Promise<AudioBuffer>;
  cancel(): void;
  dispose(): void;
}

interface WorkerSuccess {
  requestId: number;
  ok: true;
  channels: Float32Array[];
  sampleRate: number;
}

interface WorkerFailure {
  requestId: number;
  ok: false;
  error: string;
}

type WorkerResponse = WorkerSuccess | WorkerFailure;

function abortError(): DOMException {
  return new DOMException('Roulette tempo preparation cancelled.', 'AbortError');
}

function extractChannels(
  buffer: AudioBuffer,
  offsetSeconds: number,
  durationSeconds: number,
): Float32Array[] {
  const startFrame = Math.max(0, Math.min(buffer.length, Math.round(offsetSeconds * buffer.sampleRate)));
  const requestedFrames = Math.max(1, Math.round(durationSeconds * buffer.sampleRate));
  const endFrame = Math.min(buffer.length, startFrame + requestedFrames);
  if (endFrame <= startFrame) throw new Error('Roulette tempo preparation window is outside the decoded stem.');

  return Array.from({ length: buffer.numberOfChannels }, (_, channelIndex) => (
    buffer.getChannelData(channelIndex).slice(startFrame, endFrame)
  ));
}

function createAudioBuffer(
  context: AudioContext,
  channels: Float32Array[],
  sampleRate: number,
): AudioBuffer {
  if (channels.length === 0 || channels[0].length === 0) {
    throw new Error('Roulette tempo processor returned an empty buffer.');
  }
  const output = context.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((channel, index) => output.copyToChannel(channel, index));
  return output;
}

/**
 * Owns one cancellable worker at a time. Stopping or replacing Roulette audio
 * terminates the worker immediately so stale preparation cannot commit audio.
 */
export function createRouletteTimeStretchProcessor(): RouletteTimeStretchProcessor {
  let activeWorker: Worker | null = null;
  let activeReject: ((reason?: unknown) => void) | null = null;
  let sequence = 0;

  const cancel = () => {
    const worker = activeWorker;
    activeWorker = null;
    worker?.terminate();
    const reject = activeReject;
    activeReject = null;
    reject?.(abortError());
  };

  const prepare = async (request: RouletteTimeStretchRequest): Promise<AudioBuffer> => {
    cancel();
    if (request.signal?.aborted) throw abortError();
    if (typeof Worker === 'undefined') {
      throw new Error('Roulette pitch-preserving tempo sync is unavailable in this runtime.');
    }

    const channels = extractChannels(request.buffer, request.offsetSeconds, request.sourceDurationSeconds);
    const requestId = ++sequence;
    const worker = new Worker(new URL('./rouletteTimeStretch.worker.ts', import.meta.url), { type: 'module' });
    activeWorker = worker;

    return new Promise<AudioBuffer>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (activeWorker === worker) activeWorker = null;
        if (activeReject === rejectPending) activeReject = null;
        request.signal?.removeEventListener('abort', onAbort);
        worker.terminate();
      };
      const rejectPending = (reason?: unknown) => {
        if (settled) return;
        settled = true;
        finish();
        reject(reason);
      };
      const onAbort = () => rejectPending(abortError());
      activeReject = rejectPending;
      request.signal?.addEventListener('abort', onAbort, { once: true });

      worker.onerror = () => rejectPending(new Error('Roulette pitch-preserving tempo processor failed to initialize.'));
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        if (response.requestId !== requestId || settled) return;
        if ('error' in response) {
          rejectPending(new Error(`Roulette tempo processor failed: ${response.error}`));
          return;
        }
        try {
          const output = createAudioBuffer(request.context, response.channels, response.sampleRate);
          settled = true;
          finish();
          resolve(output);
        } catch (error) {
          rejectPending(error);
        }
      };

      worker.postMessage({
        requestId,
        channels,
        sampleRate: request.buffer.sampleRate,
        tempoRatio: request.tempoRatio,
      }, { transfer: channels.map((channel) => channel.buffer) });
    });
  };

  return {
    prepare,
    cancel,
    dispose: cancel,
  };
}
