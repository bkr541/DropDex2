import { describe, expect, it } from 'vitest';
import type { RekordboxImport } from '../../types';
import {
  getImportProgress,
  getInFlightImport,
  isImportInFlight,
  isImportTerminal,
} from './importLifecycle';

function makeImport(overrides: Partial<RekordboxImport> = {}): RekordboxImport {
  return {
    id: 'import-1',
    user_id: 'user-1',
    source_filename: 'exportLibrary.db',
    source_type: 'onelibrary',
    database_version: null,
    device_name: 'USB',
    rekordbox_created_date: null,
    track_count: 100,
    playlist_count: 2,
    playlist_track_count: 120,
    status: 'processing',
    error_message: null,
    imported_at: '2026-07-22T00:00:00Z',
    source_bundle_type: 'usb_folder',
    analysis_status: 'parsing',
    analysis_expected_track_count: 100,
    analysis_matched_track_count: 100,
    analysis_parsed_track_count: 20,
    analysis_failed_track_count: 0,
    analysis_asset_count: 300,
    analysis_parser_version: null,
    analysis_completed_at: null,
    analysis_warnings: [],
    analysis_progress_processed_track_count: 24,
    analysis_progress_total_track_count: 100,
    analysis_current_track_id: null,
    analysis_current_track_title: null,
    analysis_current_track_artist: null,
    analysis_current_track_label: 'Current Track',
    analysis_progress_updated_at: '2026-07-22T00:01:00Z',
    ...overrides,
  };
}

describe('rekordbox import lifecycle', () => {
  it('never resurrects failed or cancelled jobs from a stale analysis state', () => {
    const stale = makeImport({ status: 'failed', analysis_status: 'parsing' });
    expect(isImportTerminal(stale)).toBe(true);
    expect(isImportInFlight(stale)).toBe(false);
  });

  it('keeps a completed snapshot visible while a deliberate analysis resume is running', () => {
    const resumed = makeImport({ status: 'completed', analysis_status: 'parsing' });
    expect(isImportTerminal(resumed)).toBe(true);
    expect(isImportInFlight(resumed)).toBe(true);
  });

  it('uses persisted progress when it is ahead of finalized parsed counts', () => {
    expect(getImportProgress(makeImport())).toEqual({
      processed: 24,
      total: 100,
      percent: 24,
      currentTrackLabel: 'Current Track',
    });
  });

  it('selects only a genuinely non-terminal import for the background banner', () => {
    const failed = makeImport({ id: 'failed', status: 'failed' });
    const processing = makeImport({ id: 'processing' });
    expect(getInFlightImport([failed, processing])?.id).toBe('processing');
  });
});
