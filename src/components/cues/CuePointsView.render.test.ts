import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';

const libraryFixture = vi.hoisted(() => ({ tracks: [] as RekordboxTrack[] }));

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
    expect(markup).toContain('aria-pressed="true">Library</button>');
    expect(markup).toContain('aria-pressed="false">Playlists</button>');
    expect(markup).toContain('data-testid="cue-browser-command-bar"');
    expect(markup).toContain('aria-label="Search cue point tracks"');
    expect(markup).toContain('data-testid="cue-audio-dock"');
    expect(markup).toContain('aria-label="Cue Points transport controls"');
  });
});


describe('Audition workspace', () => {
  it('shares track columns and filters with Cue Points and exposes a horizontal playback dock without editing controls', () => {
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
      expect(audition.match(/<thead[\s\S]*?<\/thead>/)?.[0].replace('w-[112px]', 'w-[178px]')).toBe(cues.match(/<thead[\s\S]*?<\/thead>/)?.[0]);
      expect(audition).toContain('Audition Track');
      expect(audition).toContain('Test Artist');
      expect(audition).toContain('44.1 kHz');
      expect(audition).toContain('aria-label="Search audition tracks"');
      expect(audition).toContain('data-testid="cue-browser-filters"');
      expect(audition).toContain('aria-label="Audition audio dock"');
      expect(audition).toContain('flex-row items-center overflow-x-auto');
      expect(audition).toContain('Select a track to audition');
      expect(audition.indexOf('Select a track to audition')).toBeLessThan(audition.indexOf('aria-label="Audition audio dock"'));
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
    id: 'review-track', import_id: 'import-test', title: 'Review Track', artist: 'Test Artist',
    genre: 'House', bpm: 128, musical_key: '8A', duration_ms: 180000,
    file_format: 'WAV', sample_rate_hz: 44100, bitrate_kbps: 1411,
  } as RekordboxTrack;

  it('uses the Cue Points filters and track columns without a timeline, dock, or editing UI in Review', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    libraryFixture.tracks = [track];
    try {
      const markup = renderToStaticMarkup(createElement(AudioPlayerProvider, {
        imports: [], children: createElement(CuePointsView, {
          mode: 'review', importId: 'import-test', onImport: vi.fn(), onTrackOpen: vi.fn(),
        }),
      }));
      expect(markup).toContain('review-browser glass rounded-2xl');
      expect(markup).toContain('aria-label="Search review tracks"');
      expect(markup).toContain('data-testid="cue-browser-filters"');
      expect(markup).toContain('Review Track');
      expect(markup).toContain('Sort by Sample Rate');
      expect(markup).not.toContain('Select a track');
      expect(markup).not.toContain('data-testid="cue-audio-dock"');
      expect(markup).not.toContain('Edit Genre');
    } finally {
      libraryFixture.tracks = [];
      vi.unstubAllGlobals();
    }
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
      expect(markup).toContain('data-testid="cue-points-workstation"');
      expect(markup).toContain('Loading beat grid');
      expect(markup).toContain('Loading');
      expect(markup).toContain('aria-label="Track audio dock"');
      expect(markup).toContain('aria-label="Track transport controls"');
      expect(markup).not.toContain('browser source');
      expect(markup).not.toContain('Search cue point tracks');
      expect(markup).not.toContain('Save Draft');
      expect(markup).not.toContain('Auto Cue');
      expect(markup).not.toContain('Pending Changes');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
