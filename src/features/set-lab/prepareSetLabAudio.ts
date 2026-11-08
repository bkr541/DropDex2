import { readBoundedAudioBytes } from '../../lib/audio/audioSourceLoader';
import type { DecodedAudioCache } from '../../lib/audio/decodedAudioCache';
import { trackIdentityKey } from '../../lib/preview/trackIdentity';
import { fetchTracksByIds } from '../../lib/queries/rekordbox';
import { probeSetLabAudio } from './audioProbe';
import { assertSetLabDecodeDuration, resolveSetLabAudio, SET_LAB_AUDIO_LIMITS, type SetLabAudioSource, type SetLabSourceDependencies } from './setLabSources';
import type { SetLabFiveSlots, SetLabScope, SetLabSlot } from './session';

export interface PreparedSetLabClip {
  buffer: AudioBuffer;
  /** A fractional sample offset when the requested start lies between samples. */
  offsetSeconds: number;
  durationMs: number;
  source: SetLabAudioSource['kind'];
}

export const setLabPcmBytes = (buffer: AudioBuffer) => buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;

function assertDecodedAudio(decoded: AudioBuffer): void {
  if ((decoded.numberOfChannels !== 1 && decoded.numberOfChannels !== 2) || setLabPcmBytes(decoded) > SET_LAB_AUDIO_LIMITS.trackPcmBytes) {
    throw new Error('The decoded track exceeds the mono/stereo audio preparation limits.');
  }
}

/** Verify and decode one authorized source, inside the shared preparation queue. */
export async function decodeSetLabSource(
  context: BaseAudioContext,
  media: SetLabAudioSource['media'],
  signal: AbortSignal,
  { probe = probeSetLabAudio, readBytes = readBoundedAudioBytes, requiredEndMs }: {
    probe?: typeof probeSetLabAudio;
    readBytes?: typeof readBoundedAudioBytes;
    requiredEndMs?: number;
  } = {},
): Promise<AudioBuffer> {
  signal.throwIfAborted();
  const durationMs = await probe(media, signal);
  signal.throwIfAborted();
  assertSetLabDecodeDuration(durationMs, context.sampleRate);
  if (requiredEndMs != null && durationMs + 1 < requiredEndMs) {
    throw new Error('The audio source ends before the selected section ends.');
  }
  const bytes = await readBytes(media, { maxBytes: SET_LAB_AUDIO_LIMITS.encodedBytes, signal });
  signal.throwIfAborted();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(bytes);
  } catch {
    signal.throwIfAborted();
    throw new Error('Web Audio could not decode the source.');
  }
  signal.throwIfAborted();
  assertDecodedAudio(decoded);
  return decoded;
}

/** Copy just the samples covering the exact source interval, without resampling or padding it. */
export function extractSetLabClip(
  context: AudioContext,
  decoded: AudioBuffer,
  slot: SetLabSlot,
  source: SetLabAudioSource['kind'],
  availableBytes: number,
): PreparedSetLabClip {
  const { startMs, endMs } = slot.section;
  const { sampleRate, length, numberOfChannels } = decoded;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs
    || !Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isSafeInteger(length) || length <= 0) {
    throw new Error('The selected section or decoded timing is invalid.');
  }
  assertDecodedAudio(decoded);
  if (endMs / 1000 > length / sampleRate + 1e-9) {
    throw new Error('Decoded audio ends before the selected section ends.');
  }
  const startSample = Math.floor(startMs / 1000 * sampleRate);
  const endSample = Math.min(length, Math.ceil(endMs / 1000 * sampleRate));
  const count = endSample - startSample;
  if (count <= 0) throw new Error('The selected section contains no decoded samples.');
  if (count * numberOfChannels * Float32Array.BYTES_PER_ELEMENT > availableBytes) {
    throw new Error('The five selected sections exceed the 80 MiB preview memory limit. Try shorter sections.');
  }

  const buffer = context.createBuffer(numberOfChannels, count, sampleRate);
  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    buffer.getChannelData(channel).set(decoded.getChannelData(channel).subarray(startSample, endSample));
  }
  return {
    buffer, source, durationMs: endMs - startMs,
    offsetSeconds: Math.max(0, startMs / 1000 - startSample / sampleRate),
  };
}

