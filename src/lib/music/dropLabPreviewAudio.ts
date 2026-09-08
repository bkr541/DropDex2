import { loadDecodedAudioSources, type ResolvedAudioSourceResult } from '../audio/audioSourceLoader';
import type { DecodedAudioCache } from '../audio/decodedAudioCache';
import type { UsbFileResolutionError } from '../usb/resolveUsbFile';

export interface DropLabDecodedPair {
  source: AudioBuffer;
  candidate: AudioBuffer;
}

export interface DropLabAudioRequest {
  cacheKey: string;
  pathSegments: string[];
}

export type DropLabAudioResolver = (
  pathSegments: string[],
  options: { isCancelled?: () => boolean },
) => Promise<ResolvedAudioSourceResult<UsbFileResolutionError>>;

function mapDropLabResolveError(error: UsbFileResolutionError): Error {
  if (error.kind === 'abort') return new DOMException('Audio request aborted.', 'AbortError');
  return new Error('Connect the Rekordbox USB drive to preview this transition.');
}

/** Thin Drop Lab adapter over the reusable multi-source decode/cache boundary. */
export async function loadDropLabDecodedPair(
  input: { source: DropLabAudioRequest; candidate: DropLabAudioRequest },
  dependencies: {
    cache: DecodedAudioCache<AudioBuffer>;
    resolveSource: DropLabAudioResolver;
    getAudioContext: () => AudioContext;
    isCancelled?: () => boolean;
    fetchImpl?: typeof fetch;
  },
): Promise<DropLabDecodedPair> {
  const [source, candidate] = await loadDecodedAudioSources(
    [input.source, input.candidate],
    {
      ...dependencies,
      mapResolveError: mapDropLabResolveError,
    },
  );
  return { source, candidate };
}
