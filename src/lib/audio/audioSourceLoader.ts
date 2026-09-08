import type { DecodedAudioCache } from './decodedAudioCache';

export type ResolvedAudioSource =
  | { kind: 'file'; file: Pick<File, 'arrayBuffer'> }
  | { kind: 'url'; url: string };

export type ResolvedAudioSourceResult<TError = unknown> =
  | { ok: true; source: ResolvedAudioSource }
  | { ok: false; error: TError };

export interface DecodedAudioSourceRequest {
  cacheKey: string;
  pathSegments: string[];
}

export interface AudioSourceLoadDependencies<TError = unknown> {
  cache: DecodedAudioCache<AudioBuffer>;
  resolveSource: (
    pathSegments: string[],
    options: { isCancelled?: () => boolean },
  ) => Promise<ResolvedAudioSourceResult<TError>>;
  getAudioContext: () => AudioContext;
  isCancelled?: () => boolean;
  fetchImpl?: typeof fetch;
  mapResolveError?: (error: TError) => Error;
}

function abortError(): DOMException {
  return new DOMException('Audio request aborted.', 'AbortError');
}

function throwIfCancelled(isCancelled: (() => boolean) | undefined): void {
  if (isCancelled?.()) throw abortError();
}

async function readSourceBytes(
  source: ResolvedAudioSource,
  fetchImpl: typeof fetch,
): Promise<ArrayBuffer> {
  if (source.kind === 'file') return source.file.arrayBuffer();
  const response = await fetchImpl(source.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not stream audio (${response.status}).`);
  return response.arrayBuffer();
}

/**
 * Resolve and decode one or more media sources behind a shared feature-neutral
 * boundary. Requests can represent two decks, a preview pair, or any future
 * multi-source audio workflow without importing feature terminology here.
 */
export async function loadDecodedAudioSources<TError = unknown>(
  requests: DecodedAudioSourceRequest[],
  dependencies: AudioSourceLoadDependencies<TError>,
): Promise<AudioBuffer[]> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  return Promise.all(requests.map((request) => dependencies.cache.getOrCreate(
    request.cacheKey,
    async () => {
      throwIfCancelled(dependencies.isCancelled);
      const resolved = await dependencies.resolveSource(request.pathSegments, {
        isCancelled: dependencies.isCancelled,
      });
      throwIfCancelled(dependencies.isCancelled);
      if (!resolved.ok) {
        const failure = resolved as { ok: false; error: TError };
        throw dependencies.mapResolveError?.(failure.error)
          ?? new Error('Could not resolve audio source.');
      }

      const bytes = await readSourceBytes(resolved.source, fetchImpl);
      throwIfCancelled(dependencies.isCancelled);
      const decoded = await dependencies.getAudioContext().decodeAudioData(bytes.slice(0));
      throwIfCancelled(dependencies.isCancelled);
      return decoded;
    },
  )));
}
