import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { DropLabCandidate } from '../../hooks/useDropLabFlipPicks';
import type { DropLabTrackAnalysis } from '../../hooks/useDropLabAnalysis';
import type { WaveformSegment } from '../../lib/music/waveformSegments';
import type { RekordboxTrack } from '../../types';

vi.mock('../../contexts/AudioPlayerContext', () => ({ useAudioPlayer: () => ({ status: 'idle', playIntent: false, toggleTrack: vi.fn() }) }));

vi.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'dropdex', setTheme: vi.fn() }),
}));

let DropLabTrackHeader: typeof import('./DropLabTrackHeader').DropLabTrackHeader;
let DropLabWaveform: typeof import('./DropLabWaveform').DropLabWaveform;
let DropLabDock: typeof import('./DropLabControls').DropLabDock;
let DropLabControls: typeof import('./DropLabControls').DropLabControls;
let CandidateRotation: typeof import('./CandidateRotation').CandidateRotation;

beforeAll(async () => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  ({ DropLabTrackHeader } = await import('./DropLabTrackHeader'));
  ({ DropLabWaveform } = await import('./DropLabWaveform'));
  ({ DropLabDock, DropLabControls } = await import('./DropLabControls'));
  ({ CandidateRotation } = await import('./CandidateRotation'));
});

const track = (overrides: Partial<RekordboxTrack> = {}): RekordboxTrack => ({
  id: 't1', rekordbox_content_id: '1', title: 'Fixture Track', artist: 'Fixture Artist', bpm: 150, camelot_key: '5B', rating: 0, duration_ms: 240_000, ...overrides,
} as RekordboxTrack);

const segment = (): WaveformSegment => {
  const columns = Array.from({ length: 40 }, (_, i) => ({ h: 8 + (i % 7), i: 3 }));
  return {
    waveform: {
      trackId: 'w', previewFormat: null, previewColumnCount: 40, previewColumns: columns, previewColumnsValid: true,
      inferredFormat: 'mono', validationError: null, invalidReason: null, detailFormat: null, detailColumnCount: null,
      detailStorageBucket: null, detailStoragePath: null,
    } as unknown as WaveformSegment['waveform'],
    startMs: 0, endMs: 1000, durationMs: 1000, columns: columns as WaveformSegment['columns'], unavailableReason: null,
  };
};

const analysisFor = (id: string, waveform: string, drops: number): DropLabTrackAnalysis => ({
  trackId: id, beatGrid: null, cues: [], phrases: [],
  waveformState: { status: waveform, trackId: id } as DropLabTrackAnalysis['waveformState'],
  durationMs: 240_000, durationSource: 'track', dropPoints: Array.from({ length: drops }, () => ({}) as never),
});

describe('Drop Lab track headers', () => {
  it('shows the selected track in the Cue Points header style, with the stats beside the artist', () => {
    const markup = renderToStaticMarkup(createElement(DropLabTrackHeader, {
      label: 'Selected track', track: track({ artist: null }), dropPoint: null,
    }));
    expect(markup).toContain('data-testid="drop-lab-selected-header"');
    expect(markup).toContain('Selected track');
    expect(markup).toContain('Fixture Track');
    expect(markup).toContain('Artist Not Available');
    expect(markup).not.toContain('Artist not stored');
    expect(markup).toContain('150.00');
    expect(markup).toContain('>05B<');
    expect(markup).toContain('h-9 w-9');
    expect(markup.indexOf('Artist Not Available')).toBeLessThan(markup.indexOf('>BPM<'));
  });

  it('mirrors the layout for the active candidate: title, then stats beside the artist, artwork on the right', () => {
    const markup = renderToStaticMarkup(createElement(DropLabTrackHeader, {
      label: 'Active candidate', track: track(), dropPoint: null, side: 'right',
    }));
    expect(markup).toContain('data-testid="drop-lab-candidate-header"');
    expect(markup).toContain('justify-end');
    expect(markup.indexOf('<h2')).toBeLessThan(markup.indexOf('>BPM<'));
    expect(markup.indexOf('>BPM<')).toBeLessThan(markup.indexOf('Fixture Artist'));
    expect(markup.indexOf('Fixture Artist')).toBeLessThan(markup.indexOf('<img'));
  });
});

