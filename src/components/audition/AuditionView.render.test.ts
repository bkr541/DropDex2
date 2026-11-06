import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { TimelineSection } from '../../lib/music/phraseSections';

const libraryFixture = vi.hoisted(() => ({ tracks: [] as RekordboxTrack[], error: null as string | null }));

vi.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'dropdex', setTheme: vi.fn() }),
}));

vi.mock('../../contexts/UsbConnectionContext', () => ({
  useUsbConnection: () => ({
    status: 'connected',
    connect: vi.fn(),
    ensurePermission: vi.fn(),
    resolveTrackSource: vi.fn(),
  }),
}));

vi.mock('../../hooks/useRekordboxTracks', () => ({
  useLibraryStats: () => ({
    stats: {
      genreTotals: [{ name: 'House', count: 2 }],
      keyTotals: [{ name: '8A', count: 2 }],
      bpmTotals: [{ bpm: 128, count: 2 }],
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
  useLibraryTracks: () => ({
    tracks: libraryFixture.error ? [] : libraryFixture.tracks,
    total: libraryFixture.tracks.length,
    loading: false,
    loadingMore: false,
    error: libraryFixture.error,
    hasMore: false,
    loadMore: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('../../hooks/useTrackPreviewWaveforms', () => ({
  useTrackPreviewWaveforms: () => ({
    states: new Map(),
    loadingBatchCount: 0,
    retry: vi.fn(),
    getState: (trackId: string | null | undefined) => ({ status: 'idle', trackId: trackId ?? 'none' }),
  }),
}));

let AuditionView: typeof import('./AuditionView').AuditionView;
let AuditionTrackHeader: typeof import('./AuditionTrackHeader').AuditionTrackHeader;
let AuditionFullSong: typeof import('./AuditionFullSong').AuditionFullSong;
let AudioPlayerProvider: typeof import('../../contexts/AudioPlayerContext').AudioPlayerProvider;

const track = (overrides: Partial<RekordboxTrack>): RekordboxTrack => ({
  id: 't1', title: 'Fixture Title', artist: 'Fixture Artist', genre: 'House',
  bpm: 128, musical_key: '8A', duration_ms: 372_000, file_format: 'WAV',
  ...overrides,
} as RekordboxTrack);

const wrap = (child: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(AudioPlayerProvider, { imports: [], children: child }));

beforeAll(async () => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  ({ AuditionView } = await import('./AuditionView'));
  ({ AuditionTrackHeader } = await import('./AuditionTrackHeader'));
  ({ AuditionFullSong } = await import('./AuditionFullSong'));
  ({ AudioPlayerProvider } = await import('../../contexts/AudioPlayerContext'));
});

afterEach(() => {
  libraryFixture.tracks = [];
  libraryFixture.error = null;
});

describe('Audition page', () => {
  it('stacks the header, full song and library in one column using the real library', () => {
    libraryFixture.tracks = [
      track({ id: 'a', title: 'First Fixture', artist: 'Artist One' }),
      track({ id: 'b', title: 'Second Fixture', artist: 'Artist Two', bpm: 140, musical_key: '5B' }),
    ];
    const markup = wrap(createElement(AuditionView, { importId: 'import-test', onImport: vi.fn() }));

    const header = markup.indexOf('data-testid="audition-track-header"');
    const fullSong = markup.indexOf('data-testid="audition-full-song"');
    const library = markup.indexOf('data-testid="audition-library"');
    expect(header).toBeGreaterThan(-1);
    expect(fullSong).toBeGreaterThan(header);
    expect(library).toBeGreaterThan(fullSong);

    expect(markup).toContain('First Fixture');
    expect(markup).toContain('Artist Two');
    expect(markup).toContain('2 tracks');
    expect(markup).toContain('aria-label="Search the library"');
    for (const filter of ['Genre', 'Key', 'BPM']) expect(markup).toContain(filter);
  });

  it('offers to import a library when none is connected', () => {
    const markup = wrap(createElement(AuditionView, { importId: null, onImport: vi.fn() }));
    expect(markup).toContain('Import library');
    expect(markup).not.toContain('data-testid="audition-library"');
  });

  it('shows a plain message with a retry when the library cannot be loaded', () => {
    libraryFixture.error = 'network down';
    const markup = wrap(createElement(AuditionView, { importId: 'import-test', onImport: vi.fn() }));
    expect(markup).toContain('Your library could not be loaded.');
    expect(markup).toContain('Try again');
    expect(markup).not.toContain('network down');
  });

  it('does not render side panels or the Cue Points editor', () => {
    libraryFixture.tracks = [track({})];
    const markup = wrap(createElement(AuditionView, { importId: 'import-test', onImport: vi.fn() }));
    expect(markup).not.toContain('cue-workstation');
    expect(markup).not.toContain('data-testid="cue-browser-track-table"');
    expect(markup).not.toContain('Save Draft');
  });
});

describe('Audition track header', () => {
  it('shows the selected track with its real details and the position in the list', () => {
    const markup = renderToStaticMarkup(createElement(AuditionTrackHeader, {
      track: track({ title: 'Real Track Name', artist: 'Real Artist', genre: 'Techno', bpm: 132.4 }),
      durationMs: 372_000,
      positionLabel: '14 of 387',
      onPrevious: () => undefined,
      onNext: null,
    }));
    expect(markup).toContain('Real Track Name');
    expect(markup).toContain('Real Artist');
    expect(markup).toContain('Techno');
    expect(markup).toContain('132 BPM');
    expect(markup).toContain('6:12');
    expect(markup).toContain('14 of 387');
    expect(markup).toMatch(/aria-label="Next track"[^>]*disabled=""/);
    expect(markup).not.toMatch(/aria-label="Previous track"[^>]*disabled=""/);
  });

  it('no longer has Keep, Maybe and Remove in the header; they are in the transport row', () => {
    const markup = renderToStaticMarkup(createElement(AuditionTrackHeader, {
      track: track({}), durationMs: null, positionLabel: null, onPrevious: null, onNext: null,
    }));
    expect(markup).not.toContain('audition-decision');
  });

  it('keeps Keep, Maybe and Remove visible but switched off until they are connected', async () => {
    const { AuditionDecisions } = await import('./AuditionDecisions');
    const markup = renderToStaticMarkup(createElement(AuditionDecisions));
    for (const id of ['keep', 'maybe', 'remove']) {
      expect(markup).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*data-testid="audition-decision-${id}"`));
    }
    expect(markup).toContain('Coming soon');
  });

  it('puts them at the end of the transport row, to the right of the volume slider', () => {
    const transport = readFileSync(new URL('./AuditionTransport.tsx', import.meta.url), 'utf8');
    expect(transport.indexOf('aria-label="Volume"')).toBeGreaterThan(-1);
    expect(transport.indexOf('aria-label="Volume"')).toBeLessThan(transport.indexOf('<AuditionDecisions />'));
  });

  it('asks the user to pick a track when nothing is selected', () => {
    const markup = renderToStaticMarkup(createElement(AuditionTrackHeader, {
      track: null, durationMs: null, positionLabel: null, onPrevious: null, onNext: null,
    }));
    expect(markup).toContain('Select a track');
  });
});

describe('Audition full song', () => {
  const sections: TimelineSection[] = [
    { id: 's1', label: 'Intro', sourceLabel: 'intro', startMs: 0, endMs: 93_000, panelColor: '#16477a', waveformColor: '#2997ff' },
    { id: 's2', label: 'Drop', sourceLabel: 'down', startMs: 93_000, endMs: 372_000, panelColor: '#8f2d2f', waveformColor: '#ff514b' },
  ];
  const render = (props: Partial<Parameters<typeof AuditionFullSong>[0]> = {}) => wrap(createElement(AuditionFullSong, {
    track: track({}),
    durationMs: 372_000,
    waveformState: { status: 'idle', trackId: 't1' },
    onRetryWaveform: vi.fn(),
    sections,
    sectionsLoading: false,
    sectionsError: null,
    onRetrySections: vi.fn(),
    ...props,
  }));

  it('lays out one chip per real section, sized by how long the section lasts', () => {
    const markup = render();
    expect(markup.match(/data-testid="audition-section"/g)).toHaveLength(2);
    expect(markup).toContain('Intro');
    expect(markup).toContain('Drop');
    expect(markup).toContain('left:25%');
    expect(markup).toContain('left:0%');
    expect(markup).toContain('6:12');
    expect(markup).toContain('0:30');
  });

  it('draws a marker above the waveform for each cue point, with the hot cue letter, and a line through the waveform', () => {
    const markup = render({ cues: [
      { id: 'c1', startMs: 93_000, color: '#2997ff', label: 'B' },
      { id: 'c2', startMs: 186_000, color: '#9aa5b8', label: null },
    ] });
    expect(markup.match(/data-testid="audition-cue"/g)).toHaveLength(2);
    expect(markup).toContain('data-testid="audition-cues"');
    expect(markup).toContain('>B</span>');
    expect(markup).toContain('title="Cue B · 1:33"');
    expect(markup).toContain('title="Memory cue · 3:06"');
    expect(markup).toContain('left:25%');
    expect(markup.match(/audition-cue-line/g)).toHaveLength(2);
    // The markers come before the ruler and waveform.
    expect(markup.indexOf('data-testid="audition-cues"')).toBeLessThan(markup.indexOf('audition-song-ruler'));
  });

  it('puts the track sections directly under the cue point row, above the ruler and the waveform', () => {
    const markup = render({ cues: [{ id: 'c1', startMs: 93_000, color: '#2997ff', label: 'B' }] });
    const cues = markup.indexOf('data-testid="audition-cues"');
    const sectionsAt = markup.indexOf('data-testid="audition-sections"');
    const ruler = markup.indexOf('audition-song-ruler');
    expect(cues).toBeGreaterThan(-1);
    expect(sectionsAt).toBeGreaterThan(cues);
    expect(sectionsAt).toBeLessThan(ruler);
    expect(ruler).toBeLessThan(markup.indexOf('aria-label="Full waveform'));
  });

  it('shows no marker row for a track without cue points', () => {
    expect(render({ cues: [] })).not.toContain('data-testid="audition-cues"');
  });

  it('says so plainly when a track has no sections', () => {
    expect(render({ sections: [] })).toContain('No sections were found for this track.');
  });

  it('offers a retry when the sections could not be loaded', () => {
    const markup = render({ sections: [], sectionsError: 'Track sections could not be loaded.' });
    expect(markup).toContain('Track sections could not be loaded.');
    expect(markup).toContain('Try again');
  });

  it('shows a loading note while sections load', () => {
    expect(render({ sections: [], sectionsLoading: true })).toContain('Loading sections…');
  });

  it('renders the playback controls passed into the panel', () => {
    expect(render({ children: createElement('div', { 'data-testid': 'slot' }, 'controls') })).toContain('data-testid="slot"');
  });
});

describe('Audition library rows', () => {
  const libraryProps = (over: Record<string, unknown> = {}) => ({
    tracks: [track({ id: 'a', title: 'Row Fixture', artist: 'Row Artist', duration_ms: 372_000 })],
    selectedTrackId: null, onSelectTrack: vi.fn(), countLabel: '1 track', loading: false, loadingMore: false, error: null, hasMore: false,
    onLoadMore: vi.fn(), onRetry: vi.fn(), search: '', onSearchChange: vi.fn(), genre: '', onGenreChange: vi.fn(), genreOptions: [],
    keyFilter: '', onKeyFilterChange: vi.fn(), keyOptions: [], bpmBounds: [60, 200] as [number, number], bpmRange: null,
    onBpmRangeChange: vi.fn(), sort: null, onSortChange: vi.fn(), ...over,
  });

  it('shows a waveform preview to the right of the title and artist, with the cue points marked on it', async () => {
    const { AuditionLibrary } = await import('./AuditionLibrary');
    const cueStates = new Map([['a', {
      status: 'loaded-with-cues' as const, trackId: 'a',
      cues: [
        { id: 'c1', start_ms: 93_000, color_hex: '#2997ff', cue_family: 'hot' },
        { id: 'c2', start_ms: 186_000, color_hex: null, cue_family: 'memory' },
      ],
    }]]);
    const markup = wrap(createElement(AuditionLibrary, libraryProps({ cueStates }) as never));
    expect(markup).toContain('aria-label="Waveform for Row Fixture"');
    expect(markup.indexOf('Row Artist')).toBeLessThan(markup.indexOf('aria-label="Waveform for Row Fixture"'));
    expect(markup).toContain('left:25%');
    expect(markup).toContain('left:50%');
    expect(markup).toContain('fill="#2997ff"');
  });

  it('still shows the row waveform area when a track has no cue points', async () => {
    const { AuditionLibrary } = await import('./AuditionLibrary');
    const markup = wrap(createElement(AuditionLibrary, libraryProps() as never));
    expect(markup).toContain('aria-label="Waveform for Row Fixture"');
  });

  it('loads the waveforms and cue points for the rows the list shows', () => {
    const view = readFileSync(new URL('./AuditionView.tsx', import.meta.url), 'utf8');
    expect(view).toContain('useAuditionRowCues(rowTrackIds)');
    expect(view).toContain('getWaveformState={getWaveformState}');
    expect(view).toContain('cueStates={rowCueStates}');
    expect(view).toContain('useTrackPreviewWaveforms(importId, waveformIds)');
  });
});
