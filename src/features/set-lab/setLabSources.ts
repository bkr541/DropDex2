import type { UsbConnectionContextValue, UsbTrackSource } from '../../contexts/UsbConnectionContext';
import { trackIdentityKey } from '../../lib/preview/trackIdentity';
import { fetchPreviewPlayback } from '../../lib/queries/trackPreviews';
import { resolveUsbPath } from '../../lib/rekordbox/usbPathResolver';
import type { RekordboxTrack } from '../../types';
import type { SetLabScope } from './session';

const MIB = 1024 * 1024;
export const SET_LAB_AUDIO_LIMITS = {
  sampleRate: 44_100,
  encodedBytes: 96 * MIB,
  trackDurationMs: 8 * 60_000,
  trackPcmBytes: 192 * MIB,
  setPcmBytes: 80 * MIB,
} as const;

export function assertSetLabDecodeDuration(durationMs: number, sampleRate: number = SET_LAB_AUDIO_LIMITS.sampleRate): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('The audio duration could not be verified.');
  if (durationMs > SET_LAB_AUDIO_LIMITS.trackDurationMs
    || Math.ceil(durationMs / 1000 * sampleRate) * 2 * Float32Array.BYTES_PER_ELEMENT > SET_LAB_AUDIO_LIMITS.trackPcmBytes) {
    throw new Error('The source exceeds the eight-minute or decoded stereo preparation limit.');
  }
}

export type SetLabMediaTrack = Pick<RekordboxTrack,
  'id' | 'import_id' | 'duration_ms' | 'duration_seconds' | 'file_path' | 'file_path_normalized'
  | 'file_path_volume' | 'title' | 'artist' | 'rekordbox_content_id' | 'master_db_id' | 'master_content_id'
>;

export interface SetLabAudioSource {
  kind: 'local' | 'cloud';
  media: UsbTrackSource;
}

export interface SetLabSourceDependencies {
  usb: Pick<UsbConnectionContextValue, 'status' | 'volumeName' | 'resolveTrackSource'>;
  fetchCloudPreview?: typeof fetchPreviewPlayback;
}

type SourceIssue = {
  reason: 'unavailable' | 'path' | 'volume-mismatch' | 'resolve-failed' | 'unreadable' | 'too-short';
  explanation: string;
};
type Checked<T> = { ok: true; value: T } | ({ ok: false } & SourceIssue);
export type SetLabSourceFailure = SourceIssue & { source: SetLabAudioSource['kind'] };

interface SourceRequest {
  scope: SetLabScope;
  track: SetLabMediaTrack;
  importDeviceName?: string | null;
  signal?: AbortSignal;
}

async function localSource(
  { track, importDeviceName, signal }: SourceRequest, usb: SetLabSourceDependencies['usb'],
): Promise<Checked<UsbTrackSource>> {
  if (usb.status !== 'connected') {
    return { ok: false, reason: 'unavailable', explanation: 'The authorized USB or local root is not connected.' };
  }
  const raw = resolveUsbPath(track.file_path);
  if (raw.status !== 'ok' && raw.status !== 'empty_path') {
    return { ok: false, reason: 'path', explanation: `The Rekordbox file path is unavailable (${raw.status}).` };
  }
  const portable = resolveUsbPath(track.file_path_normalized);
  const path = portable.status === 'ok' ? portable : raw;
  if (path.status !== 'ok') return { ok: false, reason: 'path', explanation: 'This track has no usable local file path.' };

  // A Windows drive letter is an import hint, not a volume name.
  const storedVolume = track.file_path_volume?.trim();
  const pathVolume = raw.strippedVolume || (storedVolume && !/^[a-z]:?$/i.test(storedVolume) ? storedVolume : null);
  if ([importDeviceName?.trim(), pathVolume, path.strippedVolume].some((name) => name && name !== usb.volumeName)) {
    return { ok: false, reason: 'volume-mismatch', explanation: 'Connect the Rekordbox volume that contains this track.' };
  }

  let resolved;
  try {
    resolved = await usb.resolveTrackSource(path.segments, { isCancelled: () => signal?.aborted ?? false });
  } catch {
    signal?.throwIfAborted();
    return { ok: false, reason: 'resolve-failed', explanation: 'Could not resolve the file inside the authorized local root.' };
  }
  signal?.throwIfAborted();
  if (resolved.ok === false) return { ok: false, reason: 'resolve-failed', explanation: resolved.error.message };
  if (resolved.source.kind === 'url' && !/^dropdex-media:\/\/track\//.test(resolved.source.url)) {
    return { ok: false, reason: 'path', explanation: 'The local resolver did not return an authorized DropDex media URL.' };
  }
  return { ok: true, value: resolved.source };
}

/** Local root first, then this account’s private preview. A caller must verify each resolved candidate. */
export async function resolveSetLabAudio<T>(
  request: SourceRequest,
  { usb, fetchCloudPreview = fetchPreviewPlayback }: SetLabSourceDependencies,
  verify: (source: SetLabAudioSource) => Promise<Checked<T>>,
): Promise<
  { ok: true; source: SetLabAudioSource; value: T }
  | { ok: false; attempts: SetLabSourceFailure[] }
> {
  const { scope, track, signal } = request;
  signal?.throwIfAborted();
  if (!scope.userId || !scope.sourceImportId || track.import_id !== scope.sourceImportId) {
    throw new Error('The audio source is outside the active Set Lab account or import.');
  }
  const attempts: SetLabSourceFailure[] = [];

  async function check(kind: SetLabAudioSource['kind'], resolved: Checked<UsbTrackSource>) {
    signal?.throwIfAborted();
    if (resolved.ok === false) {
      attempts.push({ source: kind, reason: resolved.reason, explanation: resolved.explanation });
      return null;
    }
    const media = resolved.value;
    const source = { kind, media };
    let result: Checked<T>;
    try {
      const size = media.kind === 'file' ? media.file.size : media.size;
      if (size != null && size <= 0) throw new Error('The audio source is empty.');
      if (size != null && size > SET_LAB_AUDIO_LIMITS.encodedBytes) throw new Error('The source exceeds the 96 MiB preparation limit.');
      result = await verify(source);
    } catch (error) {
      signal?.throwIfAborted();
      result = {
        ok: false, reason: 'unreadable',
        explanation: error instanceof Error ? error.message : 'The audio source could not be read.',
      };
    }
    signal?.throwIfAborted();
    if (result.ok === true) return { ok: true as const, source, value: result.value };
    attempts.push({ source: kind, reason: result.reason, explanation: result.explanation });
    return null;
  }

  const local = await check('local', await localSource(request, usb));
  if (local) return local;
  signal?.throwIfAborted();

  let cloud: Checked<UsbTrackSource>;
  try {
    const preview = await fetchCloudPreview(trackIdentityKey(track), { userId: scope.userId, signal });
    cloud = preview ? { ok: true, value: { kind: 'url', url: preview.url } }
      : { ok: false, reason: 'unavailable', explanation: 'This track has no ready DropDex Cloud preview for this account.' };
  } catch {
    signal?.throwIfAborted();
    cloud = { ok: false, reason: 'resolve-failed', explanation: 'Could not access this account’s DropDex Cloud preview.' };
  }
  return await check('cloud', cloud) ?? { ok: false, attempts };
}
