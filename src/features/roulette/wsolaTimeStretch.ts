export interface WsolaTimeStretchInput {
  channels: Float32Array[];
  sampleRate: number;
  tempoRatio: number;
}

export interface WsolaTimeStretchResult {
  channels: Float32Array[];
  sampleRate: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildAnalysisChannel(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const analysis = new Float32Array(channels[0].length);
  const scale = 1 / channels.length;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      analysis[index] += channel[index] * scale;
    }
  }
  return analysis;
}

function normalizedCorrelation(
  reference: Float32Array,
  candidate: Float32Array,
  referenceStart: number,
  candidateStart: number,
  length: number,
  stride: number,
): number {
  let dot = 0;
  let referenceEnergy = 0;
  let candidateEnergy = 0;
  for (let index = 0; index < length; index += stride) {
    const left = reference[referenceStart + index] ?? 0;
    const right = candidate[candidateStart + index] ?? 0;
    dot += left * right;
    referenceEnergy += left * left;
    candidateEnergy += right * right;
  }
  const denominator = Math.sqrt(referenceEnergy * candidateEnergy);
  return denominator > 1e-12 ? dot / denominator : -1;
}

function chooseAnalysisPosition(
  referenceOutput: Float32Array,
  analysisChannel: Float32Array,
  outputPosition: number,
  expectedInputPosition: number,
  overlapLength: number,
  frameLength: number,
  searchRadius: number,
): number {
  const maximumStart = Math.max(0, analysisChannel.length - frameLength);
  const expected = clamp(Math.round(expectedInputPosition), 0, maximumStart);
  const searchStart = Math.max(0, expected - searchRadius);
  const searchEnd = Math.min(maximumStart, expected + searchRadius);
  const stride = 4;
  let bestPosition = expected;
  let bestScore = Number.NEGATIVE_INFINITY;

  // Search in small steps first, then refine around the winner. The source
  // samples are never resampled, so this changes timing without changing pitch.
  for (let candidate = searchStart; candidate <= searchEnd; candidate += 8) {
    const score = normalizedCorrelation(
      referenceOutput,
      analysisChannel,
      outputPosition,
      candidate,
      overlapLength,
      stride,
    );
    if (score > bestScore) {
      bestScore = score;
      bestPosition = candidate;
    }
  }

  const refineStart = Math.max(searchStart, bestPosition - 8);
  const refineEnd = Math.min(searchEnd, bestPosition + 8);
  for (let candidate = refineStart; candidate <= refineEnd; candidate += 1) {
    const score = normalizedCorrelation(
      referenceOutput,
      analysisChannel,
      outputPosition,
      candidate,
      overlapLength,
      stride,
    );
    if (score > bestScore) {
      bestScore = score;
      bestPosition = candidate;
    }
  }

  return bestPosition;
}

/**
 * Pitch-preserving Waveform Similarity Overlap-Add (WSOLA) time stretch.
 * This is intentionally used only for Roulette's bounded preview window and is
 * executed off the renderer thread by rouletteTimeStretch.worker.ts.
 */
export function wsolaTimeStretch(input: WsolaTimeStretchInput): WsolaTimeStretchResult {
  const { channels, sampleRate, tempoRatio } = input;
  if (channels.length === 0) throw new Error('WSOLA requires at least one audio channel.');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('WSOLA requires a valid sample rate.');
  if (!Number.isFinite(tempoRatio) || tempoRatio <= 0) throw new Error('WSOLA requires a positive tempo ratio.');

  const inputLength = channels[0].length;
  if (inputLength === 0) return { channels: channels.map(() => new Float32Array()), sampleRate };
  if (channels.some((channel) => channel.length !== inputLength)) {
    throw new Error('WSOLA channel lengths must match.');
  }
  if (Math.abs(tempoRatio - 1) <= 1e-6) {
    return { channels: channels.map((channel) => channel.slice()), sampleRate };
  }

  const outputLength = Math.max(1, Math.round(inputLength / tempoRatio));
  const nominalFrameLength = Math.round(sampleRate * 0.046);
  const frameLength = Math.min(inputLength, Math.max(512, nominalFrameLength + (nominalFrameLength % 2)));
  const overlapLength = Math.max(128, Math.floor(frameLength / 2));
  const synthesisHop = Math.max(1, frameLength - overlapLength);
  const analysisHop = synthesisHop * tempoRatio;
  const searchRadius = Math.max(32, Math.round(sampleRate * 0.012));
  const outputs = channels.map(() => new Float32Array(outputLength));

  const analysisChannel = buildAnalysisChannel(channels);
  const analysisOutput = new Float32Array(outputLength);
  const firstLength = Math.min(frameLength, outputLength, inputLength);
  analysisOutput.set(analysisChannel.subarray(0, firstLength), 0);
  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    outputs[channelIndex].set(channels[channelIndex].subarray(0, firstLength), 0);
  }

  let outputPosition = synthesisHop;
  let expectedInputPosition = analysisHop;

  while (outputPosition < outputLength) {
    const inputPosition = chooseAnalysisPosition(
      analysisOutput,
      analysisChannel,
      outputPosition,
      expectedInputPosition,
      Math.min(overlapLength, outputLength - outputPosition),
      frameLength,
      searchRadius,
    );
    const writableLength = Math.min(frameLength, outputLength - outputPosition, inputLength - inputPosition);
    if (writableLength <= 0) break;
    const crossfadeLength = Math.min(overlapLength, writableLength);

    // Maintain a mono correlation surface using exactly the same WSOLA splice.
    // This keeps stereo search stable even when one side is silent or sparse.
    for (let index = 0; index < crossfadeLength; index += 1) {
      const fadeIn = (index + 1) / (crossfadeLength + 1);
      const fadeOut = 1 - fadeIn;
      analysisOutput[outputPosition + index] = (
        analysisOutput[outputPosition + index] * fadeOut
        + analysisChannel[inputPosition + index] * fadeIn
      );
    }
    for (let index = crossfadeLength; index < writableLength; index += 1) {
      analysisOutput[outputPosition + index] = analysisChannel[inputPosition + index];
    }

    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const source = channels[channelIndex];
      const output = outputs[channelIndex];
      for (let index = 0; index < crossfadeLength; index += 1) {
        const fadeIn = (index + 1) / (crossfadeLength + 1);
        const fadeOut = 1 - fadeIn;
        output[outputPosition + index] = (
          output[outputPosition + index] * fadeOut
          + source[inputPosition + index] * fadeIn
        );
      }
      for (let index = crossfadeLength; index < writableLength; index += 1) {
        output[outputPosition + index] = source[inputPosition + index];
      }
    }

    outputPosition += synthesisHop;
    expectedInputPosition += analysisHop;
  }

  return { channels: outputs, sampleRate };
}
