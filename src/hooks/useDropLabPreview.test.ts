import { describe, expect, it } from 'vitest';
import { getDropLabPreviewPrerequisiteReason } from '../lib/music/dropLabPreviewPrerequisites';
import type { DropLabTimeSegment } from '../lib/music/dropLabSegments';
import type { RekordboxTrack } from '../types';

const segment: DropLabTimeSegment = {
  startMs: 10_000,
  endMs: 20_000,
  durationMs: 10_000,
  timingSource: 'beat-grid',
};

function track(id: string, filePath = `/Contents/Artist/${id}.flac`): RekordboxTrack {
  return {
    id,
    import_id: 'import-1',
    rekordbox_content_id: id,
    title: id,
    artist: 'Artist',
    file_path: filePath,
  } as RekordboxTrack;
}

describe('Drop Lab preview prerequisites', () => {
  it('returns null for a connected USB and two playable cue windows', () => {
    expect(getDropLabPreviewPrerequisiteReason({
      sourceTrack: track('source'),
      candidateTrack: track('candidate'),
      sourceSegment: segment,
      candidateSegment: segment,
      usbStatus: 'connected',
    })).toBeNull();
  });

  it('keeps preparation state separate from prerequisites so loading cannot retrigger the loader effect', () => {
    const reason = getDropLabPreviewPrerequisiteReason({
      sourceTrack: track('source'),
      candidateTrack: track('candidate'),
      sourceSegment: segment,
      candidateSegment: segment,
      usbStatus: 'connected',
    });
    expect(reason).not.toBe('Preparing source and candidate audio…');
    expect(reason).toBeNull();
  });

  it('blocks preparation when the candidate or its cue window is missing', () => {
    expect(getDropLabPreviewPrerequisiteReason({
      sourceTrack: track('source'),
      candidateTrack: null,
      sourceSegment: segment,
      candidateSegment: null,
      usbStatus: 'connected',
    })).toBe('Choose a candidate');
  });

  it('surfaces USB connection state before decoding starts', () => {
    expect(getDropLabPreviewPrerequisiteReason({
      sourceTrack: track('source'),
      candidateTrack: track('candidate'),
      sourceSegment: segment,
      candidateSegment: segment,
      usbStatus: 'permission-required',
    })).toBe('Connect USB to preview');
  });

  it('rejects tracks whose Rekordbox path cannot be resolved safely', () => {
    expect(getDropLabPreviewPrerequisiteReason({
      sourceTrack: track('source', '/Contents/../source.flac'),
      candidateTrack: track('candidate'),
      sourceSegment: segment,
      candidateSegment: segment,
      usbStatus: 'connected',
    })).toBe('Audio path unavailable');
  });
});
