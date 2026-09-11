import { describe, expect, it } from 'vitest';
import type { RekordboxTrack } from '../../types';
import { cueAnalysisLabel, cueAnalysisReady, cueFeatureExplicitlyCompleted, cueSourceCompletenessError } from './cueReadiness';

function track(overrides: Partial<RekordboxTrack> = {}): RekordboxTrack {
  return {
    id: 'track-1',
    import_id: 'import-1',
    rekordbox_content_id: 'content-1',
    title: 'Track',
    artist: null,
    album: null,
    remixer: null,
    genre: null,
    label: null,
    musical_key: null,
    camelot_key: null,
    normalized_key_name: null,
    key_tonic: null,
    key_mode: null,
    bpm: null,
    duration_seconds: null,
    rating: null,
    comments: null,
    file_path: null,
    file_format: null,
    date_added: null,
    created_at: '2026-08-26T00:00:00Z',
    master_db_id: null,
    master_content_id: null,
    analysis_data_file_path: null,
    analysed_bits: null,
    cue_update_count: null,
    analysis_data_update_count: null,
    information_update_count: null,
    analysis_reused_from_track_id: null,
    analysis_parse_status: 'completed',
    analysis_parse_warnings: [],
    ...overrides,
  };
}

describe('Cue Points analysis readiness', () => {
  it('lets an explicit non-completed cue feature override a completed overall status', () => {
    const value = track({ analysis_feature_statuses: { cues: 'failed' } });
    expect(cueAnalysisReady(value)).toBe(false);
    expect(cueAnalysisLabel(value)).toBe('Cue Failed');
    expect(cueSourceCompletenessError(value)).toMatch(/reconciliation is failed/i);
  });

  it('lets an explicit non-completed cue feature override reused overall status', () => {
    const value = track({
      analysis_parse_status: 'reused',
      analysis_feature_statuses: { cues: 'queued' },
    });
    expect(cueAnalysisReady(value)).toBe(false);
    expect(cueAnalysisLabel(value)).toBe('Cue Queued');
  });

  it('keeps legacy completed/reused rows ready when no cue-specific failure is recorded', () => {
    expect(cueAnalysisReady(track())).toBe(true);
    expect(cueAnalysisReady(track({ analysis_parse_status: 'reused', analysis_feature_statuses: {} }))).toBe(true);
  });

  it('still requires a final overall checkpoint even when cues are completed', () => {
    const value = track({
      analysis_parse_status: 'partial',
      analysis_feature_statuses: { cues: 'completed' },
    });
    expect(cueAnalysisReady(value)).toBe(false);
    expect(cueAnalysisLabel(value)).toBe('Partial');
  });

  it('passes readiness for ANLZ-only cue parse where no database cue rows exist', () => {
    // source_db_present=false / source_anlz_present=true tracks have no DjmdCue DB row.
    // Readiness is determined by analysis_feature_statuses.cues on the track row, not by
    // the presence or count of rekordbox_cues rows. A successful ANLZ-only parse that
    // records cues='completed' must be ready for display and editing.
    const anlzOnly = track({ analysis_feature_statuses: { cues: 'completed' } });
    expect(cueAnalysisReady(anlzOnly)).toBe(true);
    expect(cueAnalysisLabel(anlzOnly)).toBe('Ready');
  });

  it('cueFeatureExplicitlyCompleted is true only when cues=completed is set on the track', () => {
    expect(cueFeatureExplicitlyCompleted(track({ analysis_feature_statuses: { cues: 'completed' } }))).toBe(true);
    expect(cueFeatureExplicitlyCompleted(track())).toBe(false);
    expect(cueFeatureExplicitlyCompleted(track({ analysis_feature_statuses: {} }))).toBe(false);
    expect(cueFeatureExplicitlyCompleted(track({ analysis_feature_statuses: { cues: 'failed' } }))).toBe(false);
    expect(cueFeatureExplicitlyCompleted(track({ analysis_feature_statuses: { cues: 'queued' } }))).toBe(false);
  });

  it('cueFeatureExplicitlyCompleted false for legacy completed rows with no feature status', () => {
    // Legacy tracks analyzed before cues feature status was recorded must not be
    // filtered as if they are anlz-complete; backward-compatible behavior must apply.
    expect(cueFeatureExplicitlyCompleted(track({ analysis_parse_status: 'completed' }))).toBe(false);
    expect(cueFeatureExplicitlyCompleted(track({ analysis_parse_status: 'reused' }))).toBe(false);
  });

  it('passes readiness when EXT is absent and DAT-only parse succeeds', () => {
    // A DAT-only ANLZ parse can fully complete cue analysis; EXT is optional.
    // When the backend records cues='completed' after a DAT-only parse, the track must
    // be ready — absence of EXT is not a failure condition for cue readiness.
    const datOnly = track({ analysis_feature_statuses: { cues: 'completed' } });
    expect(cueAnalysisReady(datOnly)).toBe(true);
  });
});
