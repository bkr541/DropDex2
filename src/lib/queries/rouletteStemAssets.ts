import { supabase } from '../supabase';
import type { RekordboxTrack } from '../../types';
import {
  STEM_ASSET_CONTRACT_VERSION,
  buildParentTrackSourceFingerprint,
  type StemAssetProcessingStatus,
  type StemAssetRecord,
  type StemAssetType,
} from '../../features/roulette/stemAssets';

const PARENT_SOURCE_SELECT = [
  'rekordbox_content_id',
  'file_path',
  'file_path_normalized',
  'file_size_bytes',
  'duration_ms',
  'duration_seconds',
  'sample_rate_hz',
].join(',');

export interface RegisterStemAssetRecordInput {
  trackId: string;
  stemType: StemAssetType;
  status: StemAssetProcessingStatus;
  storageLocator?: string | null;
  sourceFingerprint: string;
  separatorVersion?: string | null;
  durationMs?: number | null;
  sampleRateHz?: number | null;
  channelCount?: number | null;
  fileSizeBytes?: number | null;
  fileMtimeMs?: number | null;
  failureCode?: string | null;
  failureMessage?: string | null;
}

export interface StemAssetRepository {
  getAsset(trackId: string, stemType: StemAssetType): Promise<StemAssetRecord | null>;
  getAssets(trackId: string): Promise<StemAssetRecord[]>;
  getCurrentSourceFingerprint(trackId: string): Promise<string>;
  upsertAsset(input: RegisterStemAssetRecordInput): Promise<StemAssetRecord>;
  updateStatus(
    trackId: string,
    stemType: StemAssetType,
    status: StemAssetProcessingStatus,
    updates?: Partial<Pick<
      StemAssetRecord,
      | 'storage_locator'
      | 'separator_version'
      | 'duration_ms'
      | 'sample_rate_hz'
      | 'channel_count'
      | 'file_size_bytes'
      | 'file_mtime_ms'
      | 'failure_code'
      | 'failure_message'
      | 'source_fingerprint'
    >>,
  ): Promise<StemAssetRecord>;
  deleteAsset(trackId: string, stemType: StemAssetType): Promise<void>;
}

export async function fetchStemAsset(
  trackId: string,
  stemType: StemAssetType,
): Promise<StemAssetRecord | null> {
  const { data, error } = await supabase
    .from('roulette_stem_assets')
    .select('*')
    .eq('track_id', trackId)
    .eq('stem_type', stemType)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as StemAssetRecord | null;
}

export async function fetchStemAssets(trackId: string): Promise<StemAssetRecord[]> {
  const { data, error } = await supabase
    .from('roulette_stem_assets')
    .select('*')
    .eq('track_id', trackId)
    .order('stem_type');
  if (error) throw new Error(error.message);
  return (data ?? []) as StemAssetRecord[];
}

export async function fetchCurrentStemSourceFingerprint(trackId: string): Promise<string> {
  const { data, error } = await supabase
    .from('rekordbox_tracks')
    .select(PARENT_SOURCE_SELECT)
    .eq('id', trackId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Parent Rekordbox track was not found.');
  return buildParentTrackSourceFingerprint(data as unknown as RekordboxTrack);
}

export async function upsertStemAsset(
  input: RegisterStemAssetRecordInput,
): Promise<StemAssetRecord> {
  const row = {
    track_id: input.trackId,
    stem_type: input.stemType,
    status: input.status,
    storage_locator: input.storageLocator ?? null,
    source_fingerprint: input.sourceFingerprint,
    separator_version: input.separatorVersion ?? null,
    contract_version: STEM_ASSET_CONTRACT_VERSION,
    duration_ms: input.durationMs ?? null,
    sample_rate_hz: input.sampleRateHz ?? null,
    channel_count: input.channelCount ?? null,
    file_size_bytes: input.fileSizeBytes ?? null,
    file_mtime_ms: input.fileMtimeMs ?? null,
    failure_code: input.failureCode ?? null,
    failure_message: input.failureMessage ?? null,
  };
  const { data, error } = await supabase
    .from('roulette_stem_assets')
    .upsert(row, { onConflict: 'track_id,stem_type' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as StemAssetRecord;
}

export async function updateStemAssetStatus(
  trackId: string,
  stemType: StemAssetType,
  status: StemAssetProcessingStatus,
  updates: Partial<Pick<
    StemAssetRecord,
    | 'storage_locator'
    | 'separator_version'
    | 'duration_ms'
    | 'sample_rate_hz'
    | 'channel_count'
    | 'file_size_bytes'
    | 'file_mtime_ms'
    | 'failure_code'
    | 'failure_message'
    | 'source_fingerprint'
  >> = {},
): Promise<StemAssetRecord> {
  const { data, error } = await supabase
    .from('roulette_stem_assets')
    .update({ status, ...updates })
    .eq('track_id', trackId)
    .eq('stem_type', stemType)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as StemAssetRecord;
}

export async function deleteStemAssetRecord(
  trackId: string,
  stemType: StemAssetType,
): Promise<void> {
  const { error } = await supabase
    .from('roulette_stem_assets')
    .delete()
    .eq('track_id', trackId)
    .eq('stem_type', stemType);
  if (error) throw new Error(error.message);
}

export const rouletteStemAssetRepository: StemAssetRepository = {
  getAsset: fetchStemAsset,
  getAssets: fetchStemAssets,
  getCurrentSourceFingerprint: fetchCurrentStemSourceFingerprint,
  upsertAsset: upsertStemAsset,
  updateStatus: updateStemAssetStatus,
  deleteAsset: deleteStemAssetRecord,
};
