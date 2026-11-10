import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';

const libraryFixture = vi.hoisted(() => ({ tracks: [] as RekordboxTrack[] }));
const playlistCountFixture = vi.hoisted(() => ({ counts: new Map<string, number>(), error: null as string | null }));

vi.mock('../../hooks/useTrackPlaylistCounts', () => ({
  useTrackPlaylistCounts: () => ({ counts: playlistCountFixture.counts, loading: false, error: playlistCountFixture.error, retry: vi.fn() }),
}));

vi.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'dropdex', setTheme: vi.fn() }),
}));

vi.mock('../../hooks/useAuthSession', () => ({
  useAuthSession: () => ({
    status: 'unauthenticated',
    retry: vi.fn(),
    clearSession: vi.fn(),
  }),
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
  useLibraryStats: () => ({ stats: null, loading: false, error: null, refresh: vi.fn() }),
  useLibraryTracks: () => ({
    tracks: libraryFixture.tracks,
    total: libraryFixture.tracks.length,
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('../../hooks/useRekordboxPlaylists', () => ({
  useRekordboxPlaylists: () => ({ playlists: [], loading: false, error: null }),
}));

vi.mock('../../hooks/useRekordboxPlaylistTracks', () => ({
  useRekordboxPlaylistTracks: () => ({
    tracks: [],
    total: 0,
    stats: null,
    loading: false,
    loadingMore: false,
    statsLoading: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn(),
  }),
}));

vi.mock('../../hooks/useRouteEntities', () => ({
  useRouteImport: () => ({ data: null, loading: false, error: null }),
}));

vi.mock('../../hooks/useTrackPreviewWaveforms', () => ({
  useTrackPreviewWaveforms: () => ({
    states: new Map(),
    loadingBatchCount: 0,
    retry: vi.fn(),
    getState: (trackId: string | null | undefined) => ({ status: 'idle', trackId: trackId ?? 'none' }),
  }),
}));

let CuePointsView: typeof import('./CuePointsView').CuePointsView;
let CuePointsTrackPanel: typeof import('./CuePointsView').CuePointsTrackPanel;
let AudioPlayerProvider: typeof import('../../contexts/AudioPlayerContext').AudioPlayerProvider;

beforeAll(async () => {
  ({ CuePointsView, CuePointsTrackPanel } = await import('./CuePointsView'));
  ({ AudioPlayerProvider } = await import('../../contexts/AudioPlayerContext'));
});

describe('CuePointsView production Stage 3 render', () => {
  it('renders Library as the default source with Playlists available in the real production component', () => {
    const markup = renderToStaticMarkup(
      createElement(AudioPlayerProvider, {
        imports: [],
        children: createElement(CuePointsView, { importId: 'import-test', onImport: vi.fn() }),
      }),
    );

    expect(markup).toContain('aria-label="Cue Points browser source"');
    expect(markup).toMatch(/role="tab" aria-selected="true"[^>]*class="lib-tab"[^>]*>.*?Tracks<\/button>/);
    expect(markup).toMatch(/role="tab" aria-selected="false"[^>]*class="lib-tab"[^>]*>.*?Playlists<\/button>/);
    const sourceTabs = markup.indexOf('data-testid="cue-browser-source-tabs"');
    expect(sourceTabs).toBeGreaterThan(markup.indexOf('data-testid="cue-browser-filters"'));
    expect(sourceTabs).toBeLessThan(markup.indexOf('data-testid="cue-browser-search"'));
    expect(markup).toContain('aria-label="Search cue point tracks"');
    expect(markup).not.toContain('data-testid="cue-audio-dock"');
    expect(markup).not.toContain('aria-label="Cue Points transport controls"');
  });
});


describe('Audition workspace', () => {
  it('shares track columns and filters with Cue Points while delegating playback to the bottom dock', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    libraryFixture.tracks = [{
      id: 'audition-track', title: 'Audition Track', artist: 'Test Artist',
      genre: 'House', bpm: 128, musical_key: '8A', duration_ms: 180000,
      file_format: 'WAV', sample_rate_hz: 44100, bitrate_kbps: 1411,
    } as RekordboxTrack];
    const render = (mode: 'cues' | 'audition') => renderToStaticMarkup(
      createElement(AudioPlayerProvider, {
        imports: [],
        children: createElement(CuePointsView, { mode, importId: 'import-test', onImport: vi.fn() }),
      }),
    );
    try {
      const audition = render('audition');
      const cues = render('cues');
      expect(audition).toContain('<thead');
      expect(audition.match(/<thead[\s\S]*?<\/thead>/)?.[0]).toBe(cues.match(/<thead[\s\S]*?<\/thead>/)?.[0]);
      expect(audition).toContain('Audition Track');
      expect(audition).toContain('Test Artist');
      expect(audition).toMatch(/<td[^>]*>WAV<\/td>/);
      expect(audition).toMatch(/data-label="Added On"[^>]*>—<\/td>/);
      expect(audition).toContain('aria-label="Search audition tracks"');
      expect(audition).toContain('data-testid="cue-browser-filters"');
      expect(audition).not.toContain('data-label="Beat Count"');
      expect(audition).not.toContain('aria-label="Audition transport controls"');
      expect(audition).toContain('Select a track to audition');
      expect(audition).not.toContain('Edit Genre');
      expect(audition).not.toContain('Save Draft');
      expect(audition).not.toContain('Apply Track');
      expect(audition).not.toContain('>Snap<');
      for (const filter of ['Status', 'Genre', 'Key', 'Cue States', 'Analysis', 'BPM']) {
        expect(audition).toContain(filter);
      }
    } finally {
      libraryFixture.tracks = [];
      vi.unstubAllGlobals();
    }
  });
});


describe('Review shared browser and focused track timeline', () => {
  const track = {
    id: 'review-track', rekordbox_content_id: '42', import_id: 'import-test', title: 'Review Track', artist: 'Test Artist',
    date_added: '2026-10-25',
    genre: 'House', bpm: 128, musical_key: '8A', duration_ms: 180000,
    file_format: 'WAV', sample_rate_hz: 44100, bitrate_kbps: 1411,
  } as RekordboxTrack;

  it('uses the Cue Points filters and track columns without a timeline, dock, or editing UI in Review', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    libraryFixture.tracks = [track];
    try {
      const markup = renderToStaticMarkup(createElement(AudioPlayerProvider, {
        imports: [], children: createElement(CuePointsView, {
          mode: 'artist-library', importId: 'import-test', onImport: vi.fn(), onTrackOpen: vi.fn(),
        }),
      }));
      expect(markup).toContain('artist-library-browser');
      expect(markup).toMatch(/^<div class="[^"]*\bcue-studio\b[^"]*"/);
      expect(markup).toContain('aria-label="Search artist library tracks"');
      expect(markup).toContain('data-testid="cue-browser-filters"');
      expect(markup).toContain('Review Track');
      expect(markup).toContain('aria-label="Sort by Format"');
      expect(markup).not.toContain('Sort by Rate');
      expect(markup).not.toContain('Sample Rate');
      expect(markup).not.toContain('Select a track');
      expect(markup).not.toContain('data-testid="cue-audio-dock"');
      expect(markup).not.toContain('Edit Genre');
    } finally {
      libraryFixture.tracks = [];
      vi.unstubAllGlobals();
    }
  });

  const renderRows = (mode: 'artist-library' | 'cues') => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    libraryFixture.tracks = [track];
    try {
      const markup = renderToStaticMarkup(createElement(AudioPlayerProvider, {
        imports: [], children: createElement(CuePointsView, { mode, importId: 'import-test', onImport: vi.fn(), onTrackOpen: vi.fn() }),
      }));
      return markup.slice(markup.indexOf('<tbody'));
    } finally {
      libraryFixture.tracks = [];
      vi.unstubAllGlobals();
    }
  };
  it('both modes render plain format and key values with shared metadata styles', () => {
    for (const mode of ['artist-library', 'cues'] as const) {
      const rows = renderRows(mode);
      expect(rows).toMatch(/<td[^>]*>08A<\/td>/);
      expect(rows).toMatch(/<td[^>]*>WAV<\/td>/);
      expect(rows).toContain('<time dateTime="2026-10-25">2026-10-25</time>');
      expect(rows).toMatch(/<td[^>]*font-mono[^>]*>128\.0<\/td>/);
      expect(rows).not.toContain('properties-cell');
      expect(rows).not.toContain('dd-status-badge');
    }
  });

  it('Review: adds a Playlists column showing how many playlists each track is in', () => {
    playlistCountFixture.counts = new Map([['review-track', 3]]);
    try {
      const markup = renderRows('artist-library');
      expect(markup).toContain('data-testid="playlist-count"');
      expect(markup).toMatch(/data-testid="playlist-count"[^>]*><span title="In 3 playlists">3<\/span>/);
    } finally {
      playlistCountFixture.counts = new Map();
    }
  });

  it('Review: says "playlist" for one, shows … while loading, and a retry when the counts failed', () => {
    playlistCountFixture.counts = new Map([['review-track', 1]]);
    expect(renderRows('artist-library')).toContain('title="In 1 playlist">1</span>');
    playlistCountFixture.counts = new Map();
    expect(renderRows('artist-library')).toMatch(/data-testid="playlist-count"[^>]*>…<\/td>/);
    playlistCountFixture.error = 'Playlist counts could not be loaded.';
    try {
      const failed = renderRows('artist-library');
      expect(failed).toContain('aria-label="Playlist counts could not be loaded. Try again."');
    } finally {
      playlistCountFixture.error = null;
    }
  });

  it('shows playlist counts in Cue Points as well as Review', () => {
    expect(renderRows('cues')).toContain('data-testid="playlist-count"');
  });

  it('every listing mode is drawn by the shared TrackListing: sentence-case headings, a play button, the waveform and an Actions column', () => {
    const table = (mode: 'artist-library' | 'cues') => {
      vi.stubGlobal('window', { devicePixelRatio: 1 });
      libraryFixture.tracks = [track];
      try {
        const markup = renderToStaticMarkup(createElement(AudioPlayerProvider, {
          imports: [], children: createElement(CuePointsView, { mode, importId: 'import-test', onImport: vi.fn(), onTrackOpen: vi.fn() }),
        }));
        return markup.slice(markup.indexOf('<div class="track-listing'), markup.indexOf('</table>'));
      } finally {
        libraryFixture.tracks = [];
        vi.unstubAllGlobals();
      }
    };
    const review = table('artist-library');
    const cues = table('cues');
    const headers = ['Track', 'Bpm', 'Key', 'Genre', 'Format', 'Playlists', 'Added On', 'Duration', 'Actions'];
    for (const markup of [review, cues]) {
      const head = markup.slice(markup.indexOf('<thead'), markup.indexOf('</thead>'));
      expect(head.match(/<th /g)).toHaveLength(headers.length);
      const offsets = headers.map((label) => head.indexOf('>' + label + '<'));
      expect(offsets.every((offset) => offset >= 0)).toBe(true);
      expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    }
    for (const markup of [review, cues]) {
      expect(markup).toContain('aria-label="Play Review Track"');
      expect(markup).toContain('data-testid="track-listing-wave"');
      expect(markup).toContain('aria-label="Actions for Review Track"');
      expect(markup).toContain('h-1.5 w-1.5 shrink-0 rounded-full');
    }
    expect(review).not.toContain('cue-browser__table--tight');
    expect(cues).not.toContain('cue-browser__table--tight');
  });

  it('renders the focused track identity, aligned timeline, and transport without editing or browser controls', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    try {
      const markup = renderToStaticMarkup(createElement(AudioPlayerProvider, {
        imports: [], children: createElement(CuePointsTrackPanel, {
          track, waveformState: { status: 'idle', trackId: track.id }, onRetryWaveform: vi.fn(),
        }),
      }));
      expect(markup).toContain('Review Track');
      expect(markup).toContain('Test Artist');
      expect(markup).toContain('data-testid="audition-track-header"');
      expect(markup).toContain('waveform-time-ruler');
      expect(markup).toContain('data-testid="cue-points-workstation"');
      expect(markup).toContain('Loading beat grid');
      expect(markup).toContain('Loading');
      expect(markup).toContain('class="studio-surface cue-studio cue-track-panel"');
      expect(markup).toContain('cue-workstation__timeline');
      expect(markup).toContain('aria-label="Track timeline controls"');
      const toolbar = markup.indexOf('aria-label="Track timeline controls"');
      expect(toolbar).toBeGreaterThan(markup.indexOf('data-testid="audition-track-header"'));
      expect(toolbar).toBeLessThan(markup.indexOf('cue-workstation__timeline'));
      expect(markup.match(/data-label="Beat Count"/g)).toHaveLength(1);
      expect(markup.match(/data-label="Grid"/g)).toHaveLength(1);
      expect(markup).toContain('aria-label="Beat Count: Beats"');
      expect(markup).toContain('aria-label="Hide grid"');
      expect(markup).not.toContain('cue-workspace-controls');
      expect(markup).not.toContain('aria-label="Track transport controls"');
      expect(markup).not.toContain('browser source');
      expect(markup).not.toContain('Search cue point tracks');
      expect(markup).not.toContain('Save Draft');
      expect(markup).not.toContain('Auto Cue');
      expect(markup).not.toContain('Pending Changes');
      expect(markup.indexOf('waveform-time-ruler')).toBeLessThan(markup.indexOf('track-timeline__cues'));
      const libraryMarkup = renderToStaticMarkup(createElement(AudioPlayerProvider, {
        imports: [], children: createElement(CuePointsTrackPanel, {
          track, waveformState: { status: 'idle', trackId: track.id },
        }),
      }));
      const sectionRow = libraryMarkup.indexOf('waveform-section-row');
      const timeRuler = libraryMarkup.indexOf('waveform-time-ruler');
      const cueRow = libraryMarkup.indexOf('track-timeline__cues');
      const waveform = libraryMarkup.indexOf('group/waveform');
      expect(sectionRow).toBeGreaterThan(-1);
      expect(timeRuler).toBeGreaterThan(sectionRow);
      expect(cueRow).toBeGreaterThan(timeRuler);
      expect(waveform).toBeGreaterThan(cueRow);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
