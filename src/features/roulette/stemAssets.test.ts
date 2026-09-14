import { describe, expect, it } from 'vitest';
import {
  STEM_ASSET_CONTRACT_VERSION,
  buildParentTrackSourceFingerprint,
  isStemAssetMetadataCurrent,
  rouletteStatusForStem,
  stemTypeForRole,
  type StemAssetRecord,
} from './stemAssets';

const asset: StemAssetRecord = {
  id: 'asset-1',
  track_id: 'track-1',
  stem_type: 'vocals',
  installation_id: 'installation-1',
  status: 'ready',
  storage_locator: 'user/track/vocals.wav',
  source_fingerprint: 'source-a',
  separator_version: 'separator-v1',
  contract_version: STEM_ASSET_CONTRACT_VERSION,
  duration_ms: 120000,
  sample_rate_hz: 48000,
  channel_count: 2,
  file_size_bytes: 1024,
  file_mtime_ms: 1234,
  failure_code: null,
  failure_message: null,
  created_at: '2026-09-08T00:00:00Z',
  updated_at: '2026-09-08T00:00:00Z',
};

describe('Roulette stem asset contract', () => {
  it('maps stable Roulette roles to canonical stem types and readiness states', () => {
    expect(stemTypeForRole('vocal')).toBe('vocals');
    expect(stemTypeForRole('instrumental')).toBe('instrumental');
    expect(rouletteStatusForStem('pending')).toBe('preparing');
    expect(rouletteStatusForStem('processing')).toBe('preparing');
    expect(rouletteStatusForStem('ready')).toBe('ready');
    expect(rouletteStatusForStem('failed')).toBe('failed');
  });

  it('builds the parent-source identity from media fields, not musical metadata', () => {
    const source = {
      rekordbox_content_id: 'content-7',
      file_path: '/Contents/A.wav',
      file_path_normalized: '/contents/a.wav',
      file_size_bytes: 1200,
      duration_ms: 90000,
      duration_seconds: 90,
      sample_rate_hz: 48000,
    };
    expect(buildParentTrackSourceFingerprint(source)).toBe(
      'rekordbox-source-v1:["content-7","/contents/a.wav",1200,90000,48000]',
    );
  });

  it('rejects stale parent, contract, and separator metadata deterministically', () => {
    expect(isStemAssetMetadataCurrent(asset, 'source-b')).toMatchObject({
      current: false,
      code: 'source_fingerprint_mismatch',
    });
    expect(isStemAssetMetadataCurrent(
      { ...asset, contract_version: 2 },
      'source-a',
    )).toMatchObject({ current: false, code: 'contract_version_mismatch' });
    expect(isStemAssetMetadataCurrent(asset, 'source-a', {
      expectedSeparatorVersion: 'separator-v2',
    })).toMatchObject({ current: false, code: 'separator_version_mismatch' });
  });
});
