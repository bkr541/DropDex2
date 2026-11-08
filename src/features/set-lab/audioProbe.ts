import type { UsbTrackSource } from '../../contexts/UsbConnectionContext';

/** Confirm that the platform can load media data, then immediately release the probe. */
export function probeSetLabAudio(source: UsbTrackSource, signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const audio = new Audio();
    const blobUrl = source.kind === 'file' ? URL.createObjectURL(source.file) : null;
    const timeout = setTimeout(() => fail(new Error('Audio source took too long to respond.')), 8000);

    function release() {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      audio.removeEventListener('loadeddata', onData);
      audio.removeEventListener('error', onError);
      audio.removeAttribute('src');
      audio.load();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
    function fail(error: unknown) {
      release();
      reject(error);
    }
    function onAbort() {
      fail(signal?.reason);
    }
    function onError() {
      fail(new Error('The audio source could not be read or uses an unsupported format.'));
    }
    function onData() {
      const durationMs = audio.duration * 1000;
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        fail(new Error('The audio source has no finite playback duration.'));
        return;
      }
      release();
      resolve(durationMs);
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    audio.addEventListener('loadeddata', onData, { once: true });
    audio.addEventListener('error', onError, { once: true });
    audio.preload = 'auto'; // Metadata alone can succeed before the first playable frame.
    audio.src = source.kind === 'url' ? source.url : blobUrl!;
  });
}
