import type { RekordboxTrack } from '../../types';
import { previewStoragePath } from '../preview/trackIdentity';
import { supabase } from '../supabase';

export const PREVIEW_BUCKET = 'track-previews';

export interface PreviewState {
  status: 'ready' | 'failed';
  sourceSize: number | null;
  sourceMtimeMs: number | null;
  pendingRemoval?: boolean;
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
const PENDING_REMOVAL = 'pending_removal';

export interface CloudTrack extends RekordboxTrack {
  cloudPreview: { id: string; userId: string; identityKey: string; status: PreviewState['status'] };
}

interface CloudTrackRow {
  id: string;
  identity_key: string;
  status: PreviewState['status'];
  duration_ms: number | null;
  created_at: string;
  track: RekordboxTrack | null;
}

function toCloudTrack(row: CloudTrackRow, userId: string): CloudTrack {
  const track: RekordboxTrack = row.track ?? {
    id: row.id, import_id: '', rekordbox_content_id: '',
    title: 'Cloud track ' + row.id.slice(0, 8), artist: null, album: null, remixer: null, genre: null, label: null,
    musical_key: null, camelot_key: null, normalized_key_name: null, key_tonic: null, key_mode: null,
    bpm: null, duration_seconds: null, rating: null, comments: null, file_path: null, file_format: 'M4A', date_added: null,
    created_at: row.created_at, master_db_id: null, master_content_id: null, analysis_data_file_path: null,
    analysed_bits: null, cue_update_count: null, analysis_data_update_count: null, information_update_count: null,
    analysis_reused_from_track_id: null, analysis_parse_status: null, analysis_parse_warnings: [],
  };
  return {
    ...track,
    duration_ms: row.duration_ms ?? track.duration_ms,
    cloudPreview: { id: row.id, userId, identityKey: row.identity_key, status: row.status },
  };
}

export async function fetchCloudTracks(userId: string, signal: AbortSignal): Promise<CloudTrack[]> {
  const tracks: CloudTrack[] = [];
  for (let from = 0; ; from += PAGE) {
    signal.throwIfAborted();
    const { data, error } = await supabase
      .from('track_previews')
      .select('id, identity_key, status, duration_ms, created_at, track:rekordbox_tracks!track_previews_track_id_fkey(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + PAGE - 1)
      .abortSignal(signal);
    signal.throwIfAborted();
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as CloudTrackRow[];
    for (const row of rows) tracks.push(toCloudTrack(row, userId));
    if (rows.length < PAGE) return tracks;
  }
}

/** Mark the copy unavailable before removing its file, so an interrupted removal can be retried. */
export async function deleteCloudTrack({ id, userId, identityKey }: CloudTrack['cloudPreview']): Promise<void> {
  const path = await previewStoragePath(userId, identityKey);
  const target = { id, user_id: userId, identity_key: identityKey };
  const { data, error } = await supabase
    .from('track_previews')
    .update({ status: 'failed', error: PENDING_REMOVAL })
    .match(target)
    .select('storage_path, updated_at')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  if (data.storage_path !== path) throw new Error('The preview file does not match the selected track.');

  const { error: storageError } = await supabase.storage.from(PREVIEW_BUCKET).remove([path]);
  if (storageError) throw new Error(storageError.message);

  const { data: deleted, error: deleteError } = await supabase
    .from('track_previews')
    .delete()
    .match({ ...target, updated_at: data.updated_at })
    .select('id')
    .maybeSingle();
  if (deleteError) throw new Error(deleteError.message);
  if (!deleted) throw new Error('The Cloud copy changed while it was being deleted. Try again.');
}

/** Every preview the user already has, by track identity, so a sync can skip unchanged tracks and the list can show what is synced. */
export async function fetchPreviewStates(signal?: AbortSignal): Promise<Map<string, PreviewState>> {
  const states = new Map<string, PreviewState>();
  for (let from = 0; ; from += PAGE) {
    signal?.throwIfAborted();
    const query = supabase
      .from('track_previews')
      .select('identity_key, status, source_size_bytes, source_mtime, error')
      .order('identity_key')
      .range(from, from + PAGE - 1);
    const { data, error } = await (signal ? query.abortSignal(signal) : query);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { identity_key: string; status: 'ready' | 'failed'; source_size_bytes: number | string | null; source_mtime: string | null; error: string | null }[]) {
      states.set(row.identity_key, {
        status: row.status,
        sourceSize: row.source_size_bytes == null ? null : Number(row.source_size_bytes),
        sourceMtimeMs: row.source_mtime ? Date.parse(row.source_mtime) : null,
        pendingRemoval: row.error === PENDING_REMOVAL,
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
