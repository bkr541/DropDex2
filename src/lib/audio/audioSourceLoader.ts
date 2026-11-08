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

/** Read one authorized source with a byte cap, even when a response has no Content-Length. */
export async function readBoundedAudioBytes(
  source: { kind: 'file'; file: Pick<File, 'size' | 'stream'> } | { kind: 'url'; url: string },
  { maxBytes, signal, fetchImpl = fetch }: { maxBytes: number; signal: AbortSignal; fetchImpl?: typeof fetch },
): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  const oversize = () => new Error(`The audio file exceeds the ${Math.round(maxBytes / (1024 * 1024))} MiB preparation limit.`);
  let body: ReadableStream<Uint8Array>;
  if (source.kind === 'file') {
    if (source.file.size > maxBytes) throw oversize();
    body = source.file.stream();
  } else {
    let response: Response;
    try {
      response = await fetchImpl(source.url, { cache: 'no-store', signal });
    } catch {
      signal.throwIfAborted();
      throw new Error('Could not read audio from the authorized source.');
    }
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`Could not read audio from the authorized source (HTTP ${response.status}).`);
    }
    body = response.body;
    if (Number(response.headers.get('content-length')) > maxBytes) {
      void body.cancel().catch(() => undefined);
      throw oversize();
    }
  }
  const reader = body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw oversize();
      chunks.push(value);
    }
    signal.throwIfAborted();
    if (size === 0) throw new Error('The audio response is empty.');
    const buffer = new ArrayBuffer(size);
    const output = new Uint8Array(buffer);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return buffer;
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}
