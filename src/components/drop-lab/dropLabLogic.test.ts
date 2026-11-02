import { describe, expect, it } from 'vitest';
import type { DropLabCandidate } from '../../hooks/useDropLabFlipPicks';
import type { DropLabTrackAnalysis } from '../../hooks/useDropLabAnalysis';
import type { RekordboxTrack } from '../../types';
import { arrangeCandidates } from './arrangeCandidates';
import { candidateStatus, matchTone } from './candidateStatus';
import { dropLabTrackStats } from './dropLabTrackStats';
import { percentageAt, visibleSpan } from './dropLabTimeline';
import { dropSideForPointer, isDropLabTrackDrag, resolveDropLabLoad, DROP_LAB_TRACK_MIME } from './dropLabDrag';

function candidate(id: string, title: string, overrides: Partial<RekordboxTrack> = {}, score = 100): DropLabCandidate {
  return {
    track: { id, title, artist: `${title} Artist`, bpm: 150, camelot_key: '5B', ...overrides } as RekordboxTrack,
    score,
    matchLabel: 'Good Match',
    reasons: [],
  };
}

function analysis(waveform: string, dropCount: number): DropLabTrackAnalysis {
  return {
    trackId: 't',
    beatGrid: null,
    cues: [],
    phrases: [],
    waveformState: { status: waveform, trackId: 't' } as DropLabTrackAnalysis['waveformState'],
    durationMs: 1000,
    durationSource: 'track',
    dropPoints: Array.from({ length: dropCount }, () => ({}) as never),
  };
}

describe('dropSideForPointer', () => {
  const rect = { left: 100, width: 400 };
  it('loads a build on the left half and a drop on the right half', () => {
    expect(dropSideForPointer(120, rect)).toBe('build');
    expect(dropSideForPointer(299, rect)).toBe('build');
    expect(dropSideForPointer(300, rect)).toBe('drop');
    expect(dropSideForPointer(480, rect)).toBe('drop');
  });

  it('splits at the swap line when the timeline is zoomed, not at the middle', () => {
    expect(dropSideForPointer(200, rect, 0.1)).toBe('drop');
    expect(dropSideForPointer(110, rect, 0.1)).toBe('build');
    expect(dropSideForPointer(480, rect, 1.4)).toBe('build');
    expect(dropSideForPointer(120, rect, -0.2)).toBe('drop');
  });

  it('treats an unmeasured timeline as a drop', () => {
    expect(dropSideForPointer(10, { left: 0, width: 0 })).toBe('drop');
  });
});

describe('isDropLabTrackDrag', () => {
  it('only accepts drags that carry a Drop Lab track', () => {
    expect(isDropLabTrackDrag([DROP_LAB_TRACK_MIME, 'text/plain'])).toBe(true);
    expect(isDropLabTrackDrag(['Files'])).toBe(false);
    expect(isDropLabTrackDrag(null)).toBe(false);
  });
});

describe('resolveDropLabLoad', () => {
  it('Load As Drop makes the track the active candidate', () => {
    expect(resolveDropLabLoad('drop', 'b', 'a', 'c')).toEqual({ kind: 'set-candidate', trackId: 'b' });
  });

  it('does nothing when the track is already the active candidate or the selected track', () => {
    expect(resolveDropLabLoad('drop', 'c', 'a', 'c')).toEqual({ kind: 'none' });
    expect(resolveDropLabLoad('build', 'a', 'a', 'c')).toEqual({ kind: 'none' });
  });

  it('Load As Build makes the track the selected track and keeps the active candidate', () => {
    expect(resolveDropLabLoad('build', 'b', 'a', 'c')).toEqual({ kind: 'set-source', sourceTrackId: 'b', candidateTrackId: 'c' });
  });

  it('Load As Build drops the candidate when the new build is that same track', () => {
    expect(resolveDropLabLoad('build', 'c', 'a', 'c')).toEqual({ kind: 'set-source', sourceTrackId: 'c', candidateTrackId: null });
    expect(resolveDropLabLoad('build', 'b', null, null)).toEqual({ kind: 'set-source', sourceTrackId: 'b', candidateTrackId: null });
  });
});