interface PrepareRequest extends SetLabScope {
  slots: SetLabFiveSlots;
  context: AudioContext;
  cache: DecodedAudioCache<PreparedSetLabClip>;
  signal: AbortSignal;
  importDeviceName?: string | null;
}

type PrepareDependencies = SetLabSourceDependencies & {
  getTracks?: typeof fetchTracksByIds;
  probe?: typeof probeSetLabAudio;
  readBytes?: typeof readBoundedAudioBytes;
};

// decodeAudioData cannot be interrupted. Hold the preparation turn until the
// decoder settles, even when a route change or cancellation discards its result.
let preparationTurn: Promise<unknown> = Promise.resolve();

export function queueSetLabAudioPreparation<T>(prepare: () => Promise<T>): Promise<T> {
  const turn = preparationTurn.then(prepare);
  preparationTurn = turn.then(() => undefined, () => undefined);
  return turn;
}

export function prepareSetLabAudio(input: PrepareRequest, dependencies: PrepareDependencies): Promise<PreparedSetLabClip[]> {
  return queueSetLabAudioPreparation(() => prepare(input, dependencies));
}

async function prepare(
  { userId, sourceImportId, slots, context, cache, signal, importDeviceName }: PrepareRequest,
  { getTracks = fetchTracksByIds, probe = probeSetLabAudio, readBytes = readBoundedAudioBytes, ...sources }: PrepareDependencies,
): Promise<PreparedSetLabClip[]> {
  signal.throwIfAborted();
  const rows = await getTracks(slots.map((slot) => slot.trackId), signal);
  signal.throwIfAborted();
  const tracks = new Map(rows.map((track) => [track.id, track]));
  const scope = { userId, sourceImportId };
  const clips: PreparedSetLabClip[] = [];
  let retainedBytes = 0;

  for (const slot of slots) {
    signal.throwIfAborted();
    const track = tracks.get(slot.trackId);
    if (!track || track.import_id !== sourceImportId || trackIdentityKey(track) !== slot.trackIdentityKey) {
      throw new Error(`Slot ${slot.position} no longer resolves to its saved track in the active import.`);
    }
    const label = `Slot ${slot.position} · ${track.title}`;
    const cacheKey = JSON.stringify([userId, sourceImportId, slot.trackId, slot.trackIdentityKey, slot.section.startMs, slot.section.endMs]);
    const clip = await cache.getOrCreate(cacheKey, async () => {
      const selected = await resolveSetLabAudio({ scope, track, importDeviceName, signal }, sources, async ({ kind, media }) => {
        const decoded = await decodeSetLabSource(context, media, signal, { probe, readBytes, requiredEndMs: slot.section.endMs });
        return {
          ok: true,
          value: extractSetLabClip(context, decoded, slot, kind, SET_LAB_AUDIO_LIMITS.setPcmBytes - retainedBytes),
        };
      });
      if (selected.ok === true) return selected.value;
      const details = selected.attempts.map(({ source, explanation }) =>
        `${source === 'local' ? 'Local' : 'Cloud'} audio: ${explanation}`).join(' ');
      throw new Error(`${label} could not be prepared. ${details}`);
    });
    signal.throwIfAborted();
    retainedBytes += setLabPcmBytes(clip.buffer);
    if (retainedBytes > SET_LAB_AUDIO_LIMITS.setPcmBytes) {
      throw new Error('The five selected sections exceed the 80 MiB preview memory limit. Try shorter sections.');
    }
    clips.push(clip);
  }
  return clips;
}