describe('Drop Lab timeline', () => {
  const render = (props: Partial<Parameters<typeof DropLabWaveform>[0]> = {}) => renderToStaticMarkup(createElement(DropLabWaveform, {
    sourceSegment: segment(), candidateSegment: segment(), barCount: 8, ...props,
  }));

  it('uses the shared Library timeline with all five rows', () => {
    const markup = render();
    expect(markup).toContain('data-testid="track-timeline"');
    expect([...markup.matchAll(/data-timeline-row="([a-z]+)"/g)].map((match) => match[1]))
      .toEqual(['sections', 'timestamps', 'cues', 'waveform', 'beats']);
    expect(markup).toContain('>Selected build<');
    expect(markup).toContain('>Candidate drop<');
  });

  it('draws the waveform with the shared filled Rekordbox renderer, one half per track', () => {
    const markup = render();
    expect(markup.match(/data-waveform-render-mode="area"/g)).toHaveLength(2);
    expect(markup.match(/data-waveform-appearance="rekordbox"/g)).toHaveLength(2);
    expect(markup.match(/data-waveform-status="loaded"/g)).toHaveLength(2);
  });

  it('takes its colors from the shared section colors for Build and Drop', () => {
    const markup = render();
    expect(markup).toContain('--section-ink:#8997AE');
    expect(markup).not.toContain('--section-ink:#F78361');
    expect(markup.match(/--section-ink:#8997AE/g)).toHaveLength(2);
  });

  it('draws dashed bar and beat lines over the waveform and a beat ruler under it', () => {
    const markup = render();
    expect(markup).toContain('border-dashed border-white/[0.10]');
    expect(markup).toContain('border-white/[0.035]');
    expect(markup.match(/track-timeline__beat-tick--bar/g)).toHaveLength(17);
    expect(markup).toContain('track-timeline__beat-tick');
    expect(markup).toContain('−8');
    expect(markup).toContain('>8<');
  });

  it('shows hover zoom buttons on the waveform, as Cue Points does, and a closed-out view at the start', () => {
    const markup = render();
    expect(markup).toContain('aria-label="Waveform zoom controls"');
    expect(markup).toContain('aria-label="Zoom in"');
    expect(markup).toContain('aria-label="Zoom out"');
    expect(markup).toContain('group-hover/waveform:opacity-100');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Zoom out"/);
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Zoom in"/);
    expect(markup).toContain('left:0%;width:50%');
  });

  it('no longer shows the blue cue marker, or the First and Then captions', () => {
    const markup = render();
    expect(markup).not.toContain('viewBox="0 0 28 32"');
    expect(markup).not.toContain('title="Automatic swap cue"');
    expect(markup).not.toContain('play the selected track');
    expect(markup).not.toContain('swap into the candidate drop');
    expect(markup).not.toMatch(/>First</);
    expect(markup).not.toMatch(/>Then</);
    expect(markup).toContain('Automatic swap cue · Candidate starts exactly on its detected drop');
    expect(markup).toContain('data-testid="drop-lab-timeline"');
  });

  it('shows the playhead whenever the preview has moved, including while paused', () => {
    expect(render({ previewProgress: 0.4 })).toContain('data-testid="drop-lab-playhead"');
    expect(render({ previewProgress: 0 })).not.toContain('data-testid="drop-lab-playhead"');
  });

  it('explains when a waveform is not available, and shows loading', () => {
    expect(render({ sourceSegment: null, unavailableMessage: 'Selected track has no waveform analysis.' })).toContain('Selected track has no waveform analysis.');
    expect(render({ loading: true })).toContain('animate-pulse');
  });
});

describe('Drop Lab audio dock and controls', () => {
  const dock = (overrides: Partial<Parameters<typeof DropLabDock>[0]> = {}) => renderToStaticMarkup(createElement(DropLabDock, {
    previewLabel: 'Play transition', previewDisabled: false, previewPlaying: false, previewLoading: false, previewError: false,
    previewProgress: 0.5, previewSeconds: 30, disabledReason: null, onPreview: vi.fn(), ...overrides,
  }));

  it('uses the shared dock band, a single-button transport capsule and a real progress bar', () => {
    const markup = dock();
    expect(markup).toContain('cue-audio-dock');
    expect(markup).toContain('dd-media-transport-group');
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain('type="range"');
    expect(markup).toContain('value="15"');
    expect(markup).toContain('0:15');
    expect(markup).toContain('0:30');
  });

  it('no longer shows the transport caption', () => {
    const markup = dock();
    expect(markup).not.toMatch(/transition transport/i);
    expect(markup).not.toContain('Swap at cue');
    expect(markup).not.toContain('Selected build');
  });

  it('no longer shows a status pill that can disagree with the warning above it', () => {
    const markup = dock({ previewDisabled: true, disabledReason: 'Connect USB to preview' });
    expect(markup).not.toMatch(/ready to audition/i);
    expect(markup).not.toContain('rounded-full border px-2.5');
    expect(markup).toContain('Play transition (Connect USB to preview)');
  });

  it('uses the underlined tab style for both option groups, and says nothing extra when blocked', () => {
    const props = {
      beatOffset: 0, barCount: 8, sourceDropPoints: [], candidateDropPoints: [], sourceDropId: null, candidateDropId: null,
      previewBlocked: false, onSourceDropChange: vi.fn(), onCandidateDropChange: vi.fn(), onBeatOffsetChange: vi.fn(), onBarCountChange: vi.fn(),
    } as Parameters<typeof DropLabControls>[0];
    const open = renderToStaticMarkup(createElement(DropLabControls, props));
    expect(open.match(/dd-tab-nav--primary/g)).toHaveLength(2);
    expect(open).not.toContain('dd-tab-nav--filter');
    expect(open).toContain('Press play to hear the build');
    const blocked = renderToStaticMarkup(createElement(DropLabControls, { ...props, previewBlocked: true }));
    expect(blocked).not.toContain('Press play to hear the build');
    expect(blocked).not.toContain('Connect USB');
  });
});

describe('Drop Lab candidate list', () => {
  const candidates: DropLabCandidate[] = [
    { track: track({ id: 'c1', title: 'First Candidate', artist: null }), score: 200, matchLabel: 'Strong Match', reasons: [{ label: 'Same BPM' }, { label: 'Same key' }] },
    { track: track({ id: 'c2', title: 'Second Candidate', camelot_key: '10A' }), score: 120, matchLabel: 'Compatible', reasons: [] },
  ];
  const analyses = new Map<string, DropLabTrackAnalysis>([
    ['c1', analysisFor('c1', 'loaded', 1)],
    ['c2', analysisFor('c2', 'loaded', 0)],
  ]);
  const render = (overrides: Partial<Parameters<typeof CandidateRotation>[0]> = {}) => renderToStaticMarkup(createElement(CandidateRotation, {
    candidates, analyses, activeCandidateId: 'c1', loading: false, usbReady: true, onLoadTrack: vi.fn(), ...overrides,
  }));

  it('is a Cue Points track table with a search row', () => {
    const markup = render();
    expect(markup).toContain('cue-browser__table');
    expect(markup).toContain('aria-label="Search candidates"');
    expect(markup).toContain('data-testid="drop-lab-candidate-filters"');
    expect(markup).toContain('2 candidates');
    expect(markup).toContain('aria-label="Sort by Track"');
    expect(markup).toContain('aria-label="Sort by Format"');
    expect(markup).not.toContain('Why it fits');
  });

  it('shows each row with a status dot, mini waveform, plain key and the app-wide missing-artist text', () => {
    const markup = render();
    expect(markup.match(/data-testid="drop-lab-candidate-row"/g)).toHaveLength(2);
    expect(markup).toContain('Artist Not Available');
    expect(markup).toContain('data-waveform-variant="compact"');
    expect(markup).toContain('>05B<');
    expect(markup).toContain('>10A<');
    expect(markup).toContain('aria-label="Play First Candidate"');
    expect(markup).toContain('aria-label="Actions for First Candidate"');
  });

  it('uses all eight record columns and provides the row Actions menu', () => {
    const markup = render();
    expect(markup.match(/<th [^>]*>/g)).toHaveLength(8);
    expect(markup).toContain('aria-label="Actions for First Candidate" aria-haspopup="menu"');
  });

  it('highlights the active row and has no radio circle', () => {
    const markup = render();
    expect(markup.match(/cue-browser__row--selected/g)).toHaveLength(1);
    expect(markup).not.toContain('rounded-full border border-white/25');
    expect(markup).not.toContain('CheckmarkFilled');
  });

  it('lets every row be dragged', () => {
    expect(render().match(/draggable="true"/g)).toHaveLength(2);
  });

  it('does not say a track is ready while the USB is not connected', () => {
    const markup = render({ usbReady: false });
    expect(markup).not.toContain('Ready to preview');
    expect(markup).toContain('Connect USB to preview');
    expect(render()).toContain('Ready to preview');
    expect(render()).toContain('Missing drop');
  });

  it('shows plain loading and empty states', () => {
    expect(render({ candidates: [], loading: true })).toContain('Finding candidates…');
    expect(render({ candidates: [] })).toContain('No compatible drop candidates were found for this track.');
  });
});
