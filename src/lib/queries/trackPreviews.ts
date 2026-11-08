import { supabase } from '../supabase';

export const PREVIEW_BUCKET = 'track-previews';

export interface PreviewState {
  status: 'ready' | 'failed';
  sourceSize: number | null;
  sourceMtimeMs: number | null;
}

export interface PreviewRowInput {
  identityKey: string;
  trackId: string;
  storagePath: string;
  sizeBytes: number;
  durationMs: number | null;
  bitrateKbps: number;
  sampleRate: number;
  channels: number;
  sourceSize: number;
  sourceMtimeMs: number;
}

const PAGE = 1000;

/** Every preview the user already has, by track identity, so a sync can skip unchanged tracks and the list can show what is synced. */
export async function fetchPreviewStates(): Promise<Map<string, PreviewState>> {
  const states = new Map<string, PreviewState>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('track_previews')
      .select('identity_key, status, source_size_bytes, source_mtime')
      .order('identity_key')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { identity_key: string; status: 'ready' | 'failed'; source_size_bytes: number | string | null; source_mtime: string | null }[]) {
      states.set(row.identity_key, {
        status: row.status,
        sourceSize: row.source_size_bytes == null ? null : Number(row.source_size_bytes),
        sourceMtimeMs: row.source_mtime ? Date.parse(row.source_mtime) : null,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return states;
}

export async function uploadPreviewFile(storagePath: string, bytes: Uint8Array): Promise<void> {
  const { error } = await supabase.storage.from(PREVIEW_BUCKET).upload(storagePath, bytes, { contentType: 'audio/mp4', upsert: true });
  if (error) throw new Error(error.message);
}

export async function savePreviewRow(userId: string, row: PreviewRowInput): Promise<void> {
  const { error } = await supabase.from('track_previews').upsert({
    user_id: userId,
    identity_key: row.identityKey,
    track_id: row.trackId,
    storage_path: row.storagePath,
    container: 'm4a',
    codec: 'aac',
    bitrate_kbps: row.bitrateKbps,
    sample_rate: row.sampleRate,
    channels: row.channels,
    duration_ms: row.durationMs,
    size_bytes: row.sizeBytes,
    source_size_bytes: row.sourceSize,
    source_mtime: new Date(row.sourceMtimeMs).toISOString(),
    status: 'ready',
    error: null,
  }, { onConflict: 'user_id,identity_key' });
  if (error) throw new Error(error.message);
}

export interface CloudPreview {
  /** A temporary link to the preview file, good for an hour. */
  url: string;
  durationMs: number | null;
}

const PREVIEW_LINK_SECONDS = 60 * 60;

/**
 * The DropDex Cloud preview for a track, ready to play, or null when this user has not synced one.
 * Only the signed-in user's own previews are visible, since both the table and the storage bucket are protected per user.
 */
export async function fetchPreviewPlayback(
  identityKey: string,
  options?: { userId: string; signal?: AbortSignal },
): Promise<CloudPreview | null> {
  options?.signal?.throwIfAborted();
  let query = supabase
    .from('track_previews')
    .select('storage_path, duration_ms')
    .eq('identity_key', identityKey)
    .eq('status', 'ready');
  if (options) query = query.eq('user_id', options.userId);
  if (options?.signal) query = query.abortSignal(options.signal);
  const { data, error } = await query.maybeSingle();
  options?.signal?.throwIfAborted();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as { storage_path: string; duration_ms: number | null };
  if (options) {
    const [owner, filename, ...extra] = row.storage_path.split('/');
    if (owner !== options.userId || !/^[a-f0-9]{32}\.m4a$/.test(filename ?? '') || extra.length > 0) {
      throw new Error('The preview object does not match the requested account.');
    }
  }
  const signed = await supabase.storage.from(PREVIEW_BUCKET).createSignedUrl(row.storage_path, PREVIEW_LINK_SECONDS);
  options?.signal?.throwIfAborted();
  if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message ?? 'The preview link could not be created.');
  return { url: signed.data.signedUrl, durationMs: row.duration_ms };
}