describe('arrangeCandidates', () => {
  const list = [
    candidate('1', 'Charlie', { bpm: 148 }, 200),
    candidate('2', 'alpha', { bpm: 152, camelot_key: '10A' }, 150),
    candidate('3', 'Bravo', { bpm: null }, 120),
  ];

  it('keeps the best-match order when nothing is sorted', () => {
    expect(arrangeCandidates(list, '', null).map((c) => c.track.id)).toEqual(['1', '2', '3']);
  });

  it('searches title and artist without regard to case', () => {
    expect(arrangeCandidates(list, 'ALPHA', null).map((c) => c.track.id)).toEqual(['2']);
    expect(arrangeCandidates(list, 'bravo artist', null).map((c) => c.track.id)).toEqual(['3']);
    expect(arrangeCandidates(list, 'nothing', null)).toEqual([]);
  });

  it('sorts by title, tempo, key and match, with missing values last', () => {
    expect(arrangeCandidates(list, '', { column: 'title', direction: 'asc' }).map((c) => c.track.id)).toEqual(['2', '3', '1']);
    expect(arrangeCandidates(list, '', { column: 'bpm', direction: 'asc' }).map((c) => c.track.id)).toEqual(['1', '2', '3']);
    expect(arrangeCandidates(list, '', { column: 'bpm', direction: 'desc' }).map((c) => c.track.id)).toEqual(['2', '1', '3']);
    expect(arrangeCandidates(list, '', { column: 'match', direction: 'asc' }).map((c) => c.track.id)).toEqual(['3', '2', '1']);
    expect(arrangeCandidates(list, '', { column: 'key', direction: 'asc' }).map((c) => c.track.id)).toEqual(['1', '3', '2']);
  });

  it('does not change the list it was given', () => {
    arrangeCandidates(list, '', { column: 'title', direction: 'desc' });
    expect(list.map((c) => c.track.id)).toEqual(['1', '2', '3']);
  });
});

describe('candidateStatus', () => {
  it('is ready only when the waveform, a drop and the USB are all there', () => {
    expect(candidateStatus(analysis('loaded', 1), true)).toEqual({ tone: 'ready', text: 'Ready to preview' });
  });

  it('does not claim a track is ready while the USB is not connected', () => {
    expect(candidateStatus(analysis('loaded', 1), false)).toEqual({ tone: 'warning', text: 'Connect USB to preview' });
  });

  it('reports a missing drop, and waveform problems, before anything else', () => {
    expect(candidateStatus(analysis('loaded', 0), true).text).toBe('Missing drop');
    expect(candidateStatus(analysis('error', 1), true)).toEqual({ tone: 'error', text: 'Waveform failed' });
    expect(candidateStatus(analysis('invalid', 1), true)).toEqual({ tone: 'error', text: 'Invalid waveform' });
    expect(candidateStatus(analysis('loading', 1), true)).toEqual({ tone: 'warning', text: 'Loading waveform' });
    expect(candidateStatus(analysis('unavailable', 1), true).text).toBe('Missing waveform');
    expect(candidateStatus(undefined, true).text).toBe('Missing waveform');
  });
});

describe('dropLabTrackStats', () => {
  it('formats BPM with two decimals and the key as a padded Camelot code in its own color', () => {
    const stats = dropLabTrackStats({ bpm: 150, camelot_key: '5B', rating: 0 } as RekordboxTrack, null);
    expect(stats.map((s) => s.label)).toEqual(['BPM', 'Key', 'Rating', 'Drop']);
    expect(stats[0].value).toBe('150.00');
    expect(stats[1].value).toBe('05B');
    expect(stats[1].color).toBe('#16a34a');
    expect(stats[3].value).toBe('Unavailable');
  });

  it('describes the drop point when there is one', () => {
    const stats = dropLabTrackStats({ bpm: null, camelot_key: null, rating: 3 } as RekordboxTrack, { label: 'Chorus entrance', confidence: 'medium' } as never);
    expect(stats[0].value).toBe('—');
    expect(stats[3].value).toBe('Chorus entrance · medium');
  });
});

describe('matchTone', () => {
  it('colors the match badge from green for the best fit down to gray', () => {
    expect(matchTone('Strong Match')).toBe('success');
    expect(matchTone('Good Match')).toBe('active');
    expect(matchTone('Compatible')).toBe('amber');
    expect(matchTone('Experimental')).toBe('neutral');
  });
});

describe('timeline positions', () => {
  it('places a position as a percentage of the visible window', () => {
    expect(percentageAt(32, 0, 64)).toBe(50);
    expect(percentageAt(8, 16, 48)).toBe(-25);
    expect(percentageAt(56, 16, 48)).toBe(125);
  });

  it('keeps only the visible part of a section, so its name stays on screen', () => {
    expect(visibleSpan(0, 32, 0, 64)).toEqual({ leftPercent: 0, widthPercent: 50 });
    expect(visibleSpan(0, 32, 16, 48)).toEqual({ leftPercent: 0, widthPercent: 50 });
    expect(visibleSpan(32, 64, 16, 48)).toEqual({ leftPercent: 50, widthPercent: 50 });
    expect(visibleSpan(0, 32, 0, 8)).toEqual({ leftPercent: 0, widthPercent: 100 });
  });

  it('drops a section that is entirely off screen', () => {
    expect(visibleSpan(32, 64, 0, 16)).toBeNull();
    expect(visibleSpan(0, 32, 40, 56)).toBeNull();
  });
});
