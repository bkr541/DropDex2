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
          mode: 'artist-library', importId: 'import-test', onImport: vi.fn(), onTrackOpen: vi.fn(),
        }),
      }));
      expect(markup).toContain('artist-library-browser glass rounded-2xl');
      expect(markup).toContain('aria-label="Search artist library tracks"');
      expect(markup).toContain('data-testid="cue-browser-filters"');
      expect(markup).toContain('Review Track');
      expect(markup).toContain('Properties');
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
  const valueClass = 'text-xs font-medium text-foreground';
  const cell = (rows: string, text: string) => rows.match(new RegExp(`<td class="([^"]*)"[^>]*>(?:<span[^>]*>)?${text}(?:</span>)?</td>`))?.[1] ?? '';

  it('Review: every data value is 12px, the same size as the track title, in the normal text colour, medium weight, with no key badge, colours or boxes', () => {
    const rows = renderRows('artist-library');
    expect(renderRows('artist-library')).toContain('truncate font-bold text-xs leading-tight');
    for (const value of ['128.0', '08A', '3:00']) {
      expect(cell(rows, value), value).toContain(valueClass);
            expect(cell(rows, value), value).not.toContain('text-muted-foreground');
      expect(cell(rows, value), value).not.toContain('font-mono');
    }
    expect(rows).not.toContain('rounded-[5px] bg-white/[0.05]');
    expect(rows).not.toContain('font-bold tabular-nums">128.0');
  });

  it('Review: Format, rate and bit rate share one Properties column, each value in its own 12px badge, the same size as the other values', () => {
    const rows = renderRows('artist-library');
    const cell = rows.match(/<td data-testid="properties-cell" class="px-3 py-1.5 whitespace-nowrap">([\s\S]*?)<\/td>/)?.[1] ?? '';
    const badges = cell.match(/<span class="dd-status-badge dd-tone-neutral"[^>]*>[\s\S]*?<\/span><\/span>/g) ?? [];
    expect(badges).toHaveLength(3);
    expect(badges.map((badge) => badge.replace(/<[^>]+>/g, ''))).toEqual(['.wav', '44.1 kHz', '1411 kbps']);
    for (const badge of badges) expect(badge).toContain('font-size:12px;font-weight:500;letter-spacing:normal;text-transform:none;color:var(--color-foreground)');
    expect(rows.match(/properties-cell/g)).toHaveLength(1);
    expect(rows).not.toMatch(/<td[^>]*>WAV<\/td>/);
    expect(cell).not.toContain('>WAV<');
  });

  it('Review: shows a dash when a track has no format, rate or bit rate', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    libraryFixture.tracks = [{ ...track, file_format: null, sample_rate_hz: null, bitrate_kbps: null } as RekordboxTrack];
    try {
      const markup = renderToStaticMarkup(createElement(AudioPlayerProvider, {
        imports: [], children: createElement(CuePointsView, { mode: 'artist-library', importId: 'import-test', onImport: vi.fn(), onTrackOpen: vi.fn() }),
      }));
      const cell = markup.match(/data-testid="properties-cell"[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '';
      expect(cell).toContain('—');
      expect(cell).not.toContain('dd-status-badge');
    } finally {
      libraryFixture.tracks = [];
      vi.unstubAllGlobals();
    }
  });

  it('Review: the genre, cues and playlists values are all there', () => {
    const rows = renderRows('artist-library');
    expect(rows).toMatch(/<td class="[^"]*w-\[71px\][^"]*"><span class="block min-w-0 truncate">House<\/span><\/td>/);
    expect(rows).toContain('data-testid="playlist-count"');
    expect(rows).toContain('>…</span></td>');
  });

  it('Cue Points keeps its smaller muted values, monospace numbers and boxed cue count', () => {
    const rows = renderRows('cues');
    expect(rows).toContain('text-xs text-muted-foreground');
    expect(rows).toContain('font-mono text-[13px]');
    expect(rows).toContain('inline-flex min-w-8 justify-center rounded-md border');
    expect(rows).not.toContain(valueClass);
    expect(rows).not.toContain('properties-cell');
    expect(rows).not.toContain('dd-status-badge');
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

  it('Cue Points does not get the Playlists column', () => {
    expect(renderRows('cues')).not.toContain('data-testid="playlist-count"');
  });

  it('Review: columns sit 4px closer (10px on each side of a cell instead of 12px); Cue Points is unchanged', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../ui/dropdex-display.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.cue-browser__table--tight th,\s*\.cue-browser__table--tight td \{\s*padding-inline: 10px;/);
    const tableOf = (mode: 'artist-library' | 'cues') => {
      vi.stubGlobal('window', { devicePixelRatio: 1 });
      libraryFixture.tracks = [track];
      try {
        return renderToStaticMarkup(createElement(AudioPlayerProvider, {
          imports: [], children: createElement(CuePointsView, { mode, importId: 'import-test', onImport: vi.fn(), onTrackOpen: vi.fn() }),
        })).match(/<table [^>]*>/)?.[0] ?? '';
      } finally {
        libraryFixture.tracks = [];
        vi.unstubAllGlobals();
      }
    };
    expect(tableOf('artist-library')).toContain('cue-browser__table--tight');
    expect(tableOf('cues')).not.toContain('cue-browser__table--tight');
  });

  it('every listing mode is drawn by the shared TrackListing: capital headings, a play button, the waveform and an Actions column', () => {
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
    const reviewHead = review.slice(review.indexOf('<thead'), review.indexOf('</thead>'));
    expect(reviewHead.match(/<th /g)).toHaveLength(10);
    for (const label of ['Track', 'BPM', 'Key', 'Genre', 'Cues', 'Playlists', 'Properties', 'Duration', 'Cloud', 'Actions']) expect(reviewHead).toContain(`>${label}<`);
    for (const gone of ['>Format<', '>Sample Rate<', '>Bit Rate<', 'normal-case']) expect(reviewHead).not.toContain(gone);
    const cues = table('cues');
    const cuesHead = cues.slice(cues.indexOf('<thead'), cues.indexOf('</thead>'));
    expect(cuesHead.match(/<th /g)).toHaveLength(10);
    for (const label of ['Format', 'Sample Rate', 'Bit Rate', 'Actions']) expect(cuesHead).toContain(`>${label}<`);
    expect(cuesHead).not.toContain('Playlists');
    for (const markup of [review, cues]) {
      expect(markup).toContain('aria-label="Play Review Track"');
      expect(markup).toContain('data-testid="track-listing-wave"');
      expect(markup).toContain('aria-label="Actions for Review Track"');
      expect(markup).toContain('h-1.5 w-1.5 shrink-0 rounded-full');
    }
    expect(review).toContain('cue-browser__table--tight');
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
