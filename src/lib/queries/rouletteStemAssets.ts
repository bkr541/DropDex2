import { supabase } from '../supabase';
import type { RekordboxTrack } from '../../types';
import { getCurrentInstallationId } from '../desktop/installationIdentity';
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

export interface StemReadyPairOutputMetadata {
  locator: string;
  durationMs: number;
  sampleRateHz: number;
  channelCount: number;
  fileSizeBytes: number;
  fileMtimeMs: number;
}

export interface CommitStemReadyPairInput {
  trackId: string;
  sourceFingerprint: string;
  separatorVersion: string;
  vocals: StemReadyPairOutputMetadata;
  instrumental: StemReadyPairOutputMetadata;
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
  commitReadyPair(input: CommitStemReadyPairInput): Promise<StemAssetRecord[]>;
  deleteAsset(trackId: string, stemType: StemAssetType): Promise<void>;
  claimLegacyAsset?(assetId: string): Promise<StemAssetRecord>;
}

async function fetchScopedStemAsset(
  trackId: string,
  stemType: StemAssetType,
  installationId: string,
): Promise<StemAssetRecord | null> {
  const { data, error } = await supabase
    .from('roulette_stem_assets')
    .select('*')
    .eq('track_id', trackId)
    .eq('stem_type', stemType)
    .eq('installation_id', installationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as StemAssetRecord | null;
}

async function fetchLegacyStemAsset(
  trackId: string,
  stemType: StemAssetType,
): Promise<StemAssetRecord | null> {
  const { data, error } = await supabase
    .from('roulette_stem_assets')
    .select('*')
    .eq('track_id', trackId)
    .eq('stem_type', stemType)
    .is('installation_id', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as StemAssetRecord | null;
}

export async function fetchStemAsset(
  trackId: string,
  stemType: StemAssetType,
): Promise<StemAssetRecord | null> {
  const installationId = await getCurrentInstallationId();
  const scoped = await fetchScopedStemAsset(trackId, stemType, installationId);
  if (scoped) return scoped;
  return fetchLegacyStemAsset(trackId, stemType);
}

export async function fetchStemAssets(trackId: string): Promise<StemAssetRecord[]> {
  const installationId = await getCurrentInstallationId();
  const [scopedResult, legacyResult] = await Promise.all([
    supabase
      .from('roulette_stem_assets')
      .select('*')
      .eq('track_id', trackId)
      .eq('installation_id', installationId)
      .order('stem_type'),
    supabase
      .from('roulette_stem_assets')
      .select('*')
      .eq('track_id', trackId)
      .is('installation_id', null)
      .order('stem_type'),
  ]);
  if (scopedResult.error) throw new Error(scopedResult.error.message);
  if (legacyResult.error) throw new Error(legacyResult.error.message);

  const scoped = (scopedResult.data ?? []) as StemAssetRecord[];
  const legacy = (legacyResult.data ?? []) as StemAssetRecord[];
  const scopedTypes = new Set(scoped.map((row) => row.stem_type));
  return [...scoped, ...legacy.filter((row) => !scopedTypes.has(row.stem_type))]
    .sort((left, right) => left.stem_type.localeCompare(right.stem_type));
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
  const installationId = await getCurrentInstallationId();
  const row = {
    track_id: input.trackId,
    stem_type: input.stemType,
    installation_id: installationId,
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
    .upsert(row, { onConflict: 'track_id,stem_type,installation_id' })
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
  const installationId = await getCurrentInstallationId();
  const { data, error } = await supabase
    .from('roulette_stem_assets')
    .update({ status, ...updates })
    .eq('track_id', trackId)
    .eq('stem_type', stemType)
    .eq('installation_id', installationId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as StemAssetRecord;
}

export async function claimLegacyStemAsset(assetId: string): Promise<StemAssetRecord> {
  const installationId = await getCurrentInstallationId();
  const { data: legacyData, error: legacyError } = await supabase
    .from('roulette_stem_assets')
    .select('*')
    .eq('id', assetId)
    .is('installation_id', null)
    .single();
  if (legacyError) throw new Error(legacyError.message);

  const legacy = legacyData as StemAssetRecord;
  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...legacyFields } = legacy;
  const { data, error } = await supabase
    .from('roulette_stem_assets')
    .upsert(
      { ...legacyFields, installation_id: installationId },
      { onConflict: 'track_id,stem_type,installation_id' },
    )
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as StemAssetRecord;
}

export async function commitStemReadyPair(
  input: CommitStemReadyPairInput,
): Promise<StemAssetRecord[]> {
  const installationId = await getCurrentInstallationId();
  const { data, error } = await supabase.rpc('commit_roulette_stem_pair', {
    p_track_id: input.trackId,
    p_installation_id: installationId,
    p_source_fingerprint: input.sourceFingerprint,
    p_separator_version: input.separatorVersion,
    p_vocals_locator: input.vocals.locator,
    p_vocals_duration_ms: input.vocals.durationMs,
    p_vocals_sample_rate_hz: input.vocals.sampleRateHz,
    p_vocals_channel_count: input.vocals.channelCount,
    p_vocals_file_size_bytes: input.vocals.fileSizeBytes,
    p_vocals_file_mtime_ms: input.vocals.fileMtimeMs,
    p_instrumental_locator: input.instrumental.locator,
    p_instrumental_duration_ms: input.instrumental.durationMs,
    p_instrumental_sample_rate_hz: input.instrumental.sampleRateHz,
    p_instrumental_channel_count: input.instrumental.channelCount,
    p_instrumental_file_size_bytes: input.instrumental.fileSizeBytes,
    p_instrumental_file_mtime_ms: input.instrumental.fileMtimeMs,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as StemAssetRecord[];
  if (rows.length !== 2) throw new Error('Roulette stem pair commit did not return both canonical assets.');
  return rows;
}

export async function deleteStemAssetRecord(
  trackId: string,
  stemType: StemAssetType,
): Promise<void> {
  const installationId = await getCurrentInstallationId();
  const { error } = await supabase
    .from('roulette_stem_assets')
    .delete()
    .eq('track_id', trackId)
    .eq('stem_type', stemType)
    .eq('installation_id', installationId);
  if (error) throw new Error(error.message);
}

export const rouletteStemAssetRepository: StemAssetRepository = {
  getAsset: fetchStemAsset,
  getAssets: fetchStemAssets,
  getCurrentSourceFingerprint: fetchCurrentStemSourceFingerprint,
  upsertAsset: upsertStemAsset,
  updateStatus: updateStemAssetStatus,
  commitReadyPair: commitStemReadyPair,
  deleteAsset: deleteStemAssetRecord,
  claimLegacyAsset: claimLegacyStemAsset,
};
