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
          mode: 'review', importId: 'import-test', onImport: vi.fn(), onTrackOpen: vi.fn(),
        }),
      }));
      expect(markup).toContain('review-browser glass rounded-2xl');
      expect(markup).toContain('aria-label="Search review tracks"');
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

  const renderRows = (mode: 'review' | 'cues') => {
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
    const rows = renderRows('review');
    expect(renderRows('review')).toContain('truncate font-bold text-xs leading-tight');
    for (const value of ['128.0', '08A', '3:00']) {
      expect(cell(rows, value), value).toContain(valueClass);
            expect(cell(rows, value), value).not.toContain('text-muted-foreground');
      expect(cell(rows, value), value).not.toContain('font-mono');
    }
    expect(rows).not.toContain('rounded-[5px] bg-white/[0.05]');
    expect(rows).not.toContain('font-bold tabular-nums">128.0');
  });

  it('Review: Format, rate and bit rate share one Properties column, each value in its own 12px badge, the same size as the other values', () => {
    const rows = renderRows('review');
    const cell = rows.match(/<td class="px-3 py-1.5 whitespace-nowrap" data-testid="properties-cell">([\s\S]*?)<\/td>/)?.[1] ?? '';
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
        imports: [], children: createElement(CuePointsView, { mode: 'review', importId: 'import-test', onImport: vi.fn(), onTrackOpen: vi.fn() }),
      }));
      const cell = markup.match(/data-testid="properties-cell">([\s\S]*?)<\/td>/)?.[1] ?? '';
      expect(cell).toContain('—');
      expect(cell).not.toContain('dd-status-badge');
    } finally {
      libraryFixture.tracks = [];
      vi.unstubAllGlobals();
    }
  });

  it('Review: the genre, cues and playlists values look the same as the rest', () => {
    const rows = renderRows('review');
    expect(rows).toMatch(new RegExp(`<td class="[^"]*${valueClass}[^"]*w-\\[71px\\][^"]*"><span class="block min-w-0 truncate">House</span></td>`));
    expect(rows).toMatch(new RegExp(`<td class="px-3 py-1.5"><span class="[^"]*${valueClass}[^"]*">…</span></td>`));
    expect(rows).toMatch(new RegExp(`data-testid="playlist-count"`));
    expect(rows.match(new RegExp(`class="[^"]*${valueClass}[^"]*" data-testid="playlist-count"`))).toBeTruthy();
  });

  it('Review: the cues count has no box around it and starts at the left of its column like the others', () => {
    const rows = renderRows('review');
    expect(rows).not.toContain('inline-flex min-w-8 justify-center rounded-md border');
    expect(rows).not.toContain('<td class="px-3 py-1.5 text-center">');
    expect(rows).toContain('<td class="px-3 py-1.5"><span class="whitespace-nowrap text-xs font-medium text-foreground">');
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
      const markup = renderRows('review');
      expect(markup).toContain('data-testid="playlist-count"');
      expect(markup).toMatch(/data-testid="playlist-count"><span title="In 3 playlists">3<\/span>/);
    } finally {
      playlistCountFixture.counts = new Map();
    }
  });

  it('Review: says "playlist" for one, shows … while loading, and a retry when the counts failed', () => {
    playlistCountFixture.counts = new Map([['review-track', 1]]);
    expect(renderRows('review')).toContain('title="In 1 playlist">1</span>');
    playlistCountFixture.counts = new Map();
    expect(renderRows('review')).toMatch(/data-testid="playlist-count">…<\/td>/);
    playlistCountFixture.error = 'Playlist counts could not be loaded.';
    try {
      const failed = renderRows('review');
      expect(failed).toContain('aria-label="Playlist counts could not be loaded. Try again."');
    } finally {
      playlistCountFixture.error = null;
    }
  });

  it('Cue Points does not get the Playlists column', () => {
    expect(renderRows('cues')).not.toContain('data-testid="playlist-count"');
  });

  it('Review: all nine column headings are 13px, extra bold and in capitals, with no icons; Properties replaces Format, Rate and Bit Rate', () => {
    const table = (mode: 'review' | 'cues') => {
      vi.stubGlobal('window', { devicePixelRatio: 1 });
      libraryFixture.tracks = [track];
      try {
        const markup = renderToStaticMarkup(createElement(AudioPlayerProvider, {
          imports: [], children: createElement(CuePointsView, { mode, importId: 'import-test', onImport: vi.fn(), onTrackOpen: vi.fn() }),
        }));
        return markup.slice(markup.indexOf('<table'), markup.indexOf('</table>'));
      } finally {
        libraryFixture.tracks = [];
        vi.unstubAllGlobals();
      }
    };
    const review = table('review');
    const head = review.slice(review.indexOf('<thead'), review.indexOf('</thead>'));
    expect(head.match(/<th /g)).toHaveLength(9);
    for (const label of ['Track', 'BPM', 'Key', 'Genre', 'Cues', 'Playlists', 'Properties', 'Duration', 'Cloud']) {
      expect(head).toContain(`>${label}<`);
    }
    expect(head).toContain('text-[13px] font-extrabold');
    expect(head).not.toContain('text-[9px]');
    expect(head).not.toContain('text-xs');
    expect(head.match(/<button[^>]*class="[^"]*\buppercase\b/g)).toHaveLength(7);
    const properties = head.match(/<th [^>]*>[^]*?Properties[^]*?<\/th>/)?.[0] ?? '';
    expect(properties).not.toContain('normal-case');
    for (const gone of ['>Format<', '>Rate<', '>Bit Rate<', 'Sort by Properties']) expect(head).not.toContain(gone);
    expect(head).not.toContain('<svg');
    expect(head).not.toContain('Sample Rate');
    const cues = table('cues');
    expect(cues.match(/<th /g)).toHaveLength(9);
    expect(cues).toContain('Sample Rate');
    expect(cues).toContain('text-[9px]');
    expect(cues).not.toContain('font-extrabold');
    expect(cues).not.toMatch(/<button[^>]*class="[^"]*\buppercase\b/);
    expect(cues).toContain('px-3 py-2 text-center');
    expect(cues).not.toContain('Playlists');
  });

  it('Review: the larger-headings-with-icons option is switched off, and can be switched back on', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./CuePointsView.tsx', import.meta.url), 'utf8');
    expect(source).toContain('const LIBRARY_LARGE_ICON_HEADINGS = false;');
    expect(source).toContain('<TrackTableHead large={review && LIBRARY_LARGE_ICON_HEADINGS} className={review ? LIBRARY_HEADING : undefined}>');
    expect(source).toContain("const LIBRARY_HEADING = 'text-[13px] font-extrabold';");
    expect(source).toContain("icon={review && LIBRARY_LARGE_ICON_HEADINGS ? icon : undefined}");
  });

  it('Review: the genre column is 60% narrower, and the track name sits closer to its status dot at 12px', () => {
    const markup = renderRows('review');
    expect(markup).toContain('w-[71px] max-w-[71px]');
    expect(markup).not.toContain('w-[178px]');
    expect(markup).toContain('group flex min-w-0 items-center gap-1.5');
    expect(markup).toContain('truncate font-bold text-xs leading-tight');
  });

  it('Review: the artwork is 30px, the height of the 15px title line and the 15px artist line together; Cue Points keeps 36px', () => {
    const review = renderRows('review');
    expect(review).toContain('h-[30px] w-[30px]');
    expect(review).not.toContain('h-9 w-9');
    expect(review).toContain('truncate font-bold text-xs leading-tight');
    expect(review).toContain('truncate text-[10px] text-muted-foreground');
    const cues = renderRows('cues');
    expect(cues).toContain('h-9 w-9');
    expect(cues).not.toContain('h-[30px] w-[30px]');
  });

  it('Review: the track name is 12px narrower (334px) and the waveform 24px wider (152px) than the 346px and 128px on other pages', () => {
    const review = renderRows('review');
    expect(review).toContain('min-w-0 w-[334px] shrink-0');
    expect(review).toContain('w-[152px] shrink-0');
    expect(review).not.toContain('w-[140px]');
    expect(review).not.toContain('w-[346px]');
    expect(review).not.toContain('w-[128px]');
    const cues = renderRows('cues');
    expect(cues).toContain('w-[346px] shrink-0');
    expect(cues).toContain('w-[128px] shrink-0');
    expect(cues).not.toContain('w-[334px]');
    expect(cues).not.toContain('w-[140px]');
    expect(cues).not.toContain('w-[152px]');
  });

  it('Review: columns sit 4px closer (10px on each side of a cell instead of 12px); Cue Points is unchanged', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../ui/dropdex-display.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.cue-browser__table--tight th,\s*\.cue-browser__table--tight td \{\s*padding-inline: 10px;/);
    const tableOf = (mode: 'review' | 'cues') => {
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
    expect(tableOf('review')).toContain('cue-browser__table--tight');
    expect(tableOf('cues')).not.toContain('cue-browser__table--tight');
  });

  it('Cue Points keeps its badge, boxed cue count, wide genre column and 14px title', () => {
    const markup = renderRows('cues');
    expect(markup).toContain('w-[178px]');
    expect(markup).toContain('inline-flex min-w-8 justify-center rounded-md border');
    expect(markup).toContain('font-mono text-[13px] font-bold tabular-nums">128.0');
    expect(markup).toContain('group flex min-w-0 items-center gap-2.5');
    expect(markup).toContain('truncate font-bold text-sm leading-tight');
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
