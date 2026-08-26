import { describe, expect, it } from 'vitest';
import type { CueLoadState } from '../queries/analysisData';
import { cueFilterMatches, cueLoadCount, cueLoadOwnerMatches } from './cueLoadState';

const empty: CueLoadState = { status: 'loaded-empty', trackId: 'empty', cues: [] };
const loaded: CueLoadState = {
  status: 'loaded-with-cues',
  trackId: 'loaded',
  cues: [{
    id: 'cue-1',
    import_id: 'imp-1',
    track_id: 'loaded',
    rekordbox_cue_id: null,
    dedupe_key: 'db:1',
    cue_family: 'memory',
    cue_family_authority: 'anlz',
    hot_cue_slot: null,
    point_type: 'cue',
    source_kind: '0',
    start_ms: 1000,
    end_ms: null,
    color_table_index: null,
    color_hex: null,
    color_name: null,
    comment: null,
    is_active_loop: false,
    beat_loop_numerator: null,
    beat_loop_denominator: null,
    source_db_present: true,
    source_anlz_present: true,
    source_conflict: false,
  }],
};
const failed: CueLoadState = { status: 'failed', trackId: 'failed', error: 'timeout', retryable: true };
const loading: CueLoadState = { status: 'loading', trackId: 'loading' };

describe('cue summary filter semantics', () => {
  it('classifies only successful loaded states as Has cues / No cues', () => {
    expect(cueFilterMatches(loaded, 'with-cues')).toBe(true);
    expect(cueFilterMatches(empty, 'with-cues')).toBe(false);
    expect(cueFilterMatches(failed, 'with-cues')).toBe(false);
    expect(cueFilterMatches(loading, 'with-cues')).toBe(false);

    expect(cueFilterMatches(empty, 'without-cues')).toBe(true);
    expect(cueFilterMatches(loaded, 'without-cues')).toBe(false);
    expect(cueFilterMatches(failed, 'without-cues')).toBe(false);
    expect(cueFilterMatches(loading, 'without-cues')).toBe(false);
  });

  it('keeps unresolved states visible in All while withholding a fake count', () => {
    expect(cueFilterMatches(failed, 'all')).toBe(true);
    expect(cueFilterMatches(loading, 'all')).toBe(true);
    expect(cueLoadCount(failed)).toBeNull();
    expect(cueLoadCount(loading)).toBeNull();
    expect(cueLoadCount(empty)).toBe(0);
    expect(cueLoadCount(loaded)).toBe(1);
  });
});


describe('cue baseline request ownership', () => {
  const owner = { trackId: 'track-a', userId: 'user-a' };

  it('accepts only the same selected track and authenticated user', () => {
    expect(cueLoadOwnerMatches(owner, 'track-a', 'user-a')).toBe(true);
    expect(cueLoadOwnerMatches(owner, 'track-b', 'user-a')).toBe(false);
    expect(cueLoadOwnerMatches(owner, 'track-a', 'user-b')).toBe(false);
  });

  it('invalidates a pending response when selection is cleared or user signs out', () => {
    expect(cueLoadOwnerMatches(owner, null, 'user-a')).toBe(false);
    expect(cueLoadOwnerMatches(owner, 'track-a', null)).toBe(false);
    expect(cueLoadOwnerMatches(null, 'track-a', 'user-a')).toBe(false);
  });
});
