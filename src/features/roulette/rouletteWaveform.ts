export type RouletteWaveformBuffer = Pick<
  AudioBuffer,
  'duration' | 'length' | 'numberOfChannels' | 'sampleRate' | 'getChannelData'
>;

/**
 * Extract a bounded, display-only peak envelope from the actual decoded stem.
 * Each visual bucket samples at most ~256 frames per channel so a multi-minute
 * track does not require a full PCM scan on the renderer thread.
 */
export function extractRouletteStemPeaks(
  buffer: RouletteWaveformBuffer,
  offsetSeconds: number,
  durationSeconds: number,
  pointCount = 180,
): number[] {
  if (
    !Number.isFinite(offsetSeconds) || offsetSeconds < 0
    || !Number.isFinite(durationSeconds) || durationSeconds <= 0
    || !Number.isInteger(pointCount) || pointCount <= 0
    || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0
    || buffer.length <= 0 || buffer.numberOfChannels <= 0
  ) return [];

  const startFrame = Math.max(0, Math.min(buffer.length, Math.floor(offsetSeconds * buffer.sampleRate)));
  const requestedEnd = Math.floor((offsetSeconds + durationSeconds) * buffer.sampleRate);
  const endFrame = Math.max(startFrame, Math.min(buffer.length, requestedEnd));
  const frameCount = endFrame - startFrame;
  if (frameCount <= 0) return [];

  const channels = Array.from(
    { length: buffer.numberOfChannels },
    (_, index) => buffer.getChannelData(index),
  );
  const raw = new Array<number>(pointCount).fill(0);
  let globalPeak = 0;

  for (let point = 0; point < pointCount; point += 1) {
    const bucketStart = startFrame + Math.floor((point * frameCount) / pointCount);
    const bucketEnd = startFrame + Math.floor(((point + 1) * frameCount) / pointCount);
    const bucketFrames = Math.max(1, bucketEnd - bucketStart);
    const stride = Math.max(1, Math.ceil(bucketFrames / 256));
    let peak = 0;

    for (let frame = bucketStart; frame < bucketEnd; frame += stride) {
      for (const channel of channels) {
        const amplitude = Math.abs(channel[frame] ?? 0);
        if (amplitude > peak) peak = amplitude;
      }
    }

    raw[point] = peak;
    if (peak > globalPeak) globalPeak = peak;
  }

  if (globalPeak <= 0) return raw;
  return raw.map((value) => Math.max(0, Math.min(1, value / globalPeak)));
}
